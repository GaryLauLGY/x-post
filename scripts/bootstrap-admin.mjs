import process from "node:process";
import pg from "pg";
import { createPasswordRecord } from "../apps/api/dist/auth.js";

const { Pool } = pg;
const usernameIndex = process.argv.indexOf("--username");
const username = usernameIndex >= 0 ? process.argv[usernameIndex + 1] : "admin";
if (!username || !/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
  throw new Error("Invalid administrator username");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

let password = "";
for await (const chunk of process.stdin) password += chunk;
password = password.replace(/[\r\n]+$/u, "");
const record = await createPasswordRecord(password);
password = "";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await pool.query("BEGIN");
  const user = await pool.query(
    `INSERT INTO users (email, display_name, role, status)
     VALUES ($1, $2, 'admin', 'active')
     ON CONFLICT (email) DO UPDATE
       SET display_name = EXCLUDED.display_name, role = 'admin', status = 'active', updated_at = now()
     RETURNING id`,
    [`${username}@xpost.local`, username],
  );
  await pool.query(
    `INSERT INTO admin_credentials
       (user_id, username, password_salt, password_hash, scrypt_n, scrypt_r, scrypt_p)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (username) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           password_salt = EXCLUDED.password_salt,
           password_hash = EXCLUDED.password_hash,
           scrypt_n = EXCLUDED.scrypt_n,
           scrypt_r = EXCLUDED.scrypt_r,
           scrypt_p = EXCLUDED.scrypt_p,
           password_changed_at = now(),
           updated_at = now()`,
    [user.rows[0].id, username, record.salt, record.hash, record.n, record.r, record.p],
  );
  await pool.query("UPDATE admin_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [user.rows[0].id]);
  await pool.query(
    `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
     VALUES ('service', 'bootstrap-admin', 'admin.password.set', 'user', $1, jsonb_build_object('username', $2::text))`,
    [user.rows[0].id, username],
  );
  await pool.query("COMMIT");
  process.stdout.write("Administrator credential stored; existing sessions revoked.\n");
} catch (error) {
  await pool.query("ROLLBACK");
  throw error;
} finally {
  await pool.end();
}
