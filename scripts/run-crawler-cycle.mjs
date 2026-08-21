import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import pg from "pg";
import { normalizeHandle } from "../packages/crawler-pipeline/index.mjs";

const { Pool } = pg;
const projectRoot = path.resolve(import.meta.dirname, "..");
const dataRoot = path.join(projectRoot, "data", "crawler");
const crawlerScript = path.join(projectRoot, "upstream", "gary-x-post-crawler", "scripts", "scrape_profile_time_windows.py");
const analyticsScript = path.join(projectRoot, "upstream", "gary-x-analytics", "scripts", "analyze_csv.py");
const materialBuilder = path.join(projectRoot, ".agents", "skills", "x-high-exposure-pure-text", "scripts", "build_materials_from_candidates.py");
const importerScript = path.join(projectRoot, "scripts", "import-crawler-materials.mjs");
const runtimeDir = path.join(projectRoot, "packages", "crawler-runtime");
const storageState = path.join(dataRoot, "storage-states", "primary.json");
const fallbackStorageState = path.join(dataRoot, "storage-states", "secondary.json");
const python = path.join(projectRoot, ".venv", "bin", "python");

function parseArgs(argv) {
  const options = { mode: "", authors: [], untilLocalDate: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--plan-only") options.mode = "plan";
    else if (value === "--execute") options.mode = "execute";
    else if (value === "--authors") options.authors = argv[++index].split(",").map(normalizeHandle).filter(Boolean);
    else if (value === "--until-local-date") options.untilLocalDate = argv[++index];
    else throw new Error(`Unexpected argument: ${value}`);
  }
  if (!options.mode) throw new Error("Use exactly one of --plan-only or --execute");
  if (options.untilLocalDate && !/^\d{4}-\d{2}-\d{2}$/u.test(options.untilLocalDate)) throw new Error("Invalid --until-local-date");
  return options;
}

function dateInBeijing(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(dateText, days) {
  const [year, month, day] = dateText.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));
  return shifted.toISOString().slice(0, 10);
}

function cycleStamp() {
  return `${new Date().toISOString().replaceAll(/[-:.]/gu, "").replace("Z", "Z")}-${randomUUID().slice(0, 8)}`;
}

async function pathExists(file) {
  return stat(file).then(() => true, () => false);
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function runCommand(command, args, { logFile, timeoutMinutes = 60 } = {}) {
  await mkdir(path.dirname(logFile), { recursive: true });
  const log = createWriteStream(logFile, { flags: "a", mode: 0o600 });
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.stdout.pipe(process.stdout, { end: false });
    child.stderr.pipe(process.stderr, { end: false });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${timeoutMinutes} minutes: ${path.basename(command)}`));
    }, timeoutMinutes * 60_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      log.end();
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      log.end();
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${code ?? signal}): ${path.basename(command)}`));
    });
  });
}

async function sha256File(file) {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

async function createArtifactManifest(authorDir, files) {
  const artifacts = [];
  for (const file of [...new Set(files.filter(Boolean))]) {
    if (!(await pathExists(file))) continue;
    const info = await stat(file);
    if (!info.isFile()) continue;
    artifacts.push({
      path: path.relative(projectRoot, file),
      size: info.size,
      sha256: await sha256File(file),
    });
  }
  const manifest = {
    schema: "x-post/crawler-artifacts/v1",
    generatedAt: new Date().toISOString(),
    artifacts,
  };
  const manifestPath = path.join(authorDir, "artifact-manifest.json");
  await writeJson(manifestPath, manifest);
  return manifestPath;
}

async function promoteWatermark(working, canonical) {
  if (!(await pathExists(working))) return false;
  await mkdir(path.dirname(canonical), { recursive: true });
  const temporary = `${canonical}.tmp`;
  await copyFile(working, temporary);
  await rename(temporary, canonical);
  return true;
}

const options = parseArgs(process.argv.slice(2));
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
for (const required of [crawlerScript, analyticsScript, materialBuilder, python, storageState, fallbackStorageState]) {
  if (!(await pathExists(required))) throw new Error(`Required crawler prerequisite is missing: ${path.relative(projectRoot, required)}`);
}
if (!(await pathExists(path.join(runtimeDir, "node_modules", "playwright")))) throw new Error("Project Playwright runtime is not installed");
for (const stateFile of [storageState, fallbackStorageState]) {
  const info = await stat(stateFile);
  if ((info.mode & 0o077) !== 0) throw new Error(`Crawler storage state must be owner-only: ${path.relative(projectRoot, stateFile)}`);
}
if ((await sha256File(storageState)) === (await sha256File(fallbackStorageState))) {
  throw new Error("Crawler primary and secondary storage states must be independent");
}

const config = await readJson(path.join(projectRoot, "config", "crawler-authors.json"));
let configuredAuthors = config.authors;
if (options.authors.length) configuredAuthors = configuredAuthors.filter((author) => options.authors.includes(normalizeHandle(author.handle)));
if (!configuredAuthors.length) throw new Error("No configured authors matched");

const untilLocalDate = options.untilLocalDate || shiftDate(dateInBeijing(), 1);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const lockClient = await pool.connect();
const lockName = "x-post-crawler-cycle";
const locked = await lockClient.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [lockName]);
if (!locked.rows[0].locked) throw new Error("Another x-post crawler cycle is already running");

const cycleId = cycleStamp();
const cycleRoot = path.join(dataRoot, options.mode === "plan" ? "plans" : "runs", cycleId);
await mkdir(cycleRoot, { recursive: true, mode: 0o700 });
const results = [];

try {
  if (options.mode === "execute") {
    await lockClient.query(
      `UPDATE crawl_runs SET status='failed', finished_at=now(), error_summary='Recovered stale running crawler job'
       WHERE status='running' AND started_at < now() - interval '4 hours'`,
    );
  }
  const handles = configuredAuthors.map((author) => normalizeHandle(author.handle));
  const authorRows = await lockClient.query(
    `SELECT sa.id, sa.handle::text, sa.display_name, sa.minimum_impressions,
            to_char((max(m.published_at) AT TIME ZONE 'Asia/Shanghai')::date, 'YYYY-MM-DD') AS latest_material_date
     FROM source_authors sa
     LEFT JOIN materials m ON m.source_author_id = sa.id AND m.deleted_at IS NULL
     WHERE lower(sa.handle::text) = ANY($1::text[]) AND sa.enabled = true
     GROUP BY sa.id, sa.handle, sa.display_name, sa.minimum_impressions`,
    [handles],
  );
  const rowsByHandle = new Map(authorRows.rows.map((row) => [normalizeHandle(row.handle), row]));

  for (const configured of configuredAuthors) {
    const handle = normalizeHandle(configured.handle);
    if (configured.initialMinLocalDate && !/^\d{4}-\d{2}-\d{2}$/u.test(configured.initialMinLocalDate)) {
      results.push({ author: handle, status: "failed", error: "Invalid configured initialMinLocalDate" });
      continue;
    }
    if (configured.windowDays !== undefined && (!Number.isInteger(configured.windowDays) || configured.windowDays < 1)) {
      results.push({ author: handle, status: "failed", error: "Invalid configured windowDays" });
      continue;
    }
    const author = rowsByHandle.get(handle);
    if (!author) {
      results.push({ author: handle, status: "failed", error: "Enabled source author not found" });
      continue;
    }
    const authorDir = path.join(cycleRoot, handle);
    await mkdir(authorDir, { recursive: true, mode: 0o700 });
    const canonicalWatermark = path.join(dataRoot, "watermarks", `${handle}.json`);
    const workingWatermark = path.join(authorDir, `${handle}_crawl_watermark.json`);
    const originalWatermark = path.join(authorDir, "watermark.before.json");
    const hadCanonicalWatermark = await pathExists(canonicalWatermark);
    if (hadCanonicalWatermark) {
      await copyFile(canonicalWatermark, originalWatermark);
      await copyFile(canonicalWatermark, workingWatermark);
    }
    const initialMinDate = hadCanonicalWatermark && author.latest_material_date
      ? shiftDate(author.latest_material_date, -Number(config.watermarkOverlapDays ?? 2))
      : configured.initialMinLocalDate || shiftDate(dateInBeijing(), -Number(config.initialHistoryDays ?? 14));
    const planPath = path.join(authorDir, "plan.json");
    const planLog = path.join(authorDir, "plan.log");
    const commonArgs = [
      crawlerScript,
      "--username", author.handle,
      "--runtime-dir", runtimeDir,
      "--storage-state", storageState,
      "--fallback-storage-state", fallbackStorageState,
      "--output-dir", authorDir,
      "--watermark-file", workingWatermark,
      "--until-local-date", untilLocalDate,
      "--initial-min-local-date", initialMinDate,
      "--watermark-overlap-days", String(config.watermarkOverlapDays ?? 2),
      "--window-days", String(configured.windowDays ?? 2),
      "--retry-error-windows", "2",
      "--error-sleep-seconds", "60",
    ];
    let runId = "";
    let promoted = false;
    try {
      await runCommand(python, [...commonArgs, "--plan-only", "--summary-json", planPath], { logFile: planLog, timeoutMinutes: 5 });
      const plan = await readJson(planPath);
      if (plan.reply_mode !== "exclude" || plan.include_reposts || !plan.strict_original_verification || plan.storage_state_count !== 2) {
        throw new Error("Crawler plan failed the strict plan gate");
      }
      if (options.mode === "plan") {
        results.push({ author: handle, status: "planned", plan: path.relative(projectRoot, planPath), stopAt: plan.stop_at_local_date, until: plan.crawl_from_local_date });
        continue;
      }

      runId = randomUUID();
      await lockClient.query(
        `INSERT INTO crawl_runs(id, source_author_id, requested_since, requested_until, started_at, status, artifact_manifest_path)
         VALUES ($1,$2,$3,$4,now(),'running',$5)`,
        [runId, author.id, `${plan.stop_at_local_date}T00:00:00+08:00`, `${plan.crawl_from_local_date}T00:00:00+08:00`, path.relative(projectRoot, authorDir)],
      );
      const crawlSummaryPath = path.join(authorDir, "crawl-summary.json");
      const crawlLog = path.join(authorDir, "crawl.log");
      await runCommand(python, [...commonArgs, "--summary-json", crawlSummaryPath], { logFile: crawlLog, timeoutMinutes: 75 });
      const crawlSummary = await readJson(crawlSummaryPath);
      if (!crawlSummary.original_verification) throw new Error("Crawler skipped strict original verification");

      const analysisDir = path.join(authorDir, "analysis");
      const analysisLog = path.join(authorDir, "analysis.log");
      await runCommand(
        python,
        [analyticsScript, "--csv", crawlSummary.output_csv, "--output-dir", analysisDir, "--min-impressions", String(author.minimum_impressions), "--expected-author", author.handle],
        { logFile: analysisLog, timeoutMinutes: 10 },
      );
      const materialsPath = path.join(authorDir, "materials.json");
      const builderLog = path.join(authorDir, "materials.log");
      await runCommand(
        python,
        [materialBuilder, "--candidates", path.join(analysisDir, "pure_text_candidates.json"), "--author", author.handle, "--label", configured.label, "--min-impressions", String(author.minimum_impressions), "--min-date", plan.stop_at_local_date, "--until-date", plan.crawl_from_local_date, "--output", materialsPath],
        { logFile: builderLog, timeoutMinutes: 10 },
      );
      const verificationSummaryPath = crawlSummary.verification_summary;
      const manifestPath = await createArtifactManifest(authorDir, [
        planPath,
        planLog,
        crawlSummaryPath,
        crawlLog,
        crawlSummary.output_csv,
        crawlSummary.raw_output_csv,
        crawlSummary.output_json,
        crawlSummary.quarantine_csv,
        verificationSummaryPath,
        path.join(analysisDir, "analysis_summary.json"),
        path.join(analysisDir, "pure_text_candidates.json"),
        materialsPath,
      ]);
      if (crawlSummary.watermark_updated) promoted = await promoteWatermark(workingWatermark, canonicalWatermark);
      const importLog = path.join(authorDir, "import.log");
      await runCommand(
        process.execPath,
        [importerScript, "--payload", materialsPath, "--crawl-summary", crawlSummaryPath, "--verification-summary", verificationSummaryPath, "--author", author.handle, "--run-id", runId, "--artifact-manifest", path.relative(projectRoot, manifestPath)],
        { logFile: importLog, timeoutMinutes: 10 },
      );
      results.push({
        author: handle,
        status: crawlSummary.coverage_complete ? "succeeded" : "partial",
        runId,
        coverageComplete: Boolean(crawlSummary.coverage_complete),
        watermarkAdvanced: Boolean(crawlSummary.watermark_updated),
        artifacts: path.relative(projectRoot, manifestPath),
      });
    } catch (error) {
      if (promoted) {
        if (hadCanonicalWatermark) await copyFile(originalWatermark, canonicalWatermark);
        else await rm(canonicalWatermark, { force: true });
      }
      if (runId) {
        await lockClient.query(
          `UPDATE crawl_runs SET status='failed', finished_at=now(), error_summary=$2 WHERE id=$1 AND status='running'`,
          [runId, String(error instanceof Error ? error.message : error).slice(0, 1000)],
        );
      }
      results.push({ author: handle, status: "failed", runId: runId || null, error: String(error instanceof Error ? error.message : error) });
    }
  }
  const cycleSummary = {
    schema: "x-post/crawler-cycle/v1",
    cycleId,
    mode: options.mode,
    generatedAt: new Date().toISOString(),
    untilLocalDate,
    results,
  };
  await writeJson(path.join(cycleRoot, "cycle-summary.json"), cycleSummary);
  console.log(JSON.stringify(cycleSummary));
  if (results.some((result) => result.status === "failed")) process.exitCode = 1;
} finally {
  await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]).catch(() => {});
  lockClient.release();
  await pool.end();
}
