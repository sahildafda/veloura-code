import crypto from "node:crypto";
import os from "node:os";

/**
 * Derives a machine and user-specific key for local AES-256-GCM encryption.
 * This ensures that credentials stored in encrypted files cannot easily be copied
 * to another machine or used by another user profile.
 */
function deriveLocalKey(salt: Buffer): Buffer {
  const machineFingerprint = [
    os.hostname(),
    os.userInfo().username,
    os.platform(),
    os.arch(),
    os.homedir(),
  ].join("|");

  return crypto.scryptSync(machineFingerprint, salt, 32);
}

export interface EncryptedPayload {
  version: number;
  iv: string;
  tag: string;
  salt: string;
  data: string;
}

/**
 * Encrypts sensitive text using AES-256-GCM with authenticated tag.
 */
export function encryptData(plainText: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveLocalKey(salt);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    version: 1,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    salt: salt.toString("hex"),
    data: encrypted.toString("hex"),
  };

  return JSON.stringify(payload);
}

/**
 * Decrypts an AES-256-GCM payload.
 */
export function decryptData(payloadJson: string): string {
  const payload: EncryptedPayload = JSON.parse(payloadJson);
  if (payload.version !== 1) {
    throw new Error(`Unsupported encryption payload version: ${payload.version}`);
  }

  const salt = Buffer.from(payload.salt, "hex");
  const iv = Buffer.from(payload.iv, "hex");
  const tag = Buffer.from(payload.tag, "hex");
  const encrypted = Buffer.from(payload.data, "hex");
  const key = deriveLocalKey(salt);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
