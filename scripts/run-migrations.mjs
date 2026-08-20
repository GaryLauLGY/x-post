import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationsDir = path.resolve("packages/database/migrations");
const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");
    const existing = await pool.query("SELECT sha256 FROM schema_migrations WHERE version = $1", [file]).catch(() => ({ rows: [] }));
    if (existing.rows[0]) {
      if (existing.rows[0].sha256 !== sha256) throw new Error(`Applied migration changed: ${file}`);
      console.log(JSON.stringify({ migration: file, status: "already_applied", sha256 }));
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations(version, sha256) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING",
        [file, sha256],
      );
      await client.query("COMMIT");
      console.log(JSON.stringify({ migration: file, status: "applied", sha256 }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
