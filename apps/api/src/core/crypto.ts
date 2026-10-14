import { hash, verify } from '@node-rs/argon2';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH } from '@hydris/domain';

// argon2id with OWASP-recommended baseline parameters.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashPassword = (pw: string) => hash(pw, ARGON);
export const verifyPassword = async (pw: string, h: string) => {
  try {
    return await verify(h, pw);
  } catch {
    return false;
  }
};
let dummy: string | null = null;
/** Burn equivalent time when a user does not exist so timing does not reveal valid emails. */
export async function dummyVerify(pw: string) {
  dummy ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(pw, dummy);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Uniformly random pairing code from the unambiguous alphabet (CSPRNG). */
export function pairingCode(): string {
  let s = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) s += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  return s;
}

export function passwordProblems(pw: string): string | null {
  if (pw.length < 12) return 'Use at least 12 characters';
  if (pw.length > 200) return 'Password is too long';
  if (/^(.)\1+$/.test(pw)) return 'Password is too repetitive';
  return null;
}

// ---- AES-256-GCM for secrets at rest (MFA seeds) ----
export function encrypt(plain: string, keyHex: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}
export function decrypt(token: string, keyHex: string): string {
  const [iv, tag, enc] = token.split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(enc!), d.final()]).toString('utf8');
}

// ---- TOTP (RFC 6238, SHA-1, 30 s, 6 digits) ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totp(secretB32: string, at = Date.now(), step = 30): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)));
  const h = createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  const code = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}
export function verifyTotp(secretB32: string, code: string, at = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((w) => safeEqual(totp(secretB32, at + w * 30_000), code));
}
export const newTotpSecret = () => base32Encode(randomBytes(20));
