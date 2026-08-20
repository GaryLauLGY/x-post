import { createHash } from "node:crypto";
import { contentHash, parseXStatusUrl } from "../material-pipeline/index.mjs";

const URL_IN_TEXT = /(?:https?:\/\/|www\.|\b(?:x|twitter)\.com\/|\bt\.co\/)/iu;

export function normalizeHandle(value) {
  return String(value ?? "").trim().replace(/^@/u, "").toLowerCase();
}

export function nonnegativeInteger(value, field) {
  const number = Number(String(value ?? "").replaceAll(",", ""));
  if (!Number.isFinite(number) || number < 0 || !Number.isInteger(number)) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return number;
}

function normalizedTimestamp(value, fallback, field) {
  const candidate = String(value ?? "").trim() || fallback;
  const date = new Date(candidate);
  if (!candidate || Number.isNaN(date.getTime())) throw new Error(`${field} is invalid`);
  return date.toISOString();
}

export function validateCandidatePayload(payload, author) {
  if (payload?.schema !== "x-high-exposure-pure-text/v1") throw new Error("Unexpected candidate schema");
  if (normalizeHandle(payload.author) !== normalizeHandle(author.handle)) throw new Error("Candidate author mismatch");
  if (!Array.isArray(payload.items)) throw new Error("Candidate items must be an array");
  const seen = new Set();
  const items = payload.items.map((item, index) => {
    const postId = String(item.postId ?? "").trim();
    const text = String(item.text ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    if (!/^\d+$/u.test(postId)) throw new Error(`items[${index}].postId is invalid`);
    if (seen.has(postId)) throw new Error(`Duplicate post id ${postId}`);
    seen.add(postId);
    if (!text.trim()) throw new Error(`items[${index}].text is empty`);
    if (URL_IN_TEXT.test(text)) throw new Error(`items[${index}].text contains a URL`);
    const parsed = parseXStatusUrl(item.link);
    if (parsed.platformPostId !== postId || normalizeHandle(parsed.handle) !== normalizeHandle(author.handle)) {
      throw new Error(`items[${index}].link does not match the target author and post id`);
    }
    const date = String(item.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error(`items[${index}].date is invalid`);
    const metrics = {
      views: nonnegativeInteger(item.metrics?.views, `items[${index}].metrics.views`),
      replies: nonnegativeInteger(item.metrics?.replies, `items[${index}].metrics.replies`),
      reposts: nonnegativeInteger(item.metrics?.reposts, `items[${index}].metrics.reposts`),
      likes: nonnegativeInteger(item.metrics?.likes, `items[${index}].metrics.likes`),
      bookmarks: nonnegativeInteger(item.metrics?.bookmarks, `items[${index}].metrics.bookmarks`),
    };
    if (metrics.views <= Number(author.minimumImpressions)) throw new Error(`items[${index}] is below the author threshold`);
    const publishedAt = normalizedTimestamp(item.publishedAt, `${date}T00:00:00+08:00`, `items[${index}].publishedAt`);
    const observedAt = normalizedTimestamp(item.observedAt, new Date().toISOString(), `items[${index}].observedAt`);
    return {
      postId,
      text,
      link: String(item.link),
      date,
      publishedAt,
      observedAt,
      metrics,
      contentHash: contentHash(text),
    };
  });
  return items;
}

export function shouldAdvanceFromSummary(summary) {
  return Boolean(
    summary?.coverage_complete &&
      summary?.original_verification &&
      !summary?.partial_search_error &&
      !summary?.profile_fallback_used &&
      summary?.watermark_updated,
  );
}

export function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
