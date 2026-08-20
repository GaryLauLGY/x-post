import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadMigrationBundle } from "./server-migration-lib.mjs";

const bundle = await loadMigrationBundle();
const outputPath = path.resolve(process.env.XPOST_MIGRATION_MANIFEST ?? "output/server-migration-manifest.json");
await mkdir(path.dirname(outputPath), { recursive: true });
const manifest = {
  schemaVersion: bundle.schemaVersion,
  sourceCommit: bundle.sourceCommit,
  sourceCommitDate: bundle.sourceCommitDate,
  counts: bundle.counts,
  authorCounts: bundle.authorCounts,
  categoryCounts: bundle.categoryCounts,
  duplicateIds: bundle.duplicateIds,
  invalidLinks: bundle.invalidLinks,
  files: bundle.files,
  manifestSha256: bundle.manifestSha256,
  importBatchId: bundle.importBatchId,
  backgrounds: bundle.backgrounds.map((record) => ({
    objectKey: record.objectKey,
    bytes: record.bytes,
    sha256: record.sha256,
    id: record.id,
    title: record.title,
    mimeType: record.mimeType,
    width: record.width,
    height: record.height,
    sourceUrl: record.sourceUrl,
    licenseNote: record.licenseNote,
  })),
  avatars: bundle.avatars.map((record) => ({
    objectKey: record.objectKey,
    bytes: record.bytes,
    sha256: record.sha256,
    mimeType: record.mimeType,
    width: record.width,
    height: record.height,
  })),
};
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ status: "ok", outputPath, manifestSha256: bundle.manifestSha256, counts: bundle.counts, authorCounts: bundle.authorCounts }));
