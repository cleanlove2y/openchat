import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const SECRET_VERSION = "v1";
const IV_LENGTH = 12;

function getEncryptionKey(): Buffer {
  const rawSecret =
    process.env.USER_LLM_ENCRYPTION_KEY || process.env.AUTH_SECRET || "";

  if (!rawSecret) {
    throw new Error("Missing USER_LLM_ENCRYPTION_KEY or AUTH_SECRET");
  }

  return createHash("sha256").update(rawSecret).digest();
}

export function encryptSecret(plainText: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    SECRET_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptSecret(payload: string): string | null {
  try {
    const [version, ivBase64, tagBase64, encryptedBase64] = payload.split(":");

    if (
      version !== SECRET_VERSION ||
      !ivBase64 ||
      !tagBase64 ||
      !encryptedBase64
    ) {
      return null;
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(ivBase64, "base64url")
    );

    decipher.setAuthTag(Buffer.from(tagBase64, "base64url"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, "base64url")),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}
