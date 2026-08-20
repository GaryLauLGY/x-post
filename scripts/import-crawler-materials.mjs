import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { stableUuid } from "../packages/material-pipeline/index.mjs";
import { normalizeHandle, persistedMaterialId, sha256Json, shouldAdvanceFromSummary, validateCandidatePayload } from "../packages/crawler-pipeline/index.mjs";

const { Pool } = pg;

function parseArgs(argv) {
  const options = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") options.dryRun = true;
    else if (value.startsWith("--")) {
      const key = value.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
      options[key] = argv[index + 1];
      index += 1;
    } else throw new Error(`Unexpected argument: ${value}`);
  }
  for (const key of ["payload", "crawlSummary", "verificationSummary", "author"]) {
    if (!options[key]) throw new Error(`--${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)} is required`);
  }
  if (!options.dryRun && !options.runId) throw new Error("--run-id is required");
  return options;
}

async function readJson(file) {
  return JSON.parse(await readFile(path.resolve(file), "utf8"));
}

const options = parseArgs(process.argv.slice(2));
const [payload, crawlSummary, verificationSummary] = await Promise.all([
  readJson(options.payload),
  readJson(options.crawlSummary),
  readJson(options.verificationSummary),
]);
const handle = normalizeHandle(options.author);
if (normalizeHandle(verificationSummary.expected_author) !== handle) throw new Error("Verification author mismatch");
if (verificationSummary.fail_closed !== true) throw new Error("Verification summary is not fail-closed");
if (crawlSummary.original_verification !== true) throw new Error("Strict original verification did not run");

if (options.dryRun) {
  const minimumImpressions = Number(options.minimumImpressions ?? 5000);
  const items = validateCandidatePayload(payload, { handle, minimumImpressions });
  console.log(JSON.stringify({ status: "dry_run", author: handle, items: items.length, watermarkAdvance: shouldAdvanceFromSummary(crawlSummary) }));
  process.exit(0);
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
let committed = false;

try {
  await client.query("BEGIN");
  const authorResult = await client.query(
    "SELECT id, handle, display_name, minimum_impressions FROM source_authors WHERE lower(handle::text) = $1 AND enabled = true",
    [handle],
  );
  const author = authorResult.rows[0];
  if (!author) throw new Error(`Enabled source author not found: ${handle}`);
  const items = validateCandidatePayload(payload, {
    handle: author.handle,
    minimumImpressions: Number(author.minimum_impressions),
  });
  if (Number(verificationSummary.verified_original_count ?? 0) < items.length) {
    throw new Error("Candidate count exceeds verified-original count");
  }

  let importedCount = 0;
  let updatedCount = 0;
  for (const item of items) {
    const materialId = stableUuid("material", `x:${item.postId}`);
    const result = await client.query(
      `INSERT INTO materials(
         id, platform, platform_post_id, source_author_id, source_url, original_text,
         published_at, content_type, category, tags, admin_note, status,
         verified_original, content_hash, first_seen_run_id, last_seen_run_id
       ) VALUES ($1,'x',$2,$3,$4,$5,$6,'pure_text','其他',$7,$8,'pending',true,$9,$10,$10)
       ON CONFLICT (platform, platform_post_id) DO UPDATE SET
         source_author_id = EXCLUDED.source_author_id,
         source_url = EXCLUDED.source_url,
         original_text = CASE WHEN materials.edited_text IS NULL THEN EXCLUDED.original_text ELSE materials.original_text END,
         published_at = EXCLUDED.published_at,
         verified_original = true,
         content_hash = CASE WHEN materials.edited_text IS NULL THEN EXCLUDED.content_hash ELSE materials.content_hash END,
         last_seen_run_id = EXCLUDED.last_seen_run_id,
         updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [
        materialId,
        item.postId,
        author.id,
        item.link,
        item.text,
        item.publishedAt,
        ["其他", author.display_name],
        "Codex 定时抓取：严格原创纯文字候选，等待管理员审核分类",
        item.contentHash,
        options.runId,
      ],
    );
    if (result.rows[0].inserted) importedCount += 1;
    else updatedCount += 1;
    const materialDatabaseId = persistedMaterialId(result);
    await client.query(
      `INSERT INTO material_metrics(material_id, views, replies, reposts, likes, bookmarks, observed_at, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (material_id, observed_at) DO UPDATE SET
         views = EXCLUDED.views, replies = EXCLUDED.replies, reposts = EXCLUDED.reposts,
         likes = EXCLUDED.likes, bookmarks = EXCLUDED.bookmarks, metadata = EXCLUDED.metadata`,
      [materialDatabaseId, item.metrics.views, item.metrics.replies, item.metrics.reposts, item.metrics.likes, item.metrics.bookmarks, item.observedAt, { source: "codex-crawler", crawlRunId: options.runId }],
    );
    const publicPayload = {
      platformPostId: item.postId,
      sourceUrl: item.link,
      originalText: item.text,
      publishedAt: item.publishedAt,
      observedAt: item.observedAt,
      metrics: item.metrics,
    };
    await client.query(
      `INSERT INTO material_raw_snapshots(material_id, schema_version, payload_hash, public_payload)
       VALUES ($1,'x-post/crawler-public/v1',$2,$3)
       ON CONFLICT (material_id, schema_version, payload_hash) DO NOTHING`,
      [materialDatabaseId, sha256Json(publicPayload), publicPayload],
    );
  }

  const decisionCounts = verificationSummary.decision_counts ?? {};
  for (const [reason, countValue] of Object.entries(decisionCounts)) {
    const count = Number(countValue ?? 0);
    if (reason === "verified_original" || !Number.isInteger(count) || count <= 0) continue;
    await client.query(
      `INSERT INTO crawl_quarantine(crawl_run_id, reason, public_metadata)
       VALUES ($1,$2,$3)`,
      [options.runId, `verification:${reason}`, { count, aggregate: true }],
    );
  }

  const status = crawlSummary.coverage_complete ? "succeeded" : "partial";
  await client.query(
    `UPDATE crawl_runs SET
       finished_at = now(), status = $2, coverage_complete = $3,
       profile_fallback_used = $4, partial_search_error = $5,
       strict_verification_complete = true, raw_count = $6, verified_count = $7,
       pure_text_count = $8, imported_count = $9, updated_count = $10,
       quarantined_count = $11, artifact_manifest_path = $12
     WHERE id = $1`,
    [
      options.runId,
      status,
      Boolean(crawlSummary.coverage_complete),
      Boolean(crawlSummary.profile_fallback_used),
      Boolean(crawlSummary.partial_search_error),
      Number(crawlSummary.raw_count ?? 0),
      Number(verificationSummary.verified_original_count ?? 0),
      items.length,
      importedCount,
      updatedCount,
      Number(verificationSummary.quarantined_count ?? 0),
      options.artifactManifest ?? null,
    ],
  );

  const watermarkAdvance = shouldAdvanceFromSummary(crawlSummary);
  if (watermarkAdvance) {
    const boundary = `${crawlSummary.next_incremental_stop_local_date}T00:00:00+08:00`;
    await client.query(
      `INSERT INTO crawl_watermarks(source_author_id, continuous_through, last_success_run_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (source_author_id) DO UPDATE SET
         continuous_through = GREATEST(crawl_watermarks.continuous_through, EXCLUDED.continuous_through),
         last_success_run_id = EXCLUDED.last_success_run_id, updated_at = now()`,
      [author.id, boundary, options.runId],
    );
  }

  await client.query(
    `INSERT INTO audit_logs(actor_type, actor_id, action, entity_type, entity_id, metadata)
     VALUES ('service','codex-automation','crawler_import','crawl_run',$1,$2)`,
    [options.runId, { author: handle, importedCount, updatedCount, watermarkAdvance }],
  );
  await client.query("COMMIT");
  committed = true;
  console.log(JSON.stringify({ status, author: handle, importedCount, updatedCount, candidateCount: items.length, watermarkAdvance }));
} catch (error) {
  if (!committed) await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
