import { createHash } from "node:crypto";

const X_STATUS_URL = /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([^/?#]+)\/status\/(\d+)(?:[/?#].*)?$/i;
const URL_IN_TEXT = /(?:https?:\/\/|www\.|\b(?:x|twitter)\.com\/|\bt\.co\/)/iu;

export function parseXStatusUrl(value) {
  const match = String(value ?? "").trim().match(X_STATUS_URL);
  if (!match) {
    throw new Error(`Invalid X status URL: ${value}`);
  }
  return { handle: match[1], platformPostId: match[2] };
}

export function contentHash(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

export function isPureTextCandidate(record, minimumImpressions = 5000) {
  const reasons = [];
  if (record.originalVerification !== "verified_original") reasons.push("not_verified_original");
  if (record.isReply) reasons.push("reply");
  if (record.isRepost) reasons.push("repost");
  if (record.isQuote) reasons.push("quote");
  if (Array.isArray(record.mediaUrls) && record.mediaUrls.length > 0) reasons.push("media");
  if (URL_IN_TEXT.test(String(record.text ?? ""))) reasons.push("link");
  if (!Number.isFinite(record.impressions) || record.impressions <= minimumImpressions) reasons.push("below_threshold");
  return { accepted: reasons.length === 0, reasons };
}

export function shouldAdvanceWatermark(run) {
  return Boolean(
    run.coverageComplete &&
      !run.profileFallbackUsed &&
      !run.partialSearchError &&
      run.strictVerificationComplete,
  );
}

export function stableUuid(namespace, value) {
  const hex = createHash("sha256").update(`${namespace}:${value}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}
