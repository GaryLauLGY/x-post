import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the tweet card studio", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>星际留白 · 推文卡片工作台<\/title>/i);
  assert.match(html, /团队推文库/);
  assert.doesNotMatch(html, /团队设置|已导入用户与发布账号/);
  assert.match(html, /卡片设置/);
  assert.match(html, /帖子数据/);
  assert.match(html, /导出 PNG/);
  assert.doesNotMatch(html, /本地原型/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/);
});

test("removes starter-only preview assets and metadata", async () => {
  const [page, layout, packageJson, materials, accounts, users, styles, syncScript] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/data/existing-materials.json", import.meta.url), "utf8"),
    readFile(new URL("../app/data/existing-accounts.json", import.meta.url), "utf8"),
    readFile(new URL("../app/data/existing-users.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build-existing-materials.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(page, /downloadPng/);
  assert.doesNotMatch(page, /本地原型|prototype-badge/);
  assert.doesNotMatch(page, /existingUsers|TeamUser|teamUsers|tab === "team"|团队设置|settings-grid|toggleAccount/);
  assert.doesNotMatch(page, /importMaterials|importInput|导入纯文字贴文/);
  assert.match(page, /按作者筛选/);
  assert.match(page, /matchesAuthor/);
  assert.match(page, /CATEGORY_ORDER/);
  assert.match(page, /function SourceLinkIcon/);
  assert.match(page, /function CandidateMetric/);
  assert.match(page, /candidate-metrics/);
  assert.match(page, /const \[cardMetrics, setCardMetrics\]/);
  assert.match(page, /setCardMetrics\(\{ \.\.\.post\.metrics \}\)/);
  assert.match(page, /METRIC_FIELDS\.map/);
  assert.match(page, /type="number"/);
  assert.match(page, /恢复原始数据/);
  assert.match(page, /浏览 \{formatMetric\(post\.metrics\.views\)\}/);
  assert.match(page, /M10 13a5 5 0 0 0 7\.54/);
  assert.doesNotMatch(page, /🔗/);
  assert.match(page, /title="查看原贴"/);
  assert.match(page, /href=\{post\.link\} target="_blank" rel="noreferrer"/);
  assert.match(page, /resize-corner/);
  assert.match(page, /const CANVAS_WIDTH = 1080/);
  assert.match(page, /const CANVAS_HEIGHT = 1440/);
  assert.match(page, /const [canvasDisplayScale, setCanvasDisplayScale]/);
  assert.match(page, /availableWidth \/ CANVAS_WIDTH, availableHeight \/ CANVAS_HEIGHT/);
  assert.match(page, /className="canvas-area"/);
  assert.match(page, /className="canvas-viewport"/);
  assert.match(page, /"--canvas-display-scale": canvasDisplayScale/);
  assert.match(page, /const PREVIEW_CARD_MARGIN = 0/);
  assert.doesNotMatch(page, /MAX_CARD_SCALE|ABSOLUTE_CARD_SCALE_CEILING/);
  assert.match(page, /const widthLimit = poster\.clientWidth \/ baseWidth/);
  assert.match(page, /const heightLimit = poster\.clientHeight \/ baseHeight/);
  assert.doesNotMatch(page, /leftLimit|rightLimit|bottomLimit/);
  assert.match(page, /canvas\.width \/ X_TEMPLATE_WIDTH/);
  assert.match(page, /canvas\.height \/ templateCardHeight/);
  assert.match(page, /const dragSession = useRef/);
  assert.match(page, /offsetX: event\.clientX - \(cardRect\.left \+ cardRect\.width \/ 2\)/);
  assert.match(page, /event\.clientX - drag\.offsetX - rect\.left/);
  assert.doesNotMatch(page, /resize-handle/);
  assert.match(page, /X_TEMPLATE_WIDTH = 1196/);
  assert.match(page, /X_TEMPLATE_BODY_FONT = 30/);
  assert.match(page, /canvas\.width \* 0\.72/);
  assert.doesNotMatch(page, /value != null && value > 0/);
  assert.doesNotMatch(page, /value >= 1000(?!0)/);
  assert.match(page, /value < 1000000 \? 1 : 0/);
  assert.doesNotMatch(page, /setFontSize|正文字号/);
  for (const action of ["reply", "repost", "like", "bookmark", "share"]) {
    assert.match(page, new RegExp(`XAction name="${action}"`));
  }
  assert.match(page, /M1\.751 10c0-4\.42/);
  assert.match(page, /M4\.5 3\.88l4\.432 4\.14/);
  assert.match(page, /M16\.697 5\.5c-1\.222/);
  assert.match(page, /M4 4\.5C4 3\.12/);
  assert.match(page, /M12 2\.59l5\.7 5\.7/);
  assert.doesNotMatch(page, /BLANKSPACE · TEAM EDITION|poster-caption/);
  assert.match(page, /backgrounds\/ny-sunset\.jpg/);
  assert.match(page, /backgrounds\/itadaki-city-night\.jpg/);
  assert.match(page, /backgrounds\/sunny-city-blue-sky\.jpg/);
  assert.match(page, /backgrounds\/sunny-city-clouds\.jpg/);
  assert.match(page, /backgrounds\/sunset-city-water\.jpg/);
  assert.match(page, /backgrounds\/sunset-city-glass\.jpg/);
  assert.match(page, /backgrounds\/alpine-clouds\.jpg/);
  assert.match(page, /backgrounds\/alpine-clear-sky\.jpg/);
  await access(new URL("../public/backgrounds/itadaki-city-night.jpg", import.meta.url));
  await access(new URL("../public/backgrounds/sunny-city-blue-sky.jpg", import.meta.url));
  await access(new URL("../public/backgrounds/sunny-city-clouds.jpg", import.meta.url));
  await access(new URL("../public/backgrounds/sunset-city-water.jpg", import.meta.url));
  await access(new URL("../public/backgrounds/sunset-city-glass.jpg", import.meta.url));
  await access(new URL("../public/backgrounds/alpine-clouds.jpg", import.meta.url));
  await access(new URL("../public/backgrounds/alpine-clear-sky.jpg", import.meta.url));
  assert.deepEqual(
    (await readdir(new URL("../public/backgrounds/", import.meta.url))).sort(),
    [
      "beijing-bluehour.jpg",
      "hongkong-neon.jpg",
      "itadaki-city-night.jpg",
      "ny-sunset.jpg",
      "sunny-city-blue-sky.jpg",
      "sunny-city-clouds.jpg",
      "sunset-city-water.jpg",
      "sunset-city-glass.jpg",
      "alpine-clouds.jpg",
      "alpine-clear-sky.jpg",
    ].sort(),
  );
  assert.match(layout, /lang="zh-CN"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  const materialRecords = JSON.parse(materials);
  assert.equal(materialRecords.length, 122);
  assert.deepEqual([...new Set(materialRecords.map((item) => item.source))].sort(), ["rwayne", "黄小木"].sort());
  assert.ok(materialRecords.every((item) => item.category !== "纯文字"));
  assert.ok(materialRecords.every((item) => item.category !== "类别"));
  assert.ok(materialRecords.every((item) => !item.tags.includes("纯文字")));
  assert.ok(materialRecords.every((item) => /^https:\/\/x\.com\/[^/]+\/status\/\d+$/u.test(item.link)));
  const rwayneRecords = materialRecords.filter((item) => item.source === "rwayne");
  const rwayneCategories = Object.fromEntries(
    [...new Set(rwayneRecords.map((item) => item.category))]
      .map((category) => [category, rwayneRecords.filter((item) => item.category === category).length]),
  );
  assert.deepEqual(rwayneCategories, {
    "情绪八卦": 17,
    "社会观察": 12,
    "平台产品": 5,
    "认知提升": 15,
    "职场裁员": 6,
    "赚钱副业": 10,
    "生活冷知识": 18,
    "AI学习": 1,
    "AI工具": 1,
    "其他": 1,
    "AI世界观": 4,
    "AI认知": 3,
    "AI商业": 3,
    "AI实操": 2,
    "AI效率": 3,
  });
  const firstRwayne = materialRecords.find((item) => item.id === "existing-rwayne-2043147477243789820");
  assert.equal(firstRwayne.category, "AI世界观");
  assert.equal(
    materialRecords.find((item) => item.id === "existing-rwayne-2065059725612601446").category,
    "生活冷知识",
  );
  assert.deepEqual(firstRwayne.metrics, {
    replies: 662,
    reposts: 4407,
    likes: 37000,
    bookmarks: 2295,
    views: 3340000,
  });
  assert.ok(rwayneRecords.filter((item) => item.metrics.replies > 0).length >= 90);
  assert.ok(rwayneRecords.filter((item) => item.metrics.likes > 0).length >= 90);
  assert.match(
    materialRecords.find((item) => item.id === "existing-rwayne-2026059605995110423").text,
    /3\.\n东亚人润出去/u,
  );
  assert.equal(
    materialRecords.find((item) => item.id === "existing-rwayne-2037896856559390822").text,
    "小红书上带货的能不能直接说价格\n整天私私私\n跟蛇一样\n私了要么不回复\n要么要加微信…",
  );
  assert.ok(materialRecords.filter((item) => item.text.includes("\n")).length >= 80);
  const crawledHighExposure = materialRecords.filter((item) => item.id.startsWith("crawl-"));
  assert.equal(crawledHighExposure.length, 5);
  assert.ok(crawledHighExposure.every((item) => item.metrics.views > 100000));
  assert.ok(crawledHighExposure.every((item) => !/https?:\/\//u.test(item.text)));
  assert.ok(crawledHighExposure.every((item) => item.category !== "其他"));
  const accountRecords = JSON.parse(accounts);
  assert.equal(accountRecords.length, 2);
  assert.deepEqual(accountRecords.map((item) => item.id), ["ai-xiaomu", "rwayne"]);
  assert.equal(accountRecords.find((item) => item.id === "rwayne").avatar, "/avatars/rwayne.png");
  assert.equal(accountRecords.find((item) => item.id === "ai-xiaomu").avatar, "/avatars/ai-xiaomu.png");
  assert.equal(JSON.parse(users).length, 5);
  assert.deepEqual(
    JSON.parse(users).filter((item) => item.accountIds.length).map((item) => item.accountIds[0]),
    ["ai-xiaomu", "rwayne"],
  );
  assert.doesNotMatch(materials, /Stanleysobest/);
  assert.doesNotMatch(materials, /weiyux2021|wsl8297/);
  assert.doesNotMatch(page, /parseCsv|normalizeImported|extractRecords|preserveTextValue/);
  assert.match(page, /function AccountAvatar/);
  assert.match(page, /await loadCanvasImage\(account\.avatar\)/);
  assert.match(syncScript, /extract-screenshot-metrics\.swift/);
  assert.match(syncScript, /category-refinements\.json/);
  assert.match(syncScript, /restoreScreenshotLineBreaks/);
  assert.match(syncScript, /screenshot\.bodyLines/);
  assert.match(syncScript, /readDirectoryCategories/);
  assert.match(syncScript, /crawled-high-exposure-materials\.json/);
  assert.doesNotMatch(syncScript, /pic\.twitter\.com|t\.co/);
  assert.match(styles, /\.tweet-card[\s\S]*?border-radius: 0/);
  assert.match(styles, /\.x-action-icon[\s\S]*?fill: currentColor/);
  assert.match(styles, /\.source-link-icon[\s\S]*?stroke: currentColor/);
  assert.match(styles, /\.candidate-metrics[\s\S]*?flex-wrap: nowrap/);
  assert.match(styles, /\.candidate-metric[\s\S]*?white-space: nowrap/);
  assert.match(styles, /\.metric-input-grid[\s\S]*?grid-template-columns/);
  assert.match(styles, /\.primary-action[\s\S]*?padding: 8px 12px[\s\S]*?font-size: 11px/);
  assert.match(page, /brand\/xjlb-logo\.png/);
  await access(new URL("../public/brand/xjlb-logo.png", import.meta.url));
  assert.doesNotMatch(styles, /\.prototype-badge/);
  assert.doesNotMatch(styles, /\.settings-grid|\.settings-card|\.permission-row|\.connector-diagram|\.security-note|\.phase-card/);
  assert.doesNotMatch(styles, /\.poster-caption/);
  assert.match(styles, /\.tweet-card \{[\s\S]*?width: 598px/);
  assert.match(styles, /width: 1080px/);
  assert.match(styles, /height: 1440px/);
  assert.match(styles, /scale\(var\(--canvas-display-scale, \.4\)\)/);
  assert.match(styles, /scale\(calc\(var\(--card-scale, 1\) \* var\(--preview-card-base-scale, 1\.3\)\)\)/);
  assert.match(styles, /\.tweet-card p \{[\s\S]*?font-size: 15px[\s\S]*?line-height: 20px/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
