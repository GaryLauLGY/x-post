import path from "node:path";
import process from "node:process";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import pg, { type PoolClient } from "pg";
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  clearCsrfCookie,
  clearSessionCookie,
  createSessionSecrets,
  csrfCookie,
  hashSecret,
  parseCookies,
  sessionCookie,
  verifyPassword,
} from "./auth.js";

const { Pool } = pg;
type Cursor = { value: string; id: string };
type AdminUser = { id: string; username: string; displayName: string; role: string; csrf: string };

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: unknown): Cursor | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed.value !== "string" || typeof parsed.id !== "string") throw new Error("invalid cursor");
    return parsed;
  } catch {
    const error = new Error("Invalid cursor");
    Object.assign(error, { statusCode: 400, code: "INVALID_CURSOR" });
    throw error;
  }
}

function asString(value: unknown, max = 5000) {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

function asStringArray(value: unknown, maxItems = 20) {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string").slice(0, maxItems).map((item) => item.slice(0, 80));
}

function asNonNegativeInteger(value: unknown) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function publicMaterial(row: Record<string, unknown>) {
  return {
    id: row.id,
    platformPostId: row.platform_post_id,
    text: row.edited_text ?? row.original_text,
    originalText: row.original_text,
    publishedAt: row.published_at,
    category: row.category,
    tags: row.tags,
    sourceUrl: row.source_url,
    sourceAuthor: {
      id: row.source_author_id,
      handle: row.author_handle,
      displayName: row.author_display_name,
      avatarUrl: row.author_avatar_object_key ? `/api/v1/media/${row.author_avatar_object_key}` : null,
    },
    metrics: {
      views: row.views,
      replies: row.replies,
      reposts: row.reposts,
      likes: row.likes,
      bookmarks: row.bookmarks,
      observedAt: row.observed_at,
    },
  };
}

export function buildServer(options: { databaseUrl?: string; mediaRoot?: string } = {}): FastifyInstance {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const mediaRoot = path.resolve(options.mediaRoot ?? process.env.XPOST_MEDIA_ROOT ?? "data/media");
  const publicOrigin = process.env.XPOST_PUBLIC_ORIGIN ?? "https://xpost.garylau.ai";
  const sessionTtlHours = Math.min(72, Math.max(1, Number(process.env.XPOST_SESSION_TTL_HOURS ?? 12)));
  const sessionTtlSeconds = sessionTtlHours * 3600;
  const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.XPOST_DB_POOL_SIZE ?? 10) });
  const adminUsers = new WeakMap<FastifyRequest, AdminUser>();
  const loginAttempts = new Map<string, { count: number; blockedUntil: number }>();
  const app = Fastify({
    bodyLimit: 8 * 1024 * 1024,
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "req.headers.cookie", "req.headers['x-csrf-token']", "res.headers['set-cookie']"],
    },
    requestIdHeader: "x-request-id",
    trustProxy: ["127.0.0.1", "::1"],
  });

  app.register(fastifyStatic, { root: mediaRoot, prefix: "/api/v1/media/", decorateReply: false });

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    reply.header("Cache-Control", "no-store");
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = Number((error as { statusCode?: number }).statusCode ?? 500);
    const code = String((error as { code?: string }).code ?? (statusCode >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST"));
    const message = error instanceof Error ? error.message : "Bad request";
    if (statusCode >= 500) request.log.error({ err: error }, "request failed");
    reply.status(statusCode).send({
      error: { code, message: statusCode >= 500 ? "Internal server error" : message, requestId: request.id },
    });
  });

  function requireSameOrigin(request: FastifyRequest) {
    if (request.headers.origin !== publicOrigin) {
      const error = new Error("Invalid request origin");
      Object.assign(error, { statusCode: 403, code: "INVALID_ORIGIN" });
      throw error;
    }
  }

  async function resolveAdmin(request: FastifyRequest) {
    const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE_NAME);
    if (!token) return null;
    const result = await pool.query(
      `SELECT s.id AS session_id, s.csrf_hash, u.id, u.display_name, u.role, u.status, c.username
         FROM admin_sessions s
         JOIN users u ON u.id = s.user_id
         JOIN admin_credentials c ON c.user_id = u.id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [hashSecret(token)],
    );
    const row = result.rows[0];
    if (!row || row.status !== "active" || row.role !== "admin") return null;
    const csrf = parseCookies(request.headers.cookie).get(CSRF_COOKIE_NAME) ?? "";
    const user: AdminUser = {
      id: row.id,
      username: row.username,
      displayName: row.display_name ?? row.username,
      role: row.role,
      csrf,
    };
    Object.defineProperty(user, "csrfHash", { value: row.csrf_hash, enumerable: false });
    await pool.query("UPDATE admin_sessions SET last_seen_at = now() WHERE id = $1", [row.session_id]);
    return user as AdminUser & { csrfHash: Buffer };
  }

  async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
    const user = await resolveAdmin(request);
    if (!user) {
      return reply.status(401).send({ error: { code: "AUTH_REQUIRED", message: "Administrator login required", requestId: request.id } });
    }
    adminUsers.set(request, user);
  }

  async function requireAdminWrite(request: FastifyRequest, reply: FastifyReply) {
    requireSameOrigin(request);
    const user = await resolveAdmin(request);
    if (!user) {
      return reply.status(401).send({ error: { code: "AUTH_REQUIRED", message: "Administrator login required", requestId: request.id } });
    }
    const csrf = request.headers["x-csrf-token"];
    if (typeof csrf !== "string" || !csrf || csrf !== user.csrf || !hashSecret(csrf).equals(user.csrfHash)) {
      return reply.status(403).send({ error: { code: "CSRF_INVALID", message: "Invalid CSRF token", requestId: request.id } });
    }
    adminUsers.set(request, user);
  }

  async function audit(
    request: FastifyRequest,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata: object = {},
    executor: PoolClient | typeof pool = pool,
  ) {
    const user = adminUsers.get(request);
    if (!user) throw new Error("Missing authenticated administrator");
    await executor.query(
      `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
       VALUES ('user', $1, $2, $3, $4, $5::jsonb)`,
      [user.id, action, entityType, entityId, JSON.stringify(metadata)],
    );
  }

  app.get("/health/live", async () => ({ status: "ok", service: "x-post-api" }));

  app.get("/health/ready", async (_request, reply) => {
    try {
      const result = await pool.query("SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1");
      if (!result.rows[0]) throw new Error("No migration applied");
      return { status: "ready", database: "ok", migration: result.rows[0].version };
    } catch {
      return reply.status(503).send({ status: "not_ready", database: "unavailable" });
    }
  });

  app.get<{
    Querystring: { cursor?: string; limit?: string; author?: string; category?: string; q?: string; sort?: string };
  }>("/api/v1/materials", async (request, reply) => {
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.query.limit ?? "30", 10) || 30));
    const sort = request.query.sort === "views" ? "views" : "published";
    const cursor = decodeCursor(request.query.cursor);
    const values: unknown[] = [];
    const where = ["m.status = 'approved'", "m.content_type = 'pure_text'", "m.deleted_at IS NULL"];
    const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
    if (request.query.author) {
      const parameter = add(request.query.author.replace(/^@/, ""));
      where.push(`(sa.handle = ${parameter} OR sa.id::text = ${parameter} OR sa.display_name = ${parameter})`);
    }
    if (request.query.category) where.push(`m.category = ${add(request.query.category)}`);
    if (request.query.q) {
      const queryParameter = add(`%${request.query.q}%`);
      where.push(`(m.original_text ILIKE ${queryParameter} OR m.edited_text ILIKE ${queryParameter})`);
    }
    const countValues = [...values];
    const countWhere = [...where];
    if (cursor) {
      const cursorValue = add(cursor.value);
      const cursorId = add(cursor.id);
      where.push(sort === "views"
        ? `(COALESCE(mm.views, -1), m.id) < (${cursorValue}::bigint, ${cursorId}::uuid)`
        : `(m.published_at, m.id) < (${cursorValue}::timestamptz, ${cursorId}::uuid)`);
    }
    values.push(limit + 1);
    const order = sort === "views" ? "COALESCE(mm.views, -1) DESC, m.id DESC" : "m.published_at DESC, m.id DESC";
    const [result, totalResult] = await Promise.all([
      pool.query(
        `SELECT m.*, sa.handle AS author_handle, sa.display_name AS author_display_name,
                sa.avatar_object_key AS author_avatar_object_key,
                mm.views, mm.replies, mm.reposts, mm.likes, mm.bookmarks, mm.observed_at
           FROM materials m JOIN source_authors sa ON sa.id = m.source_author_id
           LEFT JOIN material_current_metrics mm ON mm.material_id = m.id
          WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT $${values.length}`,
        values,
      ),
      pool.query(
        `SELECT count(*)::integer AS total FROM materials m JOIN source_authors sa ON sa.id = m.source_author_id
          WHERE ${countWhere.join(" AND ")}`,
        countValues,
      ),
    ]);
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    reply.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return {
      data: rows.map(publicMaterial),
      page: {
        limit,
        total: totalResult.rows[0]?.total ?? rows.length,
        hasMore,
        nextCursor: hasMore && last
          ? encodeCursor({ value: String(sort === "views" ? last.views ?? -1 : last.published_at.toISOString()), id: last.id })
          : null,
      },
    };
  });

  app.get<{ Params: { id: string } }>("/api/v1/materials/:id", async (request, reply) => {
    const result = await pool.query(
      `SELECT m.*, sa.handle AS author_handle, sa.display_name AS author_display_name,
              sa.avatar_object_key AS author_avatar_object_key,
              mm.views, mm.replies, mm.reposts, mm.likes, mm.bookmarks, mm.observed_at
         FROM materials m JOIN source_authors sa ON sa.id = m.source_author_id
         LEFT JOIN material_current_metrics mm ON mm.material_id = m.id
        WHERE m.id = $1 AND m.status = 'approved' AND m.content_type = 'pure_text' AND m.deleted_at IS NULL`,
      [request.params.id],
    );
    if (!result.rows[0]) return reply.status(404).send({ error: { code: "MATERIAL_NOT_FOUND", message: "Material not found", requestId: request.id } });
    reply.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return { data: publicMaterial(result.rows[0]) };
  });

  app.get("/api/v1/source-authors", async (_request, reply) => {
    const result = await pool.query(
      `SELECT id, handle, display_name, profile_url, avatar_object_key, minimum_impressions
         FROM source_authors WHERE enabled = true ORDER BY display_name`,
    );
    reply.header("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    return { data: result.rows.map((row) => ({
      id: row.id, handle: row.handle, displayName: row.display_name, profileUrl: row.profile_url,
      avatarUrl: row.avatar_object_key ? `/api/v1/media/${row.avatar_object_key}` : null,
      minimumImpressions: row.minimum_impressions,
    })) };
  });

  app.get("/api/v1/publishing-accounts", async (_request, reply) => {
    const result = await pool.query(
      `SELECT id, name, handle, avatar_object_key, verified, name_tag, accent
         FROM publishing_accounts WHERE enabled = true ORDER BY name`,
    );
    reply.header("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    return { data: result.rows.map((row) => ({
      id: row.id, name: row.name, handle: row.handle,
      avatarUrl: row.avatar_object_key ? `/api/v1/media/${row.avatar_object_key}` : null,
      verified: row.verified, label: row.name_tag, accent: row.accent,
    })) };
  });

  app.get("/api/v1/backgrounds", async (_request, reply) => {
    const result = await pool.query(
      `SELECT id, title, object_key, mime_type, width, height, sha256, source_url, license_note
         FROM backgrounds WHERE status = 'active' ORDER BY created_at, title`,
    );
    reply.header("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    return { data: result.rows.map((row) => ({ ...row, url: `/api/v1/media/${row.object_key}` })) };
  });

  app.post<{ Body: { username?: string; password?: string } }>("/api/v1/auth/login", async (request, reply) => {
    requireSameOrigin(request);
    const ipValue = request.headers["cf-connecting-ip"];
    const ip = typeof ipValue === "string" ? ipValue : request.ip;
    const key = `${ip}:${String(request.body?.username ?? "").toLowerCase()}`;
    const attempt = loginAttempts.get(key);
    if (attempt && attempt.blockedUntil > Date.now()) {
      return reply.status(429).send({ error: { code: "LOGIN_RATE_LIMITED", message: "Too many login attempts", requestId: request.id } });
    }
    const username = asString(request.body?.username, 64) ?? "";
    const password = asString(request.body?.password, 1024) ?? "";
    const result = await pool.query(
      `SELECT c.user_id, c.password_salt, c.password_hash, c.scrypt_n, c.scrypt_r, c.scrypt_p,
              u.display_name, u.role, u.status
         FROM admin_credentials c JOIN users u ON u.id = c.user_id WHERE c.username = $1`,
      [username],
    );
    const row = result.rows[0];
    const valid = row && row.status === "active" && row.role === "admin" && await verifyPassword(password, {
      salt: row.password_salt, hash: row.password_hash, n: row.scrypt_n, r: row.scrypt_r, p: row.scrypt_p,
    });
    if (!valid) {
      const count = (attempt?.count ?? 0) + 1;
      loginAttempts.set(key, { count, blockedUntil: count >= 5 ? Date.now() + 15 * 60_000 : 0 });
      await new Promise((resolve) => setTimeout(resolve, 250));
      return reply.status(401).send({ error: { code: "LOGIN_FAILED", message: "Invalid username or password", requestId: request.id } });
    }
    loginAttempts.delete(key);
    const secrets = createSessionSecrets();
    const expiresAt = new Date(Date.now() + sessionTtlSeconds * 1000);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM admin_sessions WHERE expires_at <= now() OR revoked_at IS NOT NULL");
      await client.query(
        `INSERT INTO admin_sessions (user_id, token_hash, csrf_hash, expires_at) VALUES ($1, $2, $3, $4)`,
        [row.user_id, hashSecret(secrets.token), hashSecret(secrets.csrf), expiresAt],
      );
      await client.query("UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1", [row.user_id]);
      await client.query(
        `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
         VALUES ('user', $1, 'auth.login', 'session', NULL, '{}'::jsonb)`,
        [row.user_id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    reply.header("Set-Cookie", [sessionCookie(secrets.token, sessionTtlSeconds), csrfCookie(secrets.csrf, sessionTtlSeconds)]);
    return { data: { user: { username, displayName: row.display_name ?? username, role: row.role }, csrfToken: secrets.csrf, expiresAt } };
  });

  app.get("/api/v1/auth/session", { preHandler: requireAdmin }, async (request) => {
    const user = adminUsers.get(request)!;
    return { data: { user: { username: user.username, displayName: user.displayName, role: user.role }, csrfToken: user.csrf } };
  });

  app.post("/api/v1/auth/logout", { preHandler: requireAdminWrite }, async (request, reply) => {
    const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE_NAME);
    if (token) await pool.query("UPDATE admin_sessions SET revoked_at = now() WHERE token_hash = $1", [hashSecret(token)]);
    await audit(request, "auth.logout", "session", null);
    reply.header("Set-Cookie", [clearSessionCookie(), clearCsrfCookie()]);
    return { data: { loggedOut: true } };
  });

  app.get<{ Querystring: { status?: string; author?: string; category?: string; q?: string; limit?: string; offset?: string } }>(
    "/api/v1/admin/materials", { preHandler: requireAdmin }, async (request) => {
      const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 50)));
      const offset = Math.max(0, Number(request.query.offset ?? 0));
      const values: unknown[] = [];
      const where = ["1=1"];
      const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
      if (request.query.status) where.push(`m.status = ${add(request.query.status)}`);
      if (request.query.author) where.push(`sa.handle = ${add(request.query.author.replace(/^@/, ""))}`);
      if (request.query.category) where.push(`m.category = ${add(request.query.category)}`);
      if (request.query.q) where.push(`COALESCE(m.edited_text, m.original_text) ILIKE ${add(`%${request.query.q}%`)}`);
      const countValues = [...values];
      const countWhere = [...where];
      const limitParameter = add(limit);
      const offsetParameter = add(offset);
      const [rows, count] = await Promise.all([
        pool.query(
          `SELECT m.*, sa.handle AS author_handle, sa.display_name AS author_display_name,
                  sa.avatar_object_key AS author_avatar_object_key,
                  mm.views, mm.replies, mm.reposts, mm.likes, mm.bookmarks, mm.observed_at
             FROM materials m JOIN source_authors sa ON sa.id = m.source_author_id
             LEFT JOIN material_current_metrics mm ON mm.material_id = m.id
            WHERE ${where.join(" AND ")} ORDER BY m.published_at DESC, m.id DESC
            LIMIT ${limitParameter} OFFSET ${offsetParameter}`,
          values,
        ),
        pool.query(
          `SELECT count(*)::integer AS total FROM materials m JOIN source_authors sa ON sa.id = m.source_author_id WHERE ${countWhere.join(" AND ")}`,
          countValues,
        ),
      ]);
      return { data: rows.rows.map((row) => ({ ...publicMaterial(row), status: row.status, adminNote: row.admin_note, rejectionReason: row.rejection_reason, deletedAt: row.deleted_at, edited: Boolean(row.edited_text) })), page: { total: count.rows[0]?.total ?? 0, limit, offset } };
    },
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/admin/materials/:id", { preHandler: requireAdminWrite }, async (request, reply) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      const changedFields: string[] = [];
      const add = (name: string, value: unknown, cast = "") => { values.push(value); sets.push(`${name} = $${values.length}${cast}`); changedFields.push(name); };
      if (Object.hasOwn(request.body, "text")) add("edited_text", asString(request.body.text, 20000) || null);
      if (Object.hasOwn(request.body, "category")) add("category", asString(request.body.category, 120));
      if (Object.hasOwn(request.body, "tags")) add("tags", asStringArray(request.body.tags) ?? [], "::text[]");
      if (Object.hasOwn(request.body, "adminNote")) add("admin_note", asString(request.body.adminNote, 4000) || null);
      if (Object.hasOwn(request.body, "status")) {
        const status = asString(request.body.status, 20);
        if (!status || !["pending", "approved", "rejected", "archived"].includes(status)) return reply.status(400).send({ error: { code: "INVALID_STATUS", message: "Invalid material status", requestId: request.id } });
        add("status", status, "::material_status");
        if (status === "approved") { add("approved_by", adminUsers.get(request)!.id); sets.push("approved_at = now()"); }
      }
      if (Object.hasOwn(request.body, "rejectionReason")) add("rejection_reason", asString(request.body.rejectionReason, 1000) || null);
      if (request.body.restoreOriginal === true) { sets.push("edited_text = NULL"); changedFields.push("edited_text"); }
      if (!sets.length && !request.body.metrics) return reply.status(400).send({ error: { code: "NO_CHANGES", message: "No supported changes supplied", requestId: request.id } });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (sets.length) {
          values.push(request.params.id);
          const updated = await client.query(`UPDATE materials SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length} RETURNING id`, values);
          if (!updated.rows[0]) {
            await client.query("ROLLBACK");
            return reply.status(404).send({ error: { code: "MATERIAL_NOT_FOUND", message: "Material not found", requestId: request.id } });
          }
        }
        if (request.body.metrics && typeof request.body.metrics === "object") {
          const metrics = request.body.metrics as Record<string, unknown>;
          const parsed = ["views", "replies", "reposts", "likes", "bookmarks"].map((key) => asNonNegativeInteger(metrics[key]));
          if (parsed.some((value) => value === undefined)) throw Object.assign(new Error("Invalid metrics"), { statusCode: 400, code: "INVALID_METRICS" });
          await client.query(
            `INSERT INTO material_metrics (material_id, views, replies, reposts, likes, bookmarks, observed_at, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, now(), jsonb_build_object('source', 'admin'))`,
            [request.params.id, ...parsed],
          );
          changedFields.push("metrics");
        }
        await audit(request, "material.update", "material", request.params.id, { fields: changedFields }, client);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return { data: { id: request.params.id, updated: true } };
    },
  );

  for (const [route, status] of [["approve", "approved"], ["reject", "rejected"], ["archive", "archived"], ["restore", "pending"]] as const) {
    app.post<{ Params: { id: string }; Body: { reason?: string } }>(`/api/v1/admin/materials/:id/${route}`, { preHandler: requireAdminWrite }, async (request, reply) => {
      if (status === "rejected" && !asString(request.body?.reason, 1000)) return reply.status(400).send({ error: { code: "REJECTION_REASON_REQUIRED", message: "Rejection reason is required", requestId: request.id } });
      const result = await pool.query(
        `UPDATE materials SET status = $1::material_status, rejection_reason = $2,
          approved_by = CASE WHEN $1 = 'approved' THEN $3::uuid ELSE approved_by END,
          approved_at = CASE WHEN $1 = 'approved' THEN now() ELSE approved_at END,
          deleted_at = NULL, updated_at = now() WHERE id = $4 RETURNING id`,
        [status, status === "rejected" ? request.body.reason : null, adminUsers.get(request)!.id, request.params.id],
      );
      if (!result.rows[0]) return reply.status(404).send({ error: { code: "MATERIAL_NOT_FOUND", message: "Material not found", requestId: request.id } });
      await audit(request, `material.${route}`, "material", request.params.id, status === "rejected" ? { reason: request.body.reason } : {});
      return { data: { id: request.params.id, status } };
    });
  }

  app.delete<{ Params: { id: string } }>("/api/v1/admin/materials/:id", { preHandler: requireAdminWrite }, async (request, reply) => {
    const result = await pool.query("UPDATE materials SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id", [request.params.id]);
    if (!result.rows[0]) return reply.status(404).send({ error: { code: "MATERIAL_NOT_FOUND", message: "Material not found", requestId: request.id } });
    await audit(request, "material.soft_delete", "material", request.params.id);
    return { data: { id: request.params.id, deleted: true } };
  });

  app.get("/api/v1/admin/source-authors", { preHandler: requireAdmin }, async () => ({ data: (await pool.query("SELECT * FROM source_authors ORDER BY display_name")).rows }));
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/api/v1/admin/source-authors/:id", { preHandler: requireAdminWrite }, async (request, reply) => {
    const enabled = typeof request.body.enabled === "boolean" ? request.body.enabled : undefined;
    const threshold = asNonNegativeInteger(request.body.minimumImpressions);
    if (enabled === undefined && threshold === undefined) return reply.status(400).send({ error: { code: "NO_CHANGES", message: "No supported changes supplied", requestId: request.id } });
    const result = await pool.query(
      "UPDATE source_authors SET enabled = COALESCE($1, enabled), minimum_impressions = COALESCE($2, minimum_impressions), updated_at = now() WHERE id = $3 RETURNING *",
      [enabled, threshold, request.params.id],
    );
    if (!result.rows[0]) return reply.status(404).send({ error: { code: "AUTHOR_NOT_FOUND", message: "Author not found", requestId: request.id } });
    await audit(request, "source_author.update", "source_author", request.params.id, { enabled, minimumImpressions: threshold });
    return { data: result.rows[0] };
  });

  app.get("/api/v1/admin/publishing-accounts", { preHandler: requireAdmin }, async () => ({ data: (await pool.query("SELECT * FROM publishing_accounts ORDER BY name")).rows }));
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/api/v1/admin/publishing-accounts/:id", { preHandler: requireAdminWrite }, async (request, reply) => {
    const enabled = typeof request.body.enabled === "boolean" ? request.body.enabled : undefined;
    if (enabled === undefined) return reply.status(400).send({ error: { code: "NO_CHANGES", message: "No supported changes supplied", requestId: request.id } });
    const result = await pool.query("UPDATE publishing_accounts SET enabled = $1, updated_at = now() WHERE id = $2 RETURNING *", [enabled, request.params.id]);
    if (!result.rows[0]) return reply.status(404).send({ error: { code: "ACCOUNT_NOT_FOUND", message: "Account not found", requestId: request.id } });
    await audit(request, "publishing_account.update", "publishing_account", request.params.id, { enabled });
    return { data: result.rows[0] };
  });

  app.get("/api/v1/admin/backgrounds", { preHandler: requireAdmin }, async () => ({ data: (await pool.query("SELECT * FROM backgrounds ORDER BY created_at, title")).rows }));
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/api/v1/admin/backgrounds/:id", { preHandler: requireAdminWrite }, async (request, reply) => {
    const status = asString(request.body.status, 20);
    if (!status || !["active", "disabled"].includes(status)) return reply.status(400).send({ error: { code: "INVALID_STATUS", message: "Invalid background status", requestId: request.id } });
    const result = await pool.query("UPDATE backgrounds SET status = $1 WHERE id = $2 RETURNING *", [status, request.params.id]);
    if (!result.rows[0]) return reply.status(404).send({ error: { code: "BACKGROUND_NOT_FOUND", message: "Background not found", requestId: request.id } });
    await audit(request, "background.update", "background", request.params.id, { status });
    return { data: result.rows[0] };
  });

  app.get("/api/v1/admin/crawl-runs", { preHandler: requireAdmin }, async () => ({ data: (await pool.query(
    `SELECT cr.*, sa.handle, sa.display_name FROM crawl_runs cr LEFT JOIN source_authors sa ON sa.id = cr.source_author_id ORDER BY cr.created_at DESC LIMIT 100`,
  )).rows }));

  app.post<{ Body: { sourceAuthorId?: string; requestedSince?: string; requestedUntil?: string } }>("/api/v1/admin/crawl-runs", { preHandler: requireAdminWrite }, async (request, reply) => {
    const sourceAuthorId = asString(request.body?.sourceAuthorId, 64);
    const since = asString(request.body?.requestedSince, 64);
    const until = asString(request.body?.requestedUntil, 64);
    if (!sourceAuthorId || !since || !until || Number.isNaN(Date.parse(since)) || Number.isNaN(Date.parse(until)) || Date.parse(since) >= Date.parse(until)) {
      return reply.status(400).send({ error: { code: "INVALID_CRAWL_WINDOW", message: "A valid author and date window are required", requestId: request.id } });
    }
    const result = await pool.query(
      `INSERT INTO crawl_runs (source_author_id, requested_since, requested_until, status) VALUES ($1, $2, $3, 'planned') RETURNING *`,
      [sourceAuthorId, since, until],
    );
    await audit(request, "crawl_run.plan", "crawl_run", result.rows[0].id, { sourceAuthorId, since, until });
    return reply.status(201).send({ data: result.rows[0] });
  });

  app.post<{ Params: { id: string } }>("/api/v1/admin/crawl-runs/:id/retry", { preHandler: requireAdminWrite }, async (request, reply) => {
    const source = await pool.query("SELECT * FROM crawl_runs WHERE id = $1", [request.params.id]);
    if (!source.rows[0]) return reply.status(404).send({ error: { code: "CRAWL_RUN_NOT_FOUND", message: "Crawl run not found", requestId: request.id } });
    const result = await pool.query(
      `INSERT INTO crawl_runs (source_author_id, requested_since, requested_until, status) VALUES ($1, $2, $3, 'planned') RETURNING *`,
      [source.rows[0].source_author_id, source.rows[0].requested_since, source.rows[0].requested_until],
    );
    await audit(request, "crawl_run.retry", "crawl_run", result.rows[0].id, { retryOf: request.params.id });
    return reply.status(201).send({ data: result.rows[0] });
  });

  app.get("/api/v1/admin/audit-logs", { preHandler: requireAdmin }, async () => ({ data: (await pool.query("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200")).rows }));

  app.get("/api/v1/admin/overview", { preHandler: requireAdmin }, async () => {
    const result = await pool.query(
      `SELECT
        (SELECT count(*)::integer FROM materials WHERE deleted_at IS NULL) AS materials,
        (SELECT count(*)::integer FROM materials WHERE status = 'pending' AND deleted_at IS NULL) AS pending,
        (SELECT count(*)::integer FROM source_authors WHERE enabled) AS active_authors,
        (SELECT max(finished_at) FROM crawl_runs WHERE status = 'succeeded') AS last_crawl`,
    );
    return { data: result.rows[0] };
  });

  app.addHook("onClose", async () => { await pool.end(); });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildServer();
  const host = process.env.XPOST_API_HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.XPOST_API_PORT ?? "3002", 10);
  app.listen({ host, port }).catch((error) => {
    app.log.error(error);
    process.exitCode = 1;
  });
}
