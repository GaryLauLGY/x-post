import process from "node:process";
import pg from "pg";
import { stableUuid } from "../packages/material-pipeline/index.mjs";
import { loadMigrationBundle, SOURCE_MAP } from "./server-migration-lib.mjs";

const { Pool } = pg;
const dryRun = process.argv.includes("--dry-run");
const bundle = await loadMigrationBundle();

const summary = {
  status: dryRun ? "dry_run" : "imported",
  counts: bundle.counts,
  authorCounts: bundle.authorCounts,
  categoryCounts: bundle.categoryCounts,
  duplicateIds: bundle.duplicateIds,
  invalidLinks: bundle.invalidLinks,
  sourceCommit: bundle.sourceCommit,
  sourceCommitDate: bundle.sourceCommitDate,
  manifestSha256: bundle.manifestSha256,
  importBatchId: bundle.importBatchId,
};

if (bundle.counts.materials !== 329 || bundle.duplicateIds.length || bundle.invalidLinks.length) {
  console.log(JSON.stringify(summary));
  throw new Error("Migration baseline failed");
}

if (dryRun) {
  console.log(JSON.stringify(summary));
  process.exit(0);
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  const authorIds = new Map();
  for (const source of SOURCE_MAP.values()) {
    const id = stableUuid("source-author", source.handle.toLowerCase());
    await client.query(
      `INSERT INTO source_authors(id, platform, handle, display_name, profile_url, avatar_object_key, minimum_impressions)
       VALUES ($1, 'x', $2, $3, $4, $5, 5000)
       ON CONFLICT (platform, handle) DO UPDATE SET
         display_name = EXCLUDED.display_name, profile_url = EXCLUDED.profile_url,
         avatar_object_key = EXCLUDED.avatar_object_key, updated_at = now()`,
      [id, source.handle, source.displayName, `https://x.com/${source.handle}`, source.avatar],
    );
    authorIds.set(source.handle.toLowerCase(), id);
  }

  for (const account of bundle.accounts) {
    const handle = account.handle.replace(/^@/, "");
    await client.query(
      `INSERT INTO publishing_accounts(id, name, handle, avatar_object_key, verified, name_tag, accent, source_profile_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (handle) DO UPDATE SET
         name = EXCLUDED.name, avatar_object_key = EXCLUDED.avatar_object_key,
         verified = EXCLUDED.verified, name_tag = EXCLUDED.name_tag, accent = EXCLUDED.accent,
         source_profile_url = EXCLUDED.source_profile_url, updated_at = now()`,
      [
        stableUuid("publishing-account", handle.toLowerCase()),
        account.name,
        handle,
        account.avatar.replace(/^\//, ""),
        Boolean(account.verified),
        account.label ?? null,
        account.accent ?? null,
        `https://x.com/${handle}`,
      ],
    );
  }

  for (const background of bundle.backgrounds) {
    await client.query(
      `INSERT INTO backgrounds(id, title, object_key, mime_type, width, height, sha256, source_url, license_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (object_key) DO UPDATE SET
         title = EXCLUDED.title, mime_type = EXCLUDED.mime_type, width = EXCLUDED.width,
         height = EXCLUDED.height, sha256 = EXCLUDED.sha256,
         source_url = EXCLUDED.source_url, license_note = EXCLUDED.license_note`,
      [background.id, background.title, background.objectKey, background.mimeType, background.width, background.height, background.sha256, background.sourceUrl, background.licenseNote],
    );
  }

  let textMismatchCount = 0;
  for (const material of bundle.materials) {
    const authorId = authorIds.get(material.sourceAuthor.handle.toLowerCase());
    const publishedAt = `${material.date}T00:00:00+08:00`;
    const result = await client.query(
      `INSERT INTO materials(
         id, platform, platform_post_id, source_author_id, source_url, original_text,
         published_at, content_type, category, tags, admin_note, status,
         verified_original, content_hash, migration_source_commit, approved_at
       ) VALUES ($1,'x',$2,$3,$4,$5,$6,'pure_text',$7,$8,$9,'approved',true,$10,$11,$12)
       ON CONFLICT (platform, platform_post_id) DO UPDATE SET
         source_author_id = EXCLUDED.source_author_id,
         source_url = EXCLUDED.source_url,
         original_text = CASE WHEN materials.edited_text IS NULL THEN EXCLUDED.original_text ELSE materials.original_text END,
         published_at = EXCLUDED.published_at,
         category = CASE WHEN materials.admin_note IS NULL THEN EXCLUDED.category ELSE materials.category END,
         tags = EXCLUDED.tags,
         content_hash = CASE WHEN materials.edited_text IS NULL THEN EXCLUDED.content_hash ELSE materials.content_hash END,
         updated_at = now()
       RETURNING id, original_text`,
      [
        material.databaseId,
        material.platformPostId,
        authorId,
        material.link,
        material.text,
        publishedAt,
        material.category,
        material.tags ?? [],
        material.note ?? null,
        material.contentHash,
        bundle.sourceCommit,
        bundle.sourceCommitDate,
      ],
    );
    if (result.rows[0].original_text !== material.text) textMismatchCount += 1;
    await client.query(
      `INSERT INTO material_metrics(material_id, views, replies, reposts, likes, bookmarks, observed_at, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (material_id, observed_at) DO UPDATE SET
         views = EXCLUDED.views, replies = EXCLUDED.replies, reposts = EXCLUDED.reposts,
         likes = EXCLUDED.likes, bookmarks = EXCLUDED.bookmarks, metadata = EXCLUDED.metadata`,
      [
        material.databaseId,
        material.metrics?.views ?? null,
        material.metrics?.replies ?? null,
        material.metrics?.reposts ?? null,
        material.metrics?.likes ?? null,
        material.metrics?.bookmarks ?? null,
        bundle.sourceCommitDate,
        { source: "existing-materials.json", sourceDateKnown: false, sourceCommit: bundle.sourceCommit },
      ],
    );
  }

  if (textMismatchCount) throw new Error(`Original text mismatch count: ${textMismatchCount}`);
  await client.query(
    `INSERT INTO import_batches(id, source_commit, source_manifest_sha256, imported_at, material_count, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET material_count = EXCLUDED.material_count, metadata = EXCLUDED.metadata`,
    [bundle.importBatchId, bundle.sourceCommit, bundle.manifestSha256, bundle.sourceCommitDate, bundle.counts.materials, { authorCounts: bundle.authorCounts }],
  );
  await client.query("COMMIT");
  console.log(JSON.stringify({ ...summary, textMismatchCount }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
