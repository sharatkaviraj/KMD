import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  constants,
} from "node:crypto";

/**
 * Sealing a copy so that only the school can open it (D-333).
 *
 * The archive copies a Drive document into Supabase so that losing the Google
 * account does not lose the document. That copy is sealed for the school's
 * **recovery key**: a fresh AES-256-GCM key per file, wrapped with the
 * recovery key's RSA public half (OAEP, SHA-256). The app holds only the
 * public half, so it can make copies and can never read them back; the
 * private half is generated on the administrator's own computer
 * (`npm run recovery:keygen`) and kept offline. Restoring is
 * `npm run recovery:open` with that private key.
 *
 * Format, all in one buffer:
 *
 *   "VPPSENC1"        8 bytes  magic and version
 *   fingerprint      32 bytes  sha256 of the public key (SPKI DER)
 *   wrapped length    2 bytes  big-endian
 *   wrapped key       n bytes  RSA-OAEP(SHA-256) of the AES key
 *   iv               12 bytes
 *   tag              16 bytes  GCM authentication tag
 *   ciphertext        rest
 *
 * The fingerprint says which key a copy needs before anyone tries the wrong
 * one; the GCM tag makes any changed byte fail to open rather than open as
 * something else.
 */

const MAGIC = Buffer.from("VPPSENC1", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;

// A plain field rather than a constructor parameter property: Node runs this
// file directly for `npm run recovery`, and its type stripping refuses those.
export class RecoveryEnvelopeError extends Error {
  readonly kind: "not_sealed" | "wrong_key" | "tampered";

  constructor(kind: "not_sealed" | "wrong_key" | "tampered", message: string) {
    super(message);
    this.name = "RecoveryEnvelopeError";
    this.kind = kind;
  }
}

/** sha256 of the public key's DER encoding, as lowercase hex. */
export function recoveryKeyFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex");
}

/** Refuse a key too weak to protect children's records for years. */
export function checkRecoveryPublicKey(publicKeyPem: string): { ok: true; fingerprint: string } | { ok: false } {
  try {
    const key = createPublicKey(publicKeyPem);
    const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
    if (key.asymmetricKeyType !== "rsa" || bits < 3072) return { ok: false };
    return { ok: true, fingerprint: recoveryKeyFingerprint(publicKeyPem) };
  } catch {
    return { ok: false };
  }
}

export function sealForRecovery(publicKeyPem: string, plaintext: Uint8Array): Uint8Array {
  const fingerprint = Buffer.from(recoveryKeyFingerprint(publicKeyPem), "hex");
  const fileKey = randomBytes(32);
  const iv = randomBytes(IV_BYTES);
  const wrapped = publicEncrypt(
    { key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    fileKey,
  );
  const cipher = createCipheriv("aes-256-gcm", fileKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const length = Buffer.alloc(2);
  length.writeUInt16BE(wrapped.byteLength);
  fileKey.fill(0);
  return new Uint8Array(Buffer.concat([MAGIC, fingerprint, length, wrapped, iv, tag, ciphertext]));
}

/** The fingerprint a sealed copy was made for, without opening it. */
export function sealedFingerprint(sealed: Uint8Array): string {
  const buffer = Buffer.from(sealed);
  if (buffer.byteLength < MAGIC.byteLength + 34 || !buffer.subarray(0, MAGIC.byteLength).equals(MAGIC)) {
    throw new RecoveryEnvelopeError("not_sealed", "This is not a VPPS One sealed copy.");
  }
  return buffer.subarray(MAGIC.byteLength, MAGIC.byteLength + 32).toString("hex");
}

export function openWithRecoveryKey(privateKeyPem: string, sealed: Uint8Array): Uint8Array {
  const buffer = Buffer.from(sealed);
  const fingerprint = sealedFingerprint(sealed);
  const publicPem = createPublicKey(privateKeyPem).export({ type: "spki", format: "pem" }).toString();
  if (recoveryKeyFingerprint(publicPem) !== fingerprint) {
    throw new RecoveryEnvelopeError("wrong_key", `This copy was sealed for key ${fingerprint.slice(0, 16)}….`);
  }

  let at = MAGIC.byteLength + 32;
  const wrappedLength = buffer.readUInt16BE(at);
  at += 2;
  const wrapped = buffer.subarray(at, at + wrappedLength);
  at += wrappedLength;
  const iv = buffer.subarray(at, at + IV_BYTES);
  at += IV_BYTES;
  const tag = buffer.subarray(at, at + TAG_BYTES);
  at += TAG_BYTES;
  const ciphertext = buffer.subarray(at);

  try {
    const fileKey = privateDecrypt(
      { key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      wrapped,
    );
    const decipher = createDecipheriv("aes-256-gcm", fileKey, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    fileKey.fill(0);
    return new Uint8Array(plaintext);
  } catch {
    throw new RecoveryEnvelopeError("tampered", "The copy does not open: it was changed or damaged.");
  }
}
