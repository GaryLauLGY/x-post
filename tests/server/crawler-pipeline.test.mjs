import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { persistedMaterialId, shouldAdvanceFromSummary, validateCandidatePayload } from "../../packages/crawler-pipeline/index.mjs";

const execFileAsync = promisify(execFile);

const author = { handle: "rwayne", minimumImpressions: 5000 };
const validPayload = {
  schema: "x-high-exposure-pure-text/v1",
  author: "rwayne",
  items: [
    {
      postId: "1234567890",
      text: "第一段\n\n第二段",
      link: "https://x.com/rwayne/status/1234567890",
      date: "2026-08-20",
      publishedAt: "2026-08-20T01:02:03.000Z",
      observedAt: "2026-08-20T04:05:06.000Z",
      metrics: { views: 5001, replies: 1, reposts: 2, likes: 3, bookmarks: 4 },
    },
  ],
};

test("crawler candidates preserve strict pure-text content and timestamps", () => {
  const items = validateCandidatePayload(validPayload, author);
  assert.equal(items.length, 1);
  assert.equal(items[0].text, "第一段\n\n第二段");
  assert.equal(items[0].publishedAt, "2026-08-20T01:02:03.000Z");
  assert.equal(items[0].metrics.views, 5001);
});

test("crawler candidates fail closed on links, author mismatches, and thresholds", () => {
  assert.throws(() => validateCandidatePayload({ ...validPayload, items: [{ ...validPayload.items[0], text: "带链接 https://example.com" }] }, author), /contains a URL/);
  assert.throws(() => validateCandidatePayload({ ...validPayload, items: [{ ...validPayload.items[0], link: "https://x.com/other/status/1234567890" }] }, author), /does not match/);
  assert.throws(() => validateCandidatePayload({ ...validPayload, items: [{ ...validPayload.items[0], metrics: { ...validPayload.items[0].metrics, views: 5000 } }] }, author), /below/);
});

test("watermarks advance only on complete strict coverage", () => {
  const complete = {
    coverage_complete: true,
    original_verification: true,
    partial_search_error: false,
    profile_fallback_used: false,
    watermark_updated: true,
  };
  assert.equal(shouldAdvanceFromSummary(complete), true);
  for (const key of ["coverage_complete", "original_verification", "watermark_updated"]) {
    assert.equal(shouldAdvanceFromSummary({ ...complete, [key]: false }), false);
  }
  assert.equal(shouldAdvanceFromSummary({ ...complete, partial_search_error: true }), false);
  assert.equal(shouldAdvanceFromSummary({ ...complete, profile_fallback_used: true }), false);
});

test("metric imports use the database id returned by an existing-material upsert", () => {
  const existingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.equal(persistedMaterialId({ rows: [{ id: existingId, inserted: false }] }), existingId);
  assert.throws(() => persistedMaterialId({ rows: [] }), /did not return/);
});

test("crawler importer dry-run validates the complete strict evidence set", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "xpost-crawler-test-"));
  try {
    const payloadPath = path.join(tempDir, "materials.json");
    const crawlSummaryPath = path.join(tempDir, "crawl-summary.json");
    const verificationSummaryPath = path.join(tempDir, "verification-summary.json");
    await Promise.all([
      writeFile(payloadPath, JSON.stringify(validPayload)),
      writeFile(crawlSummaryPath, JSON.stringify({
        coverage_complete: true,
        original_verification: true,
        partial_search_error: false,
        profile_fallback_used: false,
        watermark_updated: true,
      })),
      writeFile(verificationSummaryPath, JSON.stringify({
        expected_author: "rwayne",
        fail_closed: true,
        verified_original_count: 1,
        quarantined_count: 0,
      })),
    ]);
    const { stdout } = await execFileAsync(process.execPath, [
      new URL("../../scripts/import-crawler-materials.mjs", import.meta.url).pathname,
      "--payload", payloadPath,
      "--crawl-summary", crawlSummaryPath,
      "--verification-summary", verificationSummaryPath,
      "--author", "rwayne",
      "--minimum-impressions", "5000",
      "--dry-run",
    ]);
    assert.deepEqual(JSON.parse(stdout), { status: "dry_run", author: "rwayne", items: 1, watermarkAdvance: true });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("candidate builder rejects scheme-less X short links before import", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "xpost-builder-test-"));
  try {
    const candidatesPath = path.join(tempDir, "candidates.json");
    const outputPath = path.join(tempDir, "materials.json");
    await writeFile(candidatesPath, JSON.stringify([{
      "Post id": "1234567890",
      "Post text": "正文里隐藏 t.co/example",
      "Verified author": "rwayne",
      "Impressions": 5001,
      "Published at": "2026-08-20T01:02:03.000Z",
      "Observed at": "2026-08-20T04:05:06.000Z",
      "Post Link": "https://x.com/rwayne/status/1234567890",
      "Original verification": "verified_original",
      "In reply to status id": "",
      "Media URLs": "[]",
      category: "pure_text",
    }]));
    await execFileAsync("python3", [
      new URL("../../.agents/skills/x-high-exposure-pure-text/scripts/build_materials_from_candidates.py", import.meta.url).pathname,
      "--candidates", candidatesPath,
      "--author", "rwayne",
      "--label", "Roland Wayne",
      "--min-impressions", "5000",
      "--output", outputPath,
    ]);
    const output = JSON.parse(await readFile(outputPath, "utf8"));
    assert.deepEqual(output.items, []);
    assert.deepEqual(output.rejected, { text_contains_url: 1 });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
