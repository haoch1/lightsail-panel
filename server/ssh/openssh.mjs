import { createPrivateKey, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { spawn } from "node-pty";

const execute = promisify(execFile);

export function accessFiles(details) {
  const host = [details.ipAddress, ...(details.ipv6Addresses || [])].find(isIP);
  if (!host || !/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(details.username || ""))
    throw new Error("AWS 返回的 SSH 地址或用户名无效");
  // AWS may omit expiresAt. OpenSSH still verifies the certificate's validity.
  if (details.expiresAt != null) {
    const expires = new Date(details.expiresAt).getTime();
    if (!Number.isFinite(expires))
      throw new Error("AWS 返回的 SSH 凭证到期时间无效，请重新连接");
    if (expires <= Date.now() + 15000)
      throw new Error("AWS 临时 SSH 凭证已到期，请重新连接");
  }
  const privateKey = details.privateKey?.startsWith("-----BEGIN ")
    ? details.privateKey
    : Buffer.from(details.privateKey || "", "base64").toString("utf8");
  try {
    createPrivateKey(privateKey);
  } catch {
    throw new Error("AWS 返回的临时 SSH 私钥格式无效");
  }
  const certificate = (details.certKey || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
  if (!/^[-\w]+-cert-v01@openssh\.com [A-Za-z0-9+/=]+$/.test(certificate))
    throw new Error("AWS 返回的临时 SSH 证书格式无效");
  const keys = (details.hostKeys || [])
    .map(({ publicKey }) => {
      const raw = (publicKey || "").trim();
      const encoded = raw.includes(" ") ? raw.split(/\s+/)[1] : raw;
      if (!/^[A-Za-z0-9+/=]+$/.test(encoded)) return null;
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length < 8) return null;
      const size = bytes.readUInt32BE(0);
      if (size < 1 || size > 80 || size + 4 >= bytes.length) return null;
      const algorithm = bytes.subarray(4, size + 4).toString();
      if (
        !/^(?:ssh-(?:rsa|ed25519)|ecdsa-sha2-nistp(?:256|384|521))$/.test(
          algorithm,
        )
      )
        return null;
      return `${host} ${algorithm} ${encoded}`;
    })
    .filter(Boolean);
  if (!keys.length)
    throw new Error("AWS 未返回有效的 SSH 主机密钥，无法验证实例身份");
  return {
    host,
    username: details.username,
    privateKey,
    certificate,
    knownHosts: keys.join("\n") + "\n",
  };
}

export function sshArguments(files, host, username, marker) {
  const path = (p) => p.replaceAll("\\", "/");
  return [
    "-F",
    "none",
    "-tt",
    "-p",
    "22",
    "-l",
    username,
    "-i",
    files.key,
    "-o",
    `CertificateFile="${path(files.cert)}"`,
    "-o",
    `UserKnownHostsFile="${path(files.hosts)}"`,
    "-o",
    "GlobalKnownHostsFile=none",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "UpdateHostKeys=no",
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "IdentityAgent=none",
    "-o",
    "PreferredAuthentications=publickey",
    "-o",
    "PasswordAuthentication=no",
    "-o",
    "KbdInteractiveAuthentication=no",
    "-o",
    "ForwardAgent=no",
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "EscapeChar=none",
    "-o",
    "ConnectTimeout=20",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "--",
    host,
    ...(marker
      ? [`printf '\\036${marker}\\037'; exec "\${SHELL:-/bin/sh}" -l`]
      : []),
  ];
}

export async function openSsh(
  details,
  size,
  { spawnPty = spawn, directory = tmpdir() } = {},
) {
  const access = accessFiles(details);
  const marker = "LIGHTSAIL_PANEL_READY_" + randomBytes(16).toString("hex");
  const dir = await mkdtemp(join(directory, "lightsail-panel-ssh-"));
  let terminal;
  const cleanup = () =>
    rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  try {
    if (process.platform === "win32") {
      const identity = [process.env.USERDOMAIN, process.env.USERNAME]
        .filter(Boolean)
        .join("\\");
      await execute(
        "icacls.exe",
        [dir, "/inheritance:r", "/grant:r", `${identity}:(OI)(CI)F`],
        { windowsHide: true },
      );
    }
    const files = {
      key: join(dir, "identity"),
      cert: join(dir, "identity-cert.pub"),
      hosts: join(dir, "known_hosts"),
    };
    await Promise.all([
      writeFile(files.key, access.privateKey, { mode: 0o600, flag: "wx" }),
      writeFile(files.cert, access.certificate + "\n", {
        mode: 0o600,
        flag: "wx",
      }),
      writeFile(files.hosts, access.knownHosts, { mode: 0o600, flag: "wx" }),
    ]);
    // Forward only OS/terminal variables; AWS and panel secrets never reach the child.
    const env = Object.fromEntries(
      [
        "PATH",
        "Path",
        "SystemRoot",
        "WINDIR",
        "HOME",
        "USERPROFILE",
        "TEMP",
        "TMP",
        "LANG",
      ]
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]]),
    );
    env.TERM = "xterm-256color";
    terminal = spawnPty(
      process.platform === "win32" ? "ssh.exe" : "ssh",
      sshArguments(files, access.host, access.username, marker),
      {
        name: "xterm-256color",
        cols: size.cols,
        rows: size.rows,
        cwd: dir,
        env,
      },
    );
    // Keys are temporary OS-protected files, removed on every normal exit/failure.
    terminal.onExit(() => {
      void cleanup().catch(() => {});
    });
    return {
      terminal,
      username: access.username,
      host: access.host,
      marker: "\x1e" + marker + "\x1f",
      cleanup,
    };
  } catch (e) {
    try {
      terminal?.kill();
    } catch {
      /* already closed */
    }
    await cleanup();
    if (e.message?.includes("File not found") || e.code === "ENOENT")
      throw new Error("面板服务器未安装 OpenSSH 客户端");
    throw e;
  }
}
