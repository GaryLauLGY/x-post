import path from "node:path";
import process from "node:process";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import pg from "pg";

const { Pool } = pg;

type Cursor = { value: string; id: string };

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
      avatarUrl: row.author_avatar_object_key ? `/media/${row.author_avatar_object_key}` : null,
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
  const allowedOrigins = new Set(
    (process.env.XPOST_CORS_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.XPOST_DB_POOL_SIZE ?? 10) });
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
    },
    requestIdHeader: "x-request-id",
    trustProxy: false,
  });

  app.register(fastifyStatic, { root: mediaRoot, prefix: "/media/", decorateReply: false });

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
    }
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    reply.header("Cache-Control", "no-store");
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = Number((error as { statusCode?: number }).statusCode ?? 500);
    const code = String((error as { code?: string }).code ?? (statusCode >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST"));
    const message = error instanceof Error ? error.message : "Bad request";
    if (statusCode >= 500) request.log.error({ err: error }, "request failed");
    reply.status(statusCode).send({
      error: {
        code,
        message: statusCode >= 500 ? "Internal server error" : message,
        requestId: request.id,
      },
    });
  });

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
  }>("/api/v1/materials", async (request) => {
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.query.limit ?? "30", 10) || 30));
    const sort = request.query.sort === "views" ? "views" : "published";
    const cursor = decodeCursor(request.query.cursor);
    const values: unknown[] = [];
    const where = ["m.status = 'approved'", "m.content_type = 'pure_text'", "m.deleted_at IS NULL"];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };

    if (request.query.author) {
      const parameter = add(request.query.author.replace(/^@/, ""));
      where.push(`(sa.handle = ${parameter} OR sa.id::text = ${parameter} OR sa.display_name = ${parameter})`);
    }
    if (request.query.category) where.push(`m.category = ${add(request.query.category)}`);
    if (request.query.q) where.push(`m.original_text ILIKE ${add(`%${request.query.q}%`)}`);
    if (cursor) {
      const cursorValue = add(cursor.value);
      const cursorId = add(cursor.id);
      where.push(
        sort === "views"
          ? `(COALESCE(mm.views, -1), m.id) < (${cursorValue}::bigint, ${cursorId}::uuid)`
          : `(m.published_at, m.id) < (${cursorValue}::timestamptz, ${cursorId}::uuid)`,
      );
    }

    values.push(limit + 1);
    const order = sort === "views" ? "COALESCE(mm.views, -1) DESC, m.id DESC" : "m.published_at DESC, m.id DESC";
    const result = await pool.query(
      `SELECT m.*, sa.handle AS author_handle, sa.display_name AS author_display_name,
              sa.avatar_object_key AS author_avatar_object_key,
              mm.views, mm.replies, mm.reposts, mm.likes, mm.bookmarks, mm.observed_at
         FROM materials m
         JOIN source_authors sa ON sa.id = m.source_author_id
         LEFT JOIN material_current_metrics mm ON mm.material_id = m.id
        WHERE ${where.join(" AND ")}
        ORDER BY ${order}
        LIMIT $${values.length}`,
      values,
    );
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      data: rows.map(publicMaterial),
      page: {
        limit,
        hasMore,
        nextCursor:
          hasMore && last
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
         FROM materials m
         JOIN source_authors sa ON sa.id = m.source_author_id
         LEFT JOIN material_current_metrics mm ON mm.material_id = m.id
        WHERE m.id = $1 AND m.status = 'approved' AND m.content_type = 'pure_text' AND m.deleted_at IS NULL`,
      [request.params.id],
    );
    if (!result.rows[0]) {
      return reply.status(404).send({ error: { code: "MATERIAL_NOT_FOUND", message: "Material not found", requestId: request.id } });
    }
    return { data: publicMaterial(result.rows[0]) };
  });

  app.get("/api/v1/source-authors", async () => {
    const result = await pool.query(
      `SELECT id, handle, display_name, profile_url, avatar_object_key, minimum_impressions
         FROM source_authors WHERE enabled = true ORDER BY display_name`,
    );
    return {
      data: result.rows.map((row) => ({
        id: row.id,
        handle: row.handle,
        displayName: row.display_name,
        profileUrl: row.profile_url,
        avatarUrl: row.avatar_object_key ? `/media/${row.avatar_object_key}` : null,
        minimumImpressions: row.minimum_impressions,
      })),
    };
  });

  app.get("/api/v1/publishing-accounts", async () => {
    const result = await pool.query(
      `SELECT id, name, handle, avatar_object_key, verified, name_tag, accent
         FROM publishing_accounts WHERE enabled = true ORDER BY name`,
    );
    return {
      data: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        handle: row.handle,
        avatarUrl: row.avatar_object_key ? `/media/${row.avatar_object_key}` : null,
        verified: row.verified,
        label: row.name_tag,
        accent: row.accent,
      })),
    };
  });

  app.get("/api/v1/backgrounds", async () => {
    const result = await pool.query(
      `SELECT id, title, object_key, mime_type, width, height, sha256, source_url, license_note
         FROM backgrounds WHERE status = 'active' ORDER BY created_at, title`,
    );
    return { data: result.rows.map((row) => ({ ...row, url: `/media/${row.object_key}` })) };
  });

  app.get("/api/v1/admin/*", async (_request, reply) => {
    return reply.status(503).send({
      error: { code: "ADMIN_NOT_CONFIGURED", message: "Administrator authentication is not configured", requestId: _request.id },
    });
  });

  app.addHook("onClose", async () => {
    await pool.end();
  });

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
