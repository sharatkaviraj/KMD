/**
 * Auth rows copied from the fees app are SECRETS, not just personal data
 * (plan I-5, critique0 #28). They never sit in a run folder in clear:
 *
 *  - sealed with AES-256-GCM under a key kept in the secrets folder
 *    (`%USERPROFILE%\.schoolfees-secrets\vppsone-migration.key`, created on
 *    first use, never in a run folder and never printed);
 *  - written to `<run>\secrets\*.enc`;
 *  - deleted by `purgeSecrets(run)` after a load applies them, and by
 *    `load-snapshot --purge-secrets`.
 *
 * The REST extractor cannot read password hashes at all (GoTrue's admin list
 * does not return them), so today these files hold ids, emails, phones,
 * metadata and identities. The direct-Postgres path, if it is ever used,
 * would add hashes; the same box holds them.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { FEES_SECRETS_FILE } from "./env.mjs";

export const KEY_FILE = path.join(path.dirname(FEES_SECRETS_FILE), "vppsone-migration.key");

export function loadOrCreateKey(file = KEY_FILE) {
  if (existsSync(file)) {
    const key = Buffer.from(readFileSync(file, "utf8").trim(), "base64");
    if (key.length !== 32) throw new Error("The migration secrets key is not 32 bytes.");
    return key;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(file, key.toString("base64"), { mode: 0o600 });
  return key;
}

/** Pure: seal / open a Buffer or string. Layout: 12-byte iv | 16-byte tag | ciphertext. */
export function seal(plaintext, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function open(sealed, key) {
  const iv = sealed.subarray(0, 12);
  const tag = sealed.subarray(12, 28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}

export function secretsDir(run) {
  return path.join(run, "secrets");
}

export function writeSecretJson(run, name, value, key = loadOrCreateKey()) {
  const dir = secretsDir(run);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json.enc`);
  writeFileSync(file, seal(JSON.stringify(value), key), { mode: 0o600 });
  return file;
}

export function readSecretJson(run, name, key = loadOrCreateKey()) {
  const file = path.join(secretsDir(run), `${name}.json.enc`);
  if (!existsSync(file)) return null;
  return JSON.parse(open(readFileSync(file), key).toString("utf8"));
}

/** Delete a run's secrets folder. Returns true if something was removed. */
export function purgeSecrets(run) {
  const dir = secretsDir(run);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
