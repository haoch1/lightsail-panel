import { useEffect, useRef, useState } from "react";
import {
  Clipboard,
  Copy,
  Maximize2,
  Minimize2,
  RotateCw,
  Unplug,
} from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";
import type { Instance } from "../../../shared/types";
import { regionLabel } from "../../../shared/regions";
import { usePanel } from "../../app/context";
import { Modal } from "../../components/ui";
import { api } from "../../lib/api";
import { targetOf } from "../../lib/instance-target";

type Status = "connecting" | "connected" | "closed" | "failed";
const labels: Record<Status, string> = {
  connecting: "连接中",
  connected: "已连接",
  closed: "已断开",
  failed: "连接失败",
};

export default function SshTerminal({
  instance,
  onClose,
}: {
  instance: Instance;
  onClose: () => void;
}) {
  const { demo, toast } = usePanel();
  const element = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const disconnectRef = useRef<() => void>(() => {});
  const [status, setStatus] = useState<Status>("connecting");
  const [identity, setIdentity] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const { accountId, region, service, id } = targetOf(instance);

  useEffect(() => {
    let cancelled = false;
    let stopped = false;
    let ticket = "";
    let socket: WebSocket | null = null;
    let connected = false;
    let receivedError = false;
    const term = new Terminal({
      cursorBlink: false,
      cursorStyle: "block",
      fontSize: 14,
      fontFamily: '"Cascadia Code", Consolas, "Liberation Mono", monospace',
      lineHeight: 1.25,
      scrollback: 5000,
      allowProposedApi: false,
      theme: {
        background: "#202020",
        foreground: "#ededed",
        cursor: "#ededed",
        selectionBackground: "#ffffff40",
      },
      disableStdin: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element.current!);
    terminalRef.current = term;
    setStatus("connecting");
    setIdentity("");
    setError("");
    setSelected(false);
    const send = (m: unknown) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
    };
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (cancelled) return;
        fit.fit();
        if (connected)
          send({
            type: "resize",
            cols: Math.min(500, term.cols),
            rows: Math.min(300, term.rows),
          });
      });
    });
    observer.observe(element.current!);
    const selection = term.onSelectionChange(() =>
      setSelected(term.hasSelection()),
    );
    let command = "";
    const data = term.onData((value) => {
      if (!connected) return;
      if (!demo) {
        // Bracketed paste can be large; split it into bounded WebSocket frames.
        for (let i = 0; i < value.length;) {
          let end = Math.min(value.length, i + 8192);
          if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]))
            end--;
          send({ type: "input", data: value.slice(i, end) });
          i = end;
        }
        return;
      }
      for (const char of value) {
        if (char === "\r") {
          term.write("\r\n");
          if (command.trim() === "exit") {
            disconnect();
            return;
          }
          if (command.trim() === "clear") term.clear();
          else if (command.trim() === "whoami")
            term.writeln(instance.sshUser || "admin");
          else if (command.trim() === "pwd")
            term.writeln("/home/" + (instance.sshUser || "admin"));
          else if (command) term.writeln("演示终端不执行真实命令。");
          command = "";
          term.write((instance.sshUser || "admin") + "@" + id + ":~$ ");
        } else if (char === "\x7f") {
          if (command) {
            command = command.slice(0, -1);
            term.write("\b \b");
          }
        } else if (char === "\x03") {
          command = "";
          term.write(
            "^C\r\n" + (instance.sshUser || "admin") + "@" + id + ":~$ ",
          );
        } else if (char >= " " && char !== "\x7f") {
          command += char;
          term.write(char);
        }
      }
    });
    function disconnect() {
      stopped = true;
      connected = false;
      term.options.disableStdin = true;
      socket?.close();
      if (ticket) void api("/ssh/cancel", { ticket }).catch(() => {});
      if (!cancelled) setStatus("closed");
    }
    disconnectRef.current = disconnect;
    async function connect() {
      try {
        await document.fonts.ready;
        if (cancelled || stopped) return;
        fit.fit();
        if (demo) {
          connected = true;
          term.options.disableStdin = false;
          setStatus("connected");
          setIdentity((instance.sshUser || "admin") + "@" + id);
          term.writeln("演示 SSH 终端 · 命令仅在浏览器中模拟\r\n");
          term.write((instance.sshUser || "admin") + "@" + id + ":~$ ");
          term.focus();
          return;
        }
        const result = await api<{ ticket: string }>("/ssh/connect", {
          accountId,
          region,
          service,
          id,
        });
        ticket = result.ticket;
        if (cancelled || stopped) {
          void api("/ssh/cancel", { ticket }).catch(() => {});
          return;
        }
        const url = new URL("/api/ssh/terminal", location.href);
        url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(url);
        socketRef.current = socket;
        socket.onopen = () => {
          if (cancelled || stopped) {
            socket?.close();
            return;
          }
          send({
            type: "connect",
            ticket,
            cols: Math.min(500, Math.max(2, term.cols)),
            rows: Math.min(300, Math.max(1, term.rows)),
          });
        };
        socket.onmessage = ({ data }) => {
          if (cancelled || stopped) return;
          const m = JSON.parse(data);
          if (m.type === "output") term.write(m.data);
          else if (m.type === "connecting" || m.type === "ready") {
            setIdentity(m.username + "@" + m.host);
            if (m.type === "ready") {
              connected = true;
              term.options.disableStdin = false;
              setStatus("connected");
              send({
                type: "resize",
                cols: Math.min(500, term.cols),
                rows: Math.min(300, term.rows),
              });
              term.focus();
            }
          } else if (m.type === "error") {
            receivedError = true;
            connected = false;
            term.options.disableStdin = true;
            setError(m.message);
            setStatus("failed");
          } else if (m.type === "exit") {
            receivedError = m.code !== 0;
            connected = false;
            term.options.disableStdin = true;
            setStatus(receivedError ? "failed" : "closed");
            if (receivedError)
              setError("SSH 连接已结束，请检查上方终端信息后重新连接。");
          }
        };
        socket.onerror = () => {
          if (!cancelled && !stopped) {
            receivedError = true;
            setStatus("failed");
            setError(
              "无法连接 SSH 服务，请检查面板网络与 WebSocket 代理配置。",
            );
          }
        };
        socket.onclose = () => {
          connected = false;
          term.options.disableStdin = true;
          if (!cancelled && !receivedError) setStatus("closed");
        };
      } catch (e) {
        if (!cancelled && !stopped) {
          setStatus("failed");
          setError((e as Error).message);
        }
      }
    }
    void connect();
    return () => {
      cancelled = true;
      connected = false;
      socket?.close();
      socketRef.current = null;
      terminalRef.current = null;
      if (ticket && !demo) void api("/ssh/cancel", { ticket }).catch(() => {});
      observer.disconnect();
      cancelAnimationFrame(resizeFrame);
      selection.dispose();
      data.dispose();
      term.dispose();
    };
  }, [accountId, region, service, id, demo, attempt, instance.sshUser]);

  async function copy() {
    const value = terminalRef.current?.getSelection();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      toast("无法访问剪贴板，请检查浏览器的剪贴板权限", "error");
    }
  }
  async function paste() {
    try {
      const value = await navigator.clipboard.readText();
      terminalRef.current?.paste(value);
      terminalRef.current?.focus();
    } catch {
      toast("无法读取剪贴板，可在终端中使用 Ctrl+Shift+V 粘贴", "error");
    }
  }

  return (
    <Modal
      wide
      title="SSH 终端"
      description={instance.name + " · " + regionLabel(instance.region)}
      className={"ssh-modal" + (fullscreen ? " fullscreen" : "")}
      backdropClassName={fullscreen ? "ssh-fullscreen-backdrop" : ""}
      onClose={onClose}
    >
      <div className="ssh-toolbar">
        <div className="ssh-connection" aria-live="polite">
          <span
            className={
              "state " +
              (status === "connected"
                ? "green"
                : status === "failed"
                  ? "red"
                  : "gray")
            }
          >
            {labels[status]}
          </span>
          <span className="ssh-identity mono" title={identity}>
            {identity}
          </span>
        </div>
        <div className="ssh-tools">
          <button className="button small" disabled={!selected} onClick={copy}>
            <Copy size={14} />
            复制
          </button>
          <button
            className="button small"
            disabled={status !== "connected"}
            onClick={paste}
          >
            <Clipboard size={14} />
            粘贴
          </button>
          <button
            className="button small"
            aria-pressed={fullscreen}
            onClick={() => {
              setFullscreen((value) => !value);
              terminalRef.current?.focus();
            }}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {fullscreen ? "退出全屏" : "全屏"}
          </button>
          {status === "connected" || status === "connecting" ? (
            <button
              className="button small"
              onClick={() => disconnectRef.current()}
            >
              <Unplug size={14} />
              断开连接
            </button>
          ) : (
            <button
              className="button small"
              onClick={() => setAttempt((n) => n + 1)}
            >
              <RotateCw size={14} />
              重新连接
            </button>
          )}
        </div>
      </div>
      <div className="ssh-terminal-frame">
        <div
          ref={element}
          className="ssh-terminal"
          aria-label="SSH 终端"
          onKeyDownCapture={(e) => {
            if (
              e.ctrlKey &&
              e.shiftKey &&
              !e.altKey &&
              !e.metaKey &&
              e.key.toLowerCase() === "c"
            ) {
              e.preventDefault();
              e.stopPropagation();
              if (!e.repeat) void copy();
            }
          }}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <div
        className={"ssh-footer" + (error ? " danger-text" : " muted")}
        role={error ? "alert" : undefined}
      >
        {error ||
          (demo ? "演示模式，不连接真实实例。" : "关闭窗口将断开 SSH 连接。")}
      </div>
    </Modal>
  );
}
