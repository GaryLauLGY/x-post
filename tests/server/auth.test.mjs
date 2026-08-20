import assert from "node:assert/strict";
import test from "node:test";
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearCsrfCookie,
  clearSessionCookie,
  createPasswordRecord,
  createSessionSecrets,
  csrfCookie,
  hashSecret,
  parseCookies,
  sessionCookie,
  verifyPassword,
} from "../../apps/api/dist/auth.js";

test("administrator passwords use salted scrypt hashes", async () => {
  const password = "correct horse battery staple 2026";
  const first = await createPasswordRecord(password);
  const second = await createPasswordRecord(password);
  assert.notDeepEqual(first.salt, second.salt);
  assert.notDeepEqual(first.hash, second.hash);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("wrong password value", first), false);
});

test("session and csrf secrets are independent and hashable", () => {
  const first = createSessionSecrets();
  const second = createSessionSecrets();
  assert.notEqual(first.token, first.csrf);
  assert.notEqual(first.token, second.token);
  assert.equal(hashSecret(first.token).length, 32);
});

test("cookies have secure host-only attributes", () => {
  const session = sessionCookie("session-value", 3600);
  const csrf = csrfCookie("csrf-value", 3600);
  assert.match(session, new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(session, /HttpOnly/);
  assert.match(session, /Secure/);
  assert.match(session, /SameSite=Lax/);
  assert.doesNotMatch(session, /Domain=/);
  assert.match(csrf, new RegExp(`^${CSRF_COOKIE_NAME}=`));
  assert.doesNotMatch(csrf, /HttpOnly/);
  assert.match(clearSessionCookie(), /Max-Age=0/);
  assert.match(clearCsrfCookie(), /Max-Age=0/);
});

test("cookie parser handles encoded values without throwing", () => {
  const cookies = parseCookies("a=one%20two; broken=%E0%A4%A; c=three");
  assert.equal(cookies.get("a"), "one two");
  assert.equal(cookies.get("broken"), "%E0%A4%A");
  assert.equal(cookies.get("c"), "three");
});
