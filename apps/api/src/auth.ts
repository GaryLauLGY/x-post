import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "__Host-xpost_session";
export const CSRF_COOKIE_NAME = "__Host-xpost_csrf";
export const PASSWORD_SCRYPT = { n: 32768, r: 8, p: 1 } as const;

function scryptPassword(password: string, salt: Buffer, n: number, r: number, p: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, 64, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export async function createPasswordRecord(password: string) {
  if (password.length < 16) throw new Error("Administrator password must contain at least 16 characters");
  const salt = randomBytes(24);
  const hash = await scryptPassword(password, salt, PASSWORD_SCRYPT.n, PASSWORD_SCRYPT.r, PASSWORD_SCRYPT.p);
  return { salt, hash, ...PASSWORD_SCRYPT };
}

export async function verifyPassword(
  password: string,
  record: { salt: Buffer; hash: Buffer; n: number; r: number; p: number },
) {
  const candidate = await scryptPassword(password, record.salt, record.n, record.r, record.p);
  return candidate.length === record.hash.length && timingSafeEqual(candidate, record.hash);
}

export function createSessionSecrets() {
  return {
    token: randomBytes(32).toString("base64url"),
    csrf: randomBytes(32).toString("base64url"),
  };
}

export function hashSecret(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function parseCookies(header: string | undefined) {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!key) continue;
    try {
      cookies.set(key, decodeURIComponent(value));
    } catch {
      cookies.set(key, value);
    }
  }
  return cookies;
}

export function sessionCookie(token: string, maxAgeSeconds: number) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function csrfCookie(token: string, maxAgeSeconds: number) {
  return `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCsrfCookie() {
  return `${CSRF_COOKIE_NAME}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
}
