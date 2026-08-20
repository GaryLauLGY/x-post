#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

function parseArgs(argv) {
  const args = {
    profileUrl: "",
    username: "",
    outputCsv: "",
    outputJson: "",
    runtimeDir: "",
    storageState: "",
    saveStorageState: "",
    debugDir: "",
    seedJson: "",
    extraSeedJson: [],
    limit: 20,
    maxScrolls: 20,
    stopAfterStaleScrolls: 40,
    waitMs: 2500,
    headed: false,
    ignoreLimitForScrollStop: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--profile-url") args.profileUrl = argv[++i];
    else if (arg === "--username") args.username = argv[++i];
    else if (arg === "--output-csv") args.outputCsv = argv[++i];
    else if (arg === "--output-json") args.outputJson = argv[++i];
    else if (arg === "--runtime-dir") args.runtimeDir = argv[++i];
    else if (arg === "--storage-state") args.storageState = argv[++i];
    else if (arg === "--save-storage-state") args.saveStorageState = argv[++i];
    else if (arg === "--debug-dir") args.debugDir = argv[++i];
    else if (arg === "--seed-json") args.seedJson = argv[++i];
    else if (arg === "--extra-seed-json") args.extraSeedJson.push(argv[++i]);
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--max-scrolls") args.maxScrolls = Number(argv[++i]);
    else if (arg === "--stop-after-stale-scrolls") args.stopAfterStaleScrolls = Number(argv[++i]);
    else if (arg === "--wait-ms") args.waitMs = Number(argv[++i]);
    else if (arg === "--headless") args.headed = false;
    else if (arg === "--headed") args.headed = true;
    else if (arg === "--ignore-limit-for-scroll-stop") args.ignoreLimitForScrollStop = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const required of ["profileUrl", "outputCsv", "runtimeDir"]) {
    if (!args[required]) throw new Error(`Missing --${required.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`);
  }
  if (!args.outputJson) args.outputJson = args.outputCsv.replace(/\.csv$/i, ".json");
  return args;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function asCsv(rows) {
  const columns = [
    "Post id",
    "Date",
    "Published at",
    "Post text",
    "Post Link",
    "Media URLs",
    "Is quote",
    "Impressions",
    "Replies",
    "Reposts",
    "Likes",
    "Bookmarks",
    "Author",
    "Scraped from",
    "Observed at",
  ];
  return `${[
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n")}\n`;
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function parseCompactNumber(text) {
  const value = String(text || "").replace(/,/g, "").trim();
  const match = value.match(/(\d+(?:\.\d+)?)\s*([KMB万千億亿]?)/i);
  if (!match) return "";
  const number = Number(match[1]);
  const suffix = match[2].toLowerCase();
  const multipliers = {
    k: 1_000,
    m: 1_000_000,
    b: 1_000_000_000,
    千: 1_000,
    万: 10_000,
    億: 100_000_000,
    亿: 100_000_000,
  };
  return Math.round(number * (multipliers[suffix] || 1));
}

async function writeOutputs({
  outputCsv,
  outputJson,
  args,
  username,
  rowsById,
  pageInfo,
  scroll,
  complete,
  staleScrolls,
}) {
  const rows = [...rowsById.values()]
    .sort((left, right) => {
      const dateOrder = String(right.Date || "").localeCompare(String(left.Date || ""));
      if (dateOrder) return dateOrder;
      return String(right["Post id"] || "").localeCompare(String(left["Post id"] || ""));
    })
    .slice(0, args.limit);
  await fs.writeFile(outputCsv, asCsv(rows), "utf8");
  await fs.writeFile(
    outputJson,
    JSON.stringify(
      {
        profile_url: args.profileUrl,
        username,
        count: rows.length,
        headless: !args.headed,
        used_storage_state: Boolean(args.storageState),
        complete,
        scroll,
        stale_scrolls: staleScrolls,
        limit: args.limit,
        max_scrolls: args.maxScrolls,
        stop_after_stale_scrolls: args.stopAfterStaleScrolls,
        page_info: pageInfo,
        rows,
      },
      null,
      2
    ),
    "utf8"
  );
}

async function extractArticles(page, username) {
  return page.locator("article").evaluateAll((articles, user) => {
    function compactNumber(text) {
      const value = String(text || "").replace(/,/g, "").trim();
      const match = value.match(/(\d+(?:\.\d+)?)\s*([KMB万千億亿]?)/i);
      if (!match) return "";
      return `${match[1]}${match[2] || ""}`;
    }

    function metricFromLabel(el, patterns) {
      const nodes = [...el.querySelectorAll('[aria-label], [role="group"]')];
      for (const node of nodes) {
        const label = node.getAttribute("aria-label") || "";
        for (const pattern of patterns) {
          const match = label.match(pattern);
          if (match) return compactNumber(match[1]);
        }
      }
      return "";
    }

    return articles.map((article) => {
      // The article's timestamp permalink identifies the article itself.
      // Picking an arbitrary /status/ link can select a parent, quoted post,
      // or another user's reply displayed inside the same conversation card.
      const timeElement = article.querySelector("time");
      const statusAnchor = timeElement?.closest('a[href*="/status/"]');
      const href = statusAnchor?.href || "";
      const id = (href.match(/\/status\/(\d+)/) || [])[1] || "";
      const author = (href.match(/(?:x|twitter)\.com\/([^/]+)\/status\//i) || [])[1] || "";
      const time = timeElement?.getAttribute("datetime") || "";
      const text = [...article.querySelectorAll('[data-testid="tweetText"]')]
        .map((node) => (node.innerText || node.textContent || "")
          .split(/\n+/)
          .map((line) => line.replace(/[ \t]+/g, " ").trim())
          .filter(Boolean)
          .join("\n"))
        .filter(Boolean)
        .join("\n");

      // X analytics exports normally retain a t.co/media URL in image posts,
      // while the rendered profile DOM omits that URL from tweetText. Add an
      // equivalent status media URL so the downstream CSV-only classifier can
      // route profile-scraped image posts to the HTTP collector. Video and
      // quote hints serve the same compatibility purpose for excluded posts.
      const hasPhoto = [...article.querySelectorAll("img")]
        .map((img) => img.currentSrc || img.src || "")
        .some((src) => /pbs\.twimg\.com\/media\//.test(src));
      const mediaUrls = [...new Set(
        [...article.querySelectorAll("img")]
          .map((img) => img.currentSrc || img.src || "")
          .filter((src) => /pbs\.twimg\.com\/media\//.test(src)),
      )];
      const hasVideo = Boolean(
        article.querySelector('[data-testid="videoPlayer"], video, img[src*="amplify_video_thumb"], img[src*="tweet_video_thumb"]')
      );
      const hasQuote = Boolean(article.querySelector('[data-testid="quoteTweet"]'));
      let compatibleText = text;
      if (hasQuote) compatibleText = `${compatibleText} quote`.trim();
      else if (hasVideo) compatibleText = `${compatibleText} video`.trim();
      else if (hasPhoto && id && !/https?:\/\//i.test(compatibleText)) {
        compatibleText = `${compatibleText} https://x.com/${user}/status/${id}/photo/1`.trim();
      }

      const viewLink = [...article.querySelectorAll('a[href$="/analytics"], a[href*="/analytics"]')]
        .map((node) => node.textContent || node.getAttribute("aria-label") || "")
        .find(Boolean) || "";

      return {
        id,
        author,
        href,
        datetime: time,
        text: compatibleText,
        mediaUrls,
        isQuote: hasQuote,
        views: compactNumber(viewLink) || metricFromLabel(article, [/(\S+)\s+Views?/i, /(\S+)\s+次查看/]),
        replies: metricFromLabel(article, [/(\S+)\s+repl/i, /(\S+)\s+回复/]),
        reposts: metricFromLabel(article, [/(\S+)\s+repost/i, /(\S+)\s+转帖/, /(\S+)\s+转发/]),
        likes: metricFromLabel(article, [/(\S+)\s+likes?/i, /(\S+)\s+喜欢/]),
        bookmarks: metricFromLabel(article, [/(\S+)\s+bookmark/i, /(\S+)\s+书签/]),
      };
    });
  }, username);
}

async function main() {
  const args = parseArgs(process.argv);
  const runtimeRequire = createRequire(path.join(path.resolve(args.runtimeDir), "package.json"));
  const { chromium } = runtimeRequire("playwright");

  const outputCsv = path.resolve(args.outputCsv);
  const outputJson = path.resolve(args.outputJson);
  await fs.mkdir(path.dirname(outputCsv), { recursive: true });
  await fs.mkdir(path.dirname(outputJson), { recursive: true });
  if (args.debugDir) await fs.mkdir(path.resolve(args.debugDir), { recursive: true });

  const username = args.username || new URL(args.profileUrl).pathname.split("/").filter(Boolean)[0] || "";
  const browser = await chromium.launch({
    headless: !args.headed,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const contextOptions = {
    viewport: { width: 1280, height: 1200 },
    deviceScaleFactor: 2,
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  };
  if (args.storageState) contextOptions.storageState = path.resolve(args.storageState);
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  const rowsById = new Map();
  const seedJsonPaths = [args.seedJson, ...args.extraSeedJson].filter(Boolean);
  for (const seedJsonPath of seedJsonPaths) {
    try {
      const seed = JSON.parse(await fs.readFile(path.resolve(seedJsonPath), "utf8"));
      for (const row of seed.rows || []) {
        if (row["Post id"]) rowsById.set(String(row["Post id"]), row);
      }
    } catch (error) {
      throw new Error(`Failed to load seed JSON ${seedJsonPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (seedJsonPaths.length) process.stdout.write(`seeded=${rowsById.size}\n`);
  const seenThisRun = new Set();
  let lastCount = rowsById.size;
  let staleScrolls = 0;
  try {
    await page.goto(args.profileUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(args.waitMs);

    for (let scroll = 0; scroll <= args.maxScrolls; scroll += 1) {
      const extracted = await extractArticles(page, username);
      let newlySeenCount = 0;
      for (const item of extracted) {
        if (item.author && item.author.toLowerCase() !== username.toLowerCase()) continue;
        if (!item.id || !item.text) continue;
        if (!seenThisRun.has(item.id)) {
          seenThisRun.add(item.id);
          newlySeenCount += 1;
        }
        const date = item.datetime ? item.datetime.slice(0, 10) : "";
        const link = normalizeUrl(item.href || `https://x.com/${username}/status/${item.id}`);
        const observedAt = new Date().toISOString();
        const previous = rowsById.get(item.id) || {};
        rowsById.set(item.id, {
          ...previous,
          "Post id": item.id,
          Date: date,
          "Published at": item.datetime || previous["Published at"] || "",
          "Post text": item.text,
          "Post Link": link,
          "Media URLs": JSON.stringify(item.mediaUrls || []),
          "Is quote": item.isQuote ? "true" : "false",
          Impressions: parseCompactNumber(item.views),
          Replies: parseCompactNumber(item.replies),
          Reposts: parseCompactNumber(item.reposts),
          Likes: parseCompactNumber(item.likes),
          Bookmarks: parseCompactNumber(item.bookmarks),
          Author: item.author || username,
          "Scraped from": args.profileUrl,
          "Observed at": observedAt,
        });
      }

      const newCount = rowsById.size - lastCount;
      // A resumed window may need to scroll through many seeded rows before
      // reaching unseen posts. Treat newly encountered page IDs as progress
      // even when they are already present in the accumulated seed.
      staleScrolls = newlySeenCount > 0 ? 0 : staleScrolls + 1;
      lastCount = rowsById.size;
      process.stdout.write(
        `scroll=${scroll} collected=${rowsById.size} new=${newCount} seen=${newlySeenCount} stale=${staleScrolls}\n`,
      );

      await writeOutputs({
        outputCsv,
        outputJson,
        args,
        username,
        rowsById,
        pageInfo: null,
        scroll,
        complete: !args.ignoreLimitForScrollStop && rowsById.size >= args.limit,
        staleScrolls,
      });

      if (!args.ignoreLimitForScrollStop && rowsById.size >= args.limit) break;
      if (staleScrolls >= args.stopAfterStaleScrolls) {
        process.stdout.write(`stopping: stale_scrolls=${staleScrolls}\n`);
        break;
      }
      await page.mouse.wheel(0, 1600);
      await page.waitForTimeout(args.waitMs);
    }

    const pageInfo = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      article_count: document.querySelectorAll("article").length,
      body_text_head: document.body.innerText.slice(0, 1200),
    }));
    pageInfo.seen_this_run_count = seenThisRun.size;
    if (args.debugDir) {
      const debugDir = path.resolve(args.debugDir);
      try {
        await page.screenshot({ path: path.join(debugDir, "profile_page.png"), fullPage: true });
      } catch (error) {
        process.stdout.write(`warning: debug screenshot failed: ${error instanceof Error ? error.message : String(error)}\n`);
      }
      await fs.writeFile(path.join(debugDir, "profile_page.json"), JSON.stringify(pageInfo, null, 2), "utf8");
    }
    if (args.saveStorageState) {
      await fs.mkdir(path.dirname(path.resolve(args.saveStorageState)), { recursive: true });
      await context.storageState({ path: path.resolve(args.saveStorageState) });
    }
    await writeOutputs({
      outputCsv,
      outputJson,
      args,
      username,
      rowsById,
      pageInfo,
      scroll: null,
      complete: !args.ignoreLimitForScrollStop && rowsById.size >= args.limit,
      staleScrolls,
    });
    console.log(JSON.stringify({ output_csv: outputCsv, output_json: outputJson, count: rowsById.size }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
