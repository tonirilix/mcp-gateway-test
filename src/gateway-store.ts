import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Tool } from "@modelcontextprotocol/server";

export type UserId = "standard" | "admin";

type StoredUser = {
  role: UserId;
  passwordSalt: string;
  passwordHash: string;
  gatewayTokenHash?: string;
  credentials: Record<string, string>;
  enabledTools?: Record<string, boolean>;
};

type CatalogSnapshot = { tools: Tool[]; fingerprints: Record<string, string>; capturedAt: string };
type State = { users: Record<UserId, StoredUser>; catalogs?: Record<string, CatalogSnapshot> };

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function passwordHash(password: string, salt: string) {
  return scryptSync(password, Buffer.from(salt, "base64"), 32).toString("hex");
}

function equalHex(left: string, right: string) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export class GatewayStore {
  private readonly sessions = new Map<string, { userId: UserId; expiresAt: number }>();

  private constructor(
    private readonly file: string,
    private readonly key: Buffer,
    private readonly state: State,
    private readonly sessionTtlMs: number,
  ) {}

  static async open(options: {
    file: string;
    key: Buffer;
    seedPasswords: Record<UserId, string>;
    sessionTtlMs?: number;
  }) {
    if (options.key.length !== 32) throw new Error("Gateway encryption key must contain 32 bytes");
    const sessionTtlMs = options.sessionTtlMs ?? 8 * 60 * 60 * 1000;
    if (sessionTtlMs <= 0) throw new Error("Portal session lifetime must be positive");
    try {
      const state = JSON.parse(await readFile(options.file, "utf8")) as State;
      return new GatewayStore(options.file, options.key, state, sessionTtlMs);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const makeUser = (role: UserId): StoredUser => {
      const salt = randomBytes(16).toString("base64");
      return { role, passwordSalt: salt, passwordHash: passwordHash(options.seedPasswords[role], salt), credentials: {}, enabledTools: {} };
    };
    const store = new GatewayStore(options.file, options.key, {
      users: { standard: makeUser("standard"), admin: makeUser("admin") },
    }, sessionTtlMs);
    await store.save();
    return store;
  }

  authenticate(username: string, password: string): UserId | undefined {
    if (username !== "standard" && username !== "admin") return undefined;
    const user = this.state.users[username];
    const candidate = passwordHash(password, user.passwordSalt);
    return equalHex(candidate, user.passwordHash) ? username : undefined;
  }

  createSession(userId: UserId) {
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, { userId, expiresAt: Date.now() + this.sessionTtlMs });
    return token;
  }

  resolveSession(token: string | undefined) {
    if (!token) return undefined;
    const session = this.sessions.get(token);
    if (!session) return undefined;
    if (Date.now() >= session.expiresAt) {
      this.sessions.delete(token);
      return undefined;
    }
    return session.userId;
  }

  revokeSession(token: string | undefined) {
    if (token) this.sessions.delete(token);
  }

  async issueGatewayToken(userId: UserId) {
    const token = randomBytes(32).toString("base64url");
    this.state.users[userId].gatewayTokenHash = hash(token);
    await this.save();
    return token;
  }

  resolveGatewayToken(token: string | undefined): UserId | undefined {
    if (!token) return undefined;
    const candidate = hash(token);
    for (const userId of ["standard", "admin"] as const) {
      const stored = this.state.users[userId].gatewayTokenHash;
      if (stored && equalHex(candidate, stored)) return userId;
    }
    return undefined;
  }

  hasCredential(userId: UserId, integrationId: string) {
    return Boolean(this.state.users[userId].credentials[integrationId]);
  }

  isEnabled(userId: UserId, toolName: string) {
    return this.state.users[userId].enabledTools?.[toolName] === true;
  }

  async setEnabled(userId: UserId, toolName: string, enabled: boolean) {
    this.state.users[userId].enabledTools ??= {};
    this.state.users[userId].enabledTools[toolName] = enabled;
    await this.save();
  }

  getCatalog(integrationId: string) {
    return this.state.catalogs?.[integrationId];
  }

  async replaceCatalog(integrationId: string, tools: Tool[], fingerprints: Record<string, string>, invalidatedNames: string[]) {
    for (const userId of ["standard", "admin"] as const) {
      const enabled = this.state.users[userId].enabledTools;
      if (!enabled) continue;
      for (const name of invalidatedNames) delete enabled[name];
    }
    this.state.catalogs ??= {};
    this.state.catalogs[integrationId] = { tools, fingerprints, capturedAt: new Date().toISOString() };
    await this.save();
  }

  getCredential(userId: UserId, integrationId: string) {
    const encrypted = this.state.users[userId].credentials[integrationId];
    if (!encrypted) return undefined;
    const [ivText, tagText, ciphertext] = encrypted.split(":");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivText, "base64"));
    decipher.setAuthTag(Buffer.from(tagText, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
  }

  async setCredential(userId: UserId, integrationId: string, credential: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(credential, "utf8"), cipher.final()]);
    this.state.users[userId].credentials[integrationId] = [
      iv.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      ciphertext.toString("base64"),
    ].join(":");
    await this.save();
  }

  private async save() {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
