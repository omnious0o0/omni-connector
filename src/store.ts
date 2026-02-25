import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PersistedData } from "./types";

const SECRET_PREFIX = "enc:v1:";
const SECRET_KEY_BYTES = 32;

function errnoCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function shouldIgnoreChmodError(error: unknown): boolean {
  const code = errnoCode(error);
  return code === "EPERM" || code === "ENOSYS" || code === "EINVAL";
}

export function createConnectorApiKey(): string {
  return `cxk_${crypto.randomBytes(24).toString("hex")}`;
}

function createDefaultStore(): PersistedData {
  const now = new Date().toISOString();

  return {
    connector: {
      apiKey: createConnectorApiKey(),
      createdAt: now,
      lastRotatedAt: now,
    },
    accounts: [],
  };
}

function isPersistedData(value: unknown): value is PersistedData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const parsed = value as Partial<PersistedData>;
  return Boolean(parsed.connector) && Array.isArray(parsed.accounts);
}

function decodeSecretKey(rawValue: string): Buffer | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  const base64Key = Buffer.from(trimmed, "base64");
  if (base64Key.length === SECRET_KEY_BYTES) {
    return base64Key;
  }

  const base64UrlKey = Buffer.from(trimmed, "base64url");
  if (base64UrlKey.length === SECRET_KEY_BYTES) {
    return base64UrlKey;
  }

  return null;
}

export class DataStore {
  private static warnedMissingEnvKey = false;
  private state: PersistedData;
  private readonly keyPath: string;
  private readonly secretKey: Buffer;

  public constructor(private readonly filePath: string) {
    this.keyPath = `${this.filePath}.key`;
    this.secretKey = this.resolveSecretKey();
    this.state = this.loadFromDisk();
  }

  public read(): PersistedData {
    return structuredClone(this.state);
  }

  public update(mutator: (draft: PersistedData) => void): PersistedData {
    const draft = structuredClone(this.state);
    mutator(draft);
    this.state = draft;
    this.persist();
    return structuredClone(this.state);
  }

  private loadFromDisk(): PersistedData {
    if (!fs.existsSync(this.filePath)) {
      const initialData = createDefaultStore();
      this.state = initialData;
      this.persist();
      return initialData;
    }

    const rawContents = fs.readFileSync(this.filePath, "utf8");

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContents) as unknown;
    } catch {
      return this.recoverFromCorruptStore();
    }

    if (!isPersistedData(parsed)) {
      return this.recoverFromCorruptStore();
    }

    let decrypted: { value: PersistedData; migrated: boolean };
    try {
      decrypted = this.decryptPersistedData(parsed);
    } catch {
      return this.recoverFromCorruptStore();
    }

    const { value, migrated } = decrypted;
    if (migrated) {
      this.state = value;
      this.persist();
    }

    return value;
  }

  private decryptPersistedData(data: PersistedData): { value: PersistedData; migrated: boolean } {
    const clone = structuredClone(data);
    let migrated = false;

    const connectorWasEncrypted = this.isEncryptedSecret(clone.connector.apiKey);
    clone.connector.apiKey = this.decryptSecret(clone.connector.apiKey);
    if (!connectorWasEncrypted) {
      migrated = true;
    }

    for (const account of clone.accounts) {
      const accessTokenWasEncrypted = this.isEncryptedSecret(account.accessToken);
      account.accessToken = this.decryptSecret(account.accessToken);
      if (!accessTokenWasEncrypted) {
        migrated = true;
      }

      if (account.refreshToken) {
        const refreshTokenWasEncrypted = this.isEncryptedSecret(account.refreshToken);
        account.refreshToken = this.decryptSecret(account.refreshToken);
        if (!refreshTokenWasEncrypted) {
          migrated = true;
        }
      }
    }

    return {
      value: clone,
      migrated,
    };
  }

  private recoverFromCorruptStore(): PersistedData {
    const initialData = createDefaultStore();
    const backupPath = `${this.filePath}.corrupt-${Date.now()}.json`;

    try {
      fs.renameSync(this.filePath, backupPath);
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") {
        throw error;
      }
    }

    this.state = initialData;
    this.persist();
    return initialData;
  }

  private resolveSecretKey(): Buffer {
    const envKey = process.env.DATA_ENCRYPTION_KEY;
    if (envKey) {
      const decoded = decodeSecretKey(envKey);
      if (!decoded) {
        throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes in base64, base64url, or hex.");
      }

      return decoded;
    }

    if (fs.existsSync(this.keyPath)) {
      this.warnMissingEnvKeyForProduction();
      const fileContents = fs.readFileSync(this.keyPath, "utf8");
      const decoded = decodeSecretKey(fileContents);
      if (!decoded) {
        throw new Error(`Invalid data encryption key at ${this.keyPath}.`);
      }

      return decoded;
    }

    const generated = crypto.randomBytes(SECRET_KEY_BYTES);
    this.warnMissingEnvKeyForProduction();
    const keyDirectoryPath = path.dirname(this.keyPath);
    fs.mkdirSync(keyDirectoryPath, { recursive: true });
    fs.writeFileSync(this.keyPath, generated.toString("base64url"), {
      encoding: "utf8",
      mode: 0o600,
    });

    try {
      fs.chmodSync(this.keyPath, 0o600);
    } catch (error) {
      if (!shouldIgnoreChmodError(error)) {
        throw error;
      }
    }

    return generated;
  }

  private warnMissingEnvKeyForProduction(): void {
    if (DataStore.warnedMissingEnvKey) {
      return;
    }

    if ((process.env.NODE_ENV ?? "").toLowerCase() !== "production") {
      return;
    }

    DataStore.warnedMissingEnvKey = true;
    process.stderr.write("DATA_ENCRYPTION_KEY is not set in production. Using file-based key storage at runtime.\n");
  }

  private isEncryptedSecret(value: string): boolean {
    return value.startsWith(SECRET_PREFIX);
  }

  private encryptSecret(value: string): string {
    if (this.isEncryptedSecret(value)) {
      return value;
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.secretKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${SECRET_PREFIX}${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`;
  }

  private decryptSecret(value: string): string {
    if (!this.isEncryptedSecret(value)) {
      return value;
    }

    const payload = value.slice(SECRET_PREFIX.length);
    const parts = payload.split(":");
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted secret payload.");
    }

    const ivPart = parts[0];
    const authTagPart = parts[1];
    const encryptedPart = parts[2];
    if (!ivPart || !authTagPart || !encryptedPart) {
      throw new Error("Invalid encrypted secret payload.");
    }
    const iv = Buffer.from(ivPart, "base64url");
    const authTag = Buffer.from(authTagPart, "base64url");
    const encrypted = Buffer.from(encryptedPart, "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.secretKey, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }

  private persist(): void {
    const directoryPath = path.dirname(this.filePath);
    fs.mkdirSync(directoryPath, { recursive: true });

    const serialized = structuredClone(this.state);
    serialized.connector.apiKey = this.encryptSecret(serialized.connector.apiKey);
    for (const account of serialized.accounts) {
      account.accessToken = this.encryptSecret(account.accessToken);
      if (account.refreshToken) {
        account.refreshToken = this.encryptSecret(account.refreshToken);
      }
    }

    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(serialized, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, this.filePath);

    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch (error) {
      if (!shouldIgnoreChmodError(error)) {
        throw error;
      }
    }
  }
}
