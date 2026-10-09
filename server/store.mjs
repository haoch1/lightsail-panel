import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class Store {
  onClose = new Set();
  constructor(dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const keyPath = join(dir, "encryption.key");
    const supplied = process.env.ENCRYPTION_KEY;
    if (supplied) {
      this.key = Buffer.from(supplied, "base64");
      if (this.key.length !== 32)
        throw new Error("ENCRYPTION_KEY 必须为 32 字节的 Base64 编码");
    } else {
      if (!existsSync(keyPath))
        writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
      this.key = readFileSync(keyPath);
    }
    this.db = new DatabaseSync(join(dir, "panel.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,meta TEXT NOT NULL,secret TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS launch_network(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS launch_network_status ON launch_network(json_extract(body, '$.status'));
      CREATE INDEX IF NOT EXISTS launch_network_at ON launch_network(json_extract(body, '$.at'));
      CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,at TEXT NOT NULL,account TEXT,action TEXT NOT NULL,target TEXT,status TEXT NOT NULL,detail TEXT);`);
    // Preserve old records for upgrades; the scheduler and its API are removed.
    this.db.exec(
      "UPDATE tasks SET body=json_set(body, '$.enabled', json('false')) WHERE json_valid(body)",
    );
  }
  config(key, value) {
    if (value !== undefined)
      this.db
        .prepare("INSERT OR REPLACE INTO config VALUES(?,?)")
        .run(key, JSON.stringify(value));
    return JSON.parse(
      this.db.prepare("SELECT value FROM config WHERE key=?").get(key)?.value ??
        "null",
    );
  }
  encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  }
  decrypt(value) {
    const b = Buffer.from(value, "base64");
    const cipher = createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12));
    cipher.setAuthTag(b.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString(),
    );
  }
  setPassword(password) {
    const salt = randomBytes(16).toString("hex");
    this.config("admin", {
      salt,
      hash: scryptSync(password, salt, 64).toString("hex"),
    });
    this.db.exec("DELETE FROM sessions");
  }
  verifyPassword(password) {
    const a = this.config("admin");
    return (
      !!a &&
      timingSafeEqual(
        Buffer.from(a.hash, "hex"),
        scryptSync(password, a.salt, 64),
      )
    );
  }
  createSession() {
    this.db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    const token = randomBytes(32).toString("hex");
    const csrf = randomBytes(24).toString("hex");
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(this.hash(token), csrf, Date.now() + 12 * 3600 * 1000);
    return { token, csrf };
  }
  hash(token) {
    return createHash("sha256").update(token).digest("hex");
  }
  session(token) {
    if (!token) return null;
    return this.sessionByHash(this.hash(token));
  }
  sessionByHash(hash) {
    return (
      this.db
        .prepare("SELECT * FROM sessions WHERE hash=? AND expires>?")
        .get(hash, Date.now()) ?? null
    );
  }
  deleteSession(token) {
    if (token)
      this.db
        .prepare("DELETE FROM sessions WHERE hash=?")
        .run(this.hash(token));
  }
  accounts() {
    return this.db
      .prepare("SELECT id,meta FROM accounts")
      .all()
      .map((r) => ({ id: r.id, ...JSON.parse(r.meta) }));
  }
  account(id) {
    const r = this.db.prepare("SELECT * FROM accounts WHERE id=?").get(id);
    if (!r) {
      const e = new Error("AWS 账户不存在");
      e.status = 404;
      throw e;
    }
    return {
      id: r.id,
      ...JSON.parse(r.meta),
      credentials: this.decrypt(r.secret),
    };
  }
  saveAccount(meta, credentials, id = randomUUID()) {
    this.db
      .prepare("INSERT OR REPLACE INTO accounts VALUES(?,?,?)")
      .run(id, JSON.stringify(meta), this.encrypt(credentials));
    return { id, ...meta };
  }
  deleteAccount(id) {
    this.db.prepare("DELETE FROM accounts WHERE id=?").run(id);
  }
  audit({
    account = "",
    action,
    target = "",
    status = "success",
    detail = "",
  }) {
    this.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        new Date().toISOString(),
        account,
        action,
        target,
        status,
        detail.slice(0, 4000),
      );
    this.db.exec(
      "DELETE FROM audit WHERE id IN (SELECT id FROM audit ORDER BY at DESC LIMIT -1 OFFSET 5000)",
    );
  }
  logs() {
    return this.db
      .prepare("SELECT * FROM audit ORDER BY at DESC LIMIT 200")
      .all();
  }
  saveLaunchNetwork(job) {
    this.db
      .prepare("INSERT OR REPLACE INTO launch_network VALUES(?,?)")
      .run(job.id, JSON.stringify(job));
  }
  launchNetwork(id) {
    const row = this.db
      .prepare("SELECT body FROM launch_network WHERE id=?")
      .get(id);
    return row ? JSON.parse(row.body) : null;
  }
  latestInstanceJob(accountId, region, name) {
    const row = this.db
      .prepare(
        `SELECT body FROM launch_network
      WHERE json_extract(body, '$.accountId')=? AND json_extract(body, '$.region')=?
      AND (json_extract(body, '$.action')='launch' OR json_extract(body, '$.resource')='instances')
      AND EXISTS (SELECT 1 FROM json_each(body, '$.instances') WHERE json_extract(value, '$.name')=?)
      ORDER BY json_extract(body, '$.at') DESC LIMIT 1`,
      )
      .get(accountId, region, name);
    return row ? JSON.parse(row.body) : null;
  }
  launchNetworks({ pendingOnly = false, recentSince } = {}) {
    const query = pendingOnly
      ? "SELECT body FROM launch_network WHERE json_extract(body, '$.status')='pending'"
      : recentSince !== undefined
        ? "SELECT body FROM launch_network WHERE json_extract(body, '$.status')='pending' OR json_extract(body, '$.at')>?"
        : "SELECT body FROM launch_network";
    return this.db
      .prepare(query)
      .all(...(pendingOnly || recentSince === undefined ? [] : [recentSince]))
      .map((r) => JSON.parse(r.body));
  }
  close() {
    for (const stop of this.onClose) stop();
    this.db.close();
  }
}
