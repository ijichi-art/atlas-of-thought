import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";

// AES-256-GCM envelope format: base64(iv) "." base64(ciphertext) "." base64(authTag)
// IV is 12 bytes (GCM standard), auth tag is 16 bytes.

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

// Minimum acceptable length for ENCRYPTION_KEY input. Anything shorter is
// almost certainly a placeholder ("test", "secret", a single character)
// that would silently produce a guessable SHA-256 key. Reject early so we
// don't "succeed" with bad crypto.
const MIN_KEY_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to .env.local.",
    );
  }
  if (raw.length < MIN_KEY_LEN) {
    throw new Error(
      `ENCRYPTION_KEY is too short (${raw.length} chars). It must be at least ${MIN_KEY_LEN} characters of high-entropy input. Generate one with \`openssl rand -base64 32\`.`,
    );
  }
  // Accept any length input ≥ MIN_KEY_LEN but derive a stable 32-byte key
  // with SHA-256 so both a passphrase and a base64-32 string work.
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), ct.toString("base64"), tag.toString("base64")].join(".");
}

export function decrypt(envelope: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext envelope");
  }
  const [ivB64, ctB64, tagB64] = parts;
  const key = getKey();
  const iv = Buffer.from(ivB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

export function hintFromKey(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length <= 8) return "*".repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}
