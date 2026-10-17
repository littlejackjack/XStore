/**
 * Cryptographic helpers.
 *
 * - `encryptSecret` / `decryptSecret`: AES-256-GCM envelope encryption used for
 *   every secret at rest (Marzban passwords, Bayar.gg / Resend API keys).
 *   The per-record salt is stretched with scrypt and stored alongside the
 *   ciphertext, so rotating the master key is a re-encrypt migration, and a
 *   database dump alone is useless without ENCRYPTION_KEY.
 * - `hmacSha256` / `safeEqual`: webhook signature verification (Bayar.gg).
 * - `sha256`: hashing of refresh tokens before persistence.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM
const SALT_LENGTH = 16;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export interface EncryptedEnvelope {
  v: 1;
  alg: typeof ALGORITHM;
  /** base64 scrypt salt (unique per record) */
  salt: string;
  /** base64 96-bit nonce */
  iv: string;
  /** base64 GCM auth tag */
  tag: string;
  /** base64 ciphertext */
  ct: string;
}

export class DecryptionError extends Error {
  constructor(message = 'Unable to decrypt value - wrong key or corrupted data') {
    super(message);
    this.name = 'DecryptionError';
  }
}

function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return scryptSync(masterKey, salt, KEY_LENGTH, SCRYPT_PARAMS);
}

/** Encrypts a UTF-8 string, returning a JSON envelope safe to store in a TEXT column. */
export function encryptSecret(plaintext: string, masterKey: string): string {
  if (!plaintext) throw new Error('Cannot encrypt an empty value');
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(masterKey, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const envelope: EncryptedEnvelope = {
    v: 1,
    alg: ALGORITHM,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ciphertext.toString('base64'),
  };
  return JSON.stringify(envelope);
}

/** Decrypts an envelope produced by {@link encryptSecret}. */
export function decryptSecret(envelopeJson: string, masterKey: string): string {
  let envelope: EncryptedEnvelope;
  try {
    envelope = JSON.parse(envelopeJson) as EncryptedEnvelope;
  } catch {
    throw new DecryptionError('Stored value is not a valid encryption envelope');
  }
  if (envelope.v !== 1 || envelope.alg !== ALGORITHM) {
    throw new DecryptionError('Unsupported encryption envelope');
  }

  const salt = Buffer.from(envelope.salt, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const ciphertext = Buffer.from(envelope.ct, 'base64');

  const key = deriveKey(masterKey, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    throw new DecryptionError();
  }
}

/** Tells whether a stored value is a valid envelope (vs. legacy plain text). */
export function isEncrypted(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as Partial<EncryptedEnvelope>;
    return parsed.v === 1 && parsed.alg === ALGORITHM && Boolean(parsed.ct);
  } catch {
    return false;
  }
}

export function hmacSha256Hex(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time string comparison - prevents timing attacks on secrets. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(String(a), 'utf8');
  const bufferB = Buffer.from(String(b), 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Masks a secret for safe display, e.g. `whsec_...abcd`. */
export function maskSecret(secret: string, visible = 4): string {
  if (!secret) return '';
  if (secret.length <= visible) return '*'.repeat(secret.length);
  return `${'*'.repeat(Math.min(secret.length - visible, 24))}${secret.slice(-visible)}`;
}
