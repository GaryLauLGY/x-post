import test from "node:test";
import assert from "node:assert/strict";
import {
  contentHash,
  isPureTextCandidate,
  parseXStatusUrl,
  shouldAdvanceWatermark,
  stableUuid,
} from "../../packages/material-pipeline/index.mjs";

test("parses only X status URLs", () => {
  assert.deepEqual(parseXStatusUrl("https://x.com/rwayne/status/2043147477243789820"), {
    handle: "rwayne",
    platformPostId: "2043147477243789820",
  });
  assert.throws(() => parseXStatusUrl("https://example.com/rwayne/status/1"));
});

test("content hashing preserves whitespace exactly", () => {
  assert.notEqual(contentHash("a\n\nb"), contentHash("a\nb"));
  assert.notEqual(contentHash("a  b"), contentHash("a b"));
});

test("strict pure-text gate enforces verification and >5000 boundary", () => {
  const base = {
    originalVerification: "verified_original",
    text: "完整纯文字",
    impressions: 5001,
    mediaUrls: [],
    isReply: false,
    isRepost: false,
    isQuote: false,
  };
  assert.equal(isPureTextCandidate(base).accepted, true);
  assert.deepEqual(isPureTextCandidate({ ...base, impressions: 5000 }).reasons, ["below_threshold"]);
  assert.deepEqual(isPureTextCandidate({ ...base, text: "隐藏 t.co/example" }).reasons, ["link"]);
  assert.deepEqual(isPureTextCandidate({ ...base, mediaUrls: ["https://pbs.twimg.com/x"] }).reasons, ["media"]);
});

test("watermark advances only on strict complete coverage", () => {
  const complete = {
    coverageComplete: true,
    profileFallbackUsed: false,
    partialSearchError: false,
    strictVerificationComplete: true,
  };
  assert.equal(shouldAdvanceWatermark(complete), true);
  assert.equal(shouldAdvanceWatermark({ ...complete, coverageComplete: false }), false);
  assert.equal(shouldAdvanceWatermark({ ...complete, profileFallbackUsed: true }), false);
  assert.equal(shouldAdvanceWatermark({ ...complete, partialSearchError: true }), false);
});

test("stable UUIDs are deterministic UUID v5-shaped identifiers", () => {
  const first = stableUuid("material", "123");
  assert.equal(first, stableUuid("material", "123"));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
