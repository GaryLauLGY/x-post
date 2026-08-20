#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

function parseArgs(argv) {
  const args = {
    runtimeDir: "",
    storageState: "",
    userDataDir: "",
    channel: "",
    url: "https://x.com/login",
    timeoutMs: 600000,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--runtime-dir") args.runtimeDir = argv[++i];
    else if (arg === "--storage-state") args.storageState = argv[++i];
    else if (arg === "--user-data-dir") args.userDataDir = argv[++i];
    else if (arg === "--channel") args.channel = argv[++i];
    else if (arg === "--url") args.url = argv[++i];
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.runtimeDir) throw new Error("Missing --runtime-dir");
  if (!args.storageState) throw new Error("Missing --storage-state");
  return args;
}

async function hasXAuthCookie(context) {
  const cookies = await context.cookies(["https://x.com", "https://twitter.com"]);
  return cookies.some((cookie) => cookie.name === "auth_token" && cookie.value);
}

async function main() {
  const args = parseArgs(process.argv);
  const runtimeRequire = createRequire(path.join(path.resolve(args.runtimeDir), "package.json"));
  const { chromium } = runtimeRequire("playwright");
  const storagePath = path.resolve(args.storageState);
  await fs.mkdir(path.dirname(storagePath), { recursive: true });

  const launchOptions = {
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  };
  if (args.channel) launchOptions.channel = args.channel;

  let browser;
  let context;
  if (args.userDataDir) {
    await fs.mkdir(path.resolve(args.userDataDir), { recursive: true });
    context = await chromium.launchPersistentContext(path.resolve(args.userDataDir), {
      ...launchOptions,
      viewport: { width: 1280, height: 1000 },
      deviceScaleFactor: 2,
      locale: "en-US",
    });
  } else {
    browser = await chromium.launch(launchOptions);
    context = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
      deviceScaleFactor: 2,
      locale: "en-US",
    });
  }
  const page = await context.newPage();
  await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 60000 });

  console.log(`Opened ${args.url}`);
  console.log("Please log in manually. Waiting for X auth_token cookie...");

  const started = Date.now();
  while (Date.now() - started < args.timeoutMs) {
    if (await hasXAuthCookie(context)) {
      await context.storageState({ path: storagePath });
      console.log(`Saved storage state: ${storagePath}`);
      await context.close();
      if (browser) await browser.close();
      return;
    }
    await page.waitForTimeout(1500);
  }

  await context.close();
  if (browser) await browser.close();
  throw new Error(`Timed out waiting for login after ${args.timeoutMs} ms`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
