#!/usr/bin/env node
/**
 * The school's recovery key, on the administrator's own computer (D-333).
 *
 *   npm run recovery -- keygen --out <folder>
 *       Makes an RSA-4096 key pair. The private half never leaves <folder>:
 *       copy it to two offline places (a USB stick in the office safe, a
 *       printed copy of the file) and nowhere online. Prints the SQL that
 *       gives VPPS One the PUBLIC half.
 *
 *   npm run recovery -- open --key <private.pem> --in <copy.sealed> --out <file> [--sha256 <hex>]
 *       Opens one sealed copy. With --sha256, refuses unless the bytes match.
 *
 *   npm run recovery -- verify --key <private.pem> --dir <folder> --expect <list.json>
 *       Opens every copy listed in <list.json> — [{ "path", "sha256" }, …],
 *       exported from student_documents (backup_path, content_sha256) — and
 *       checks each against its recorded sha256. Writes nothing. This is the
 *       restore test: run it after making the key and once a term.
 *
 *   Add --passphrase-env <NAME> to any command to protect the private key with
 *   the passphrase held in that environment variable (never on the command
 *   line, where it lands in shell history). Optional: a forgotten passphrase
 *   is a lost key. On Windows the file permissions below do not restrict who
 *   can read the file, which is one more reason it lives on a USB stick.
 *
 * Nothing here talks to the network.
 */

import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  checkRecoveryPublicKey,
  openWithRecoveryKey,
} from "../src/modules/archives/domain/recovery-envelope.ts";

const [command, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(
  rest.flatMap((value, index, all) => (value.startsWith("--") ? [[value.slice(2), all[index + 1]]] : [])),
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const passphrase = flags["passphrase-env"] ? process.env[flags["passphrase-env"]] : undefined;
if (flags["passphrase-env"] && !passphrase) {
  console.error(`Environment variable ${flags["passphrase-env"]} is empty.`);
  process.exit(1);
}
const privateKeyOf = (path) => (passphrase ? { key: readFileSync(path, "utf8"), passphrase } : readFileSync(path, "utf8"));

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (command === "keygen") {
  const folder = resolve(flags.out ?? fail("--out <folder> is required"));
  mkdirSync(folder, { recursive: true });
  const privatePath = join(folder, "vppsone-recovery-private.pem");
  if (existsSync(privatePath)) fail(`${privatePath} already exists. Refusing to replace a recovery key.`);

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: passphrase
      ? { type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase }
      : { type: "pkcs8", format: "pem" },
  });
  writeFileSync(privatePath, privateKey, { mode: 0o600 });
  writeFileSync(join(folder, "vppsone-recovery-public.pem"), publicKey);

  const checked = checkRecoveryPublicKey(publicKey);
  if (!checked.ok) fail("The new key failed its own check.");
  console.log(`Recovery key made in ${folder}`);
  console.log(`Fingerprint: ${checked.fingerprint}`);
  console.log("Keep vppsone-recovery-private.pem offline, in two places. Never upload it anywhere.");
  console.log("\nGive VPPS One the public half (safe to share):\n");
  console.log(
    `update vppsone.file_storage_settings set recovery_public_key = $$${publicKey.trim()}$$, ` +
      `recovery_key_fingerprint = '${checked.fingerprint}', updated_at = now() where id = 1;`,
  );
} else if (command === "open") {
  const key = privateKeyOf(flags.key ?? fail("--key <private.pem> is required"));
  const sealed = readFileSync(flags.in ?? fail("--in <copy.sealed> is required"));
  const plain = openWithRecoveryKey(key, sealed);
  if (flags.sha256 && sha256(plain) !== flags.sha256.toLowerCase()) fail("Opened, but the bytes do not match --sha256.");
  writeFileSync(flags.out ?? fail("--out <file> is required"), plain);
  console.log(`Opened ${plain.byteLength} bytes, sha256 ${sha256(plain)}`);
} else if (command === "verify") {
  const key = privateKeyOf(flags.key ?? fail("--key <private.pem> is required"));
  const folder = resolve(flags.dir ?? fail("--dir <folder> is required"));
  const expected = JSON.parse(readFileSync(flags.expect ?? fail("--expect <list.json> is required"), "utf8"));
  let good = 0;
  const bad = [];
  for (const entry of expected) {
    try {
      const plain = openWithRecoveryKey(key, readFileSync(join(folder, entry.path)));
      if (sha256(plain) === entry.sha256) good += 1;
      else bad.push(`${entry.path}: opened, different bytes`);
    } catch (error) {
      bad.push(`${entry.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`${good} of ${expected.length} copies open and match their recorded sha256.`);
  for (const line of bad) console.log(`  FAILED ${line}`);
  process.exit(bad.length === 0 ? 0 : 1);
} else {
  fail("Usage: npm run recovery -- keygen --out <folder> | open … | verify … (see the top of scripts/recovery-key.mjs)");
}
