#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    csv: "",
    author: "",
    outputCsv: "",
    quarantineCsv: "",
    auditJsonl: "",
    summaryJson: "",
    concurrency: 4,
    delayMs: 300,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--csv") args.csv = argv[++i];
    else if (arg === "--author") args.author = argv[++i].replace(/^@/, "");
    else if (arg === "--output-csv") args.outputCsv = argv[++i];
    else if (arg === "--quarantine-csv") args.quarantineCsv = argv[++i];
    else if (arg === "--audit-jsonl") args.auditJsonl = argv[++i];
    else if (arg === "--summary-json") args.summaryJson = argv[++i];
    else if (arg === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (arg === "--delay-ms") args.delayMs = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const key of ["csv", "author", "outputCsv", "quarantineCsv", "auditJsonl"]) {
    if (!args[key]) throw new Error(`Missing --${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`);
  }
  if (!args.summaryJson) args.summaryJson = args.outputCsv.replace(/\.csv$/i, "_verification_summary.json");
  args.concurrency = Math.max(1, Math.floor(args.concurrency));
  args.delayMs = Math.max(0, Math.floor(args.delayMs));
  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0];
  const records = rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
  return { headers, records };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function asCsv(headers, records) {
  return `${[headers, ...records.map((record) => headers.map((header) => record[header] || ""))]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n")}\n`;
}

function syndicationToken(postId) {
  return (Number(postId) / 1e15 * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

async function readJsonl(file) {
  try {
    return (await fs.readFile(file, "utf8")).split(/\r?\n/).filter(Boolean).map(JSON.parse);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function appendJsonl(file, row) {
  await fs.appendFile(file, `${JSON.stringify(row)}\n`, "utf8");
}

async function inspectPost(postId, expectedAuthor, domIsQuote = false) {
  const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${postId}&lang=zh-cn&token=${syndicationToken(postId)}`;
  let lastError = "";
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        headers: { "user-agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const tweet = await response.json();
      if (!tweet?.id_str) throw new Error("empty tweet result");
      const author = String(tweet.user?.screen_name || "");
      const replyTo = String(tweet.in_reply_to_status_id_str || "");
      const quotedStatusId = String(
        tweet.quoted_status_id_str
        || tweet.quoted_status_id
        || tweet.quoted_tweet?.id_str
        || tweet.quoted_status?.id_str
        || ""
      );
      const isQuote = Boolean(quotedStatusId) || domIsQuote;
      let decision = "verified_original";
      if (author.toLowerCase() !== expectedAuthor.toLowerCase()) decision = "foreign_author";
      else if (replyTo) decision = "reply";
      else if (isQuote) decision = "quote";
      return {
        audit_schema_version: 2,
        status: "audited",
        post_id: String(postId),
        expected_author: expectedAuthor,
        author_screen_name: author,
        is_expected_author: author.toLowerCase() === expectedAuthor.toLowerCase(),
        in_reply_to_status_id_str: replyTo,
        in_reply_to_screen_name: String(tweet.in_reply_to_screen_name || ""),
        is_reply: Boolean(replyTo),
        quoted_status_id_str: quotedStatusId,
        is_quote: isQuote,
        decision,
      };
    } catch (error) {
      lastError = String(error?.message || error);
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
    }
  }
  return {
    audit_schema_version: 2,
    status: "error",
    post_id: String(postId),
    expected_author: expectedAuthor,
    decision: "verification_error",
    error: lastError,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  for (const file of [args.outputCsv, args.quarantineCsv, args.auditJsonl, args.summaryJson]) {
    await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  }

  const { headers, records } = parseCsv(await fs.readFile(path.resolve(args.csv), "utf8"));
  for (const required of ["Post id", "Post Link"]) {
    if (!headers.includes(required)) throw new Error(`CSV missing required column: ${required}`);
  }

  const existing = await readJsonl(path.resolve(args.auditJsonl));
  const latestByPost = new Map();
  for (const row of existing) latestByPost.set(String(row.post_id), row);
  const completed = new Set(
    [...latestByPost.values()]
      .filter((row) => row.status === "audited" && Number(row.audit_schema_version || 0) >= 2)
      .map((row) => String(row.post_id)),
  );
  const pending = records.filter((record) => record["Post id"] && !completed.has(String(record["Post id"])));

  let cursor = 0;
  let finished = completed.size;
  async function worker(workerId) {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= pending.length) return;
      const record = pending[index];
      const domIsQuote = String(record["Is quote"] || "").toLowerCase() === "true";
      const result = await inspectPost(String(record["Post id"]), args.author, domIsQuote);
      await appendJsonl(path.resolve(args.auditJsonl), result);
      latestByPost.set(String(result.post_id), result);
      finished += 1;
      process.stdout.write(`${JSON.stringify({ worker: workerId, finished, total: records.length, post_id: result.post_id, decision: result.decision })}\n`);
      if (args.delayMs) await new Promise((resolve) => setTimeout(resolve, args.delayMs));
    }
  }
  await Promise.all(Array.from({ length: args.concurrency }, (_, index) => worker(index + 1)));

  const verificationHeaders = [...headers];
  for (const header of ["Verified author", "In reply to status id", "Quoted status id", "Is quote", "Original verification"]) {
    if (!verificationHeaders.includes(header)) verificationHeaders.push(header);
  }
  const verified = [];
  const quarantined = [];
  for (const record of records) {
    const audit = latestByPost.get(String(record["Post id"]));
    const enriched = {
      ...record,
      "Verified author": audit?.author_screen_name || "",
      "In reply to status id": audit?.in_reply_to_status_id_str || "",
      "Quoted status id": audit?.quoted_status_id_str || "",
      "Is quote": audit?.is_quote ? "true" : "false",
      "Original verification": audit?.decision || "verification_missing",
    };
    if (audit?.decision === "verified_original") verified.push(enriched);
    else quarantined.push(enriched);
  }

  await fs.writeFile(path.resolve(args.outputCsv), asCsv(verificationHeaders, verified), "utf8");
  await fs.writeFile(path.resolve(args.quarantineCsv), asCsv(verificationHeaders, quarantined), "utf8");
  const decisionCounts = {};
  for (const record of [...verified, ...quarantined]) {
    const decision = record["Original verification"];
    decisionCounts[decision] = (decisionCounts[decision] || 0) + 1;
  }
  const summary = {
    input_csv: path.resolve(args.csv),
    expected_author: args.author,
    input_count: records.length,
    verified_original_count: verified.length,
    quarantined_count: quarantined.length,
    decision_counts: decisionCounts,
    fail_closed: true,
    output_csv: path.resolve(args.outputCsv),
    quarantine_csv: path.resolve(args.quarantineCsv),
    audit_jsonl: path.resolve(args.auditJsonl),
  };
  await fs.writeFile(path.resolve(args.summaryJson), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
