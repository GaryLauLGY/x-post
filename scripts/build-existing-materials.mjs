import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sources = [
  {
    id: "ai-xiaomu",
    label: "黄小木",
    manifest: "../Social/output/X分析/黄小木/完整采集/工作文件/collection_manifest.json",
    categories: "../Social/output/X分析/黄小木/完整采集/工作文件/pure_text_category_manifest.json",
    refinements: "scripts/category-refinements.json",
    screenshotManifest: "../Social/output/X分析/黄小木/完整采集/工作文件/screenshot_manifest.json",
  },
  {
    id: "rwayne",
    label: "rwayne",
    manifest: "../Social/output/X分析/rwayne/旧版整理稿/工作文件/collection_manifest.json",
    categories: "scripts/rwayne-category-overrides.json",
    refinements: "scripts/category-refinements.json",
    categoryDirectory: "../Social/output/X分析/rwayne/旧版整理稿/可发素材_晴天城市精选",
  },
];

const accounts = [
  { id: "ai-xiaomu", name: "黄小木", handle: "@ai_xiaomu", verified: true, label: "#黄小木", accent: "#263033", avatar: "/avatars/ai-xiaomu.png" },
  { id: "rwayne", name: "Roland.W", handle: "@rwayne", verified: true, label: "#RolandW", accent: "#756b92", avatar: "/avatars/rwayne.png" },
];

const users = [
  { id: "user-gyro-ai", name: "Gyro", handle: "@gyro_ai", role: "已导入用户", accountIds: [] },
  { id: "user-weiyux2021", name: "动物园园长", handle: "@weiyux2021", role: "已导入用户", accountIds: [] },
  { id: "user-wsl8297", name: "Joruno", handle: "@wsl8297", role: "已导入用户", accountIds: [] },
  { id: "user-ai-xiaomu", name: "黄小木", handle: "@ai_xiaomu", role: "已导入用户", accountIds: ["ai-xiaomu"] },
  { id: "user-rwayne", name: "Roland.W", handle: "@rwayne", role: "已导入用户", accountIds: ["rwayne"] },
];

const readJson = async (relativePath) =>
  JSON.parse(await readFile(path.resolve(projectRoot, relativePath), "utf8"));

const readDirectoryCategories = async (relativePath) => {
  if (!relativePath) return [];
  const categoryRoot = path.resolve(projectRoot, relativePath);
  const entries = await readdir(categoryRoot, { withFileTypes: true });
  const classifications = [];

  for (const categoryEntry of entries) {
    if (!categoryEntry.isDirectory()) continue;
    const files = await readdir(path.join(categoryRoot, categoryEntry.name), { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile()) continue;
      const match = file.name.match(/_(\d+)_material\.png$/u);
      if (!match) continue;
      classifications.push({
        post_id: match[1],
        category: categoryEntry.name,
        reason: "来自现有纯文字分类素材目录",
      });
    }
  }

  return classifications;
};

const preserveText = (value) => String(value ?? "").replace(/\r\n?/gu, "\n");

const alignmentCharacters = (value) => {
  const characters = [];
  let sourceIndex = 0;
  for (const character of Array.from(preserveText(value))) {
    if (!/\s/u.test(character)) {
      characters.push({
        character,
        normalized: character.normalize("NFKC").toLowerCase(),
        sourceIndex,
      });
    }
    sourceIndex += character.length;
  }
  return characters;
};

function restoreScreenshotLineBreaks(sourceText, bodyLines) {
  const source = preserveText(sourceText);
  if (!source.trim() || !Array.isArray(bodyLines) || bodyLines.length < 2) return source;

  const sourceCharacters = alignmentCharacters(source);
  const ocrCharacters = alignmentCharacters(bodyLines.join("\n"));
  if (!sourceCharacters.length || !ocrCharacters.length) return source;

  const lineBoundaries = [];
  let ocrCharacterCount = 0;
  for (const line of bodyLines.slice(0, -1)) {
    ocrCharacterCount += alignmentCharacters(line).length;
    if (ocrCharacterCount > 0) lineBoundaries.push(ocrCharacterCount - 1);
  }

  const rowCount = ocrCharacters.length + 1;
  const columnCount = sourceCharacters.length + 1;
  const costs = Array.from({ length: rowCount }, () => new Uint16Array(columnCount));
  const steps = Array.from({ length: rowCount }, () => new Uint8Array(columnCount));
  for (let row = 1; row < rowCount; row += 1) {
    costs[row][0] = row;
    steps[row][0] = 1;
  }
  for (let column = 1; column < columnCount; column += 1) {
    costs[0][column] = column;
    steps[0][column] = 2;
  }

  for (let row = 1; row < rowCount; row += 1) {
    for (let column = 1; column < columnCount; column += 1) {
      const substitution = costs[row - 1][column - 1] +
        (ocrCharacters[row - 1].normalized === sourceCharacters[column - 1].normalized ? 0 : 1);
      const insertOcr = costs[row - 1][column] + 1;
      const skipSource = costs[row][column - 1] + 1;
      const best = Math.min(substitution, insertOcr, skipSource);
      costs[row][column] = best;
      steps[row][column] = best === substitution ? 0 : (best === insertOcr ? 1 : 2);
    }
  }

  const ocrToSource = new Map();
  let exactMatches = 0;
  let row = ocrCharacters.length;
  let column = sourceCharacters.length;
  while (row > 0 || column > 0) {
    const step = steps[row][column];
    if (row > 0 && column > 0 && step === 0) {
      ocrToSource.set(row - 1, column - 1);
      if (ocrCharacters[row - 1].normalized === sourceCharacters[column - 1].normalized) exactMatches += 1;
      row -= 1;
      column -= 1;
    } else if (row > 0 && (column === 0 || step === 1)) {
      row -= 1;
    } else {
      column -= 1;
    }
  }

  const matchCoverage = exactMatches / Math.min(ocrCharacters.length, sourceCharacters.length);
  if (matchCoverage < 0.6) return source;

  const sourceBreaks = new Set();
  for (const boundary of lineBoundaries) {
    let mappedIndex = boundary;
    while (mappedIndex >= 0 && !ocrToSource.has(mappedIndex)) mappedIndex -= 1;
    const sourceCharacterIndex = ocrToSource.get(mappedIndex);
    if (sourceCharacterIndex == null || sourceCharacterIndex >= sourceCharacters.length - 1) continue;
    sourceBreaks.add(
      sourceCharacters[sourceCharacterIndex].sourceIndex + sourceCharacters[sourceCharacterIndex].character.length,
    );
  }

  let restored = "";
  for (let index = 0; index < source.length; index += 1) {
    restored += source[index];
    if (sourceBreaks.has(index + 1) && source[index] !== "\n") restored += "\n";
  }
  return restored.replace(/[ \t]+\n/gu, "\n").replace(/\n[ \t]+/gu, "\n");
}

const extractScreenshotMetrics = (posts) => {
  const screenshotPaths = posts.map((post) => post.screenshot_path).filter(Boolean);
  if (!screenshotPaths.length) return new Map();
  const output = execFileSync(
    "swift",
    [path.resolve(projectRoot, "scripts/extract-screenshot-metrics.swift"), ...screenshotPaths],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  return new Map(JSON.parse(output).map((item) => [item.path, item]));
};

const items = [];

for (const source of sources) {
  const manifest = await readJson(source.manifest);
  const refinementItems = source.refinements
    ? ((await readJson(source.refinements)).items ?? []).filter((item) => item.source === source.id)
    : [];
  const categoryItems = [
    ...(source.categories ? (await readJson(source.categories)).items ?? [] : []),
    ...await readDirectoryCategories(source.categoryDirectory),
    ...refinementItems,
  ];
  const categoryById = new Map(categoryItems.map((item) => [String(item.post_id), item]));
  const metricRows = source.metrics ? (await readJson(source.metrics)).rows ?? [] : [];
  const screenshotRows = source.screenshotManifest ? (await readJson(source.screenshotManifest)).confirmed ?? [] : [];
  const metricsById = new Map(
    [...metricRows, ...screenshotRows].map((item) => [String(item["Post id"] ?? item.post_id), item]),
  );

  const pureTextPosts = manifest.pure_text_posts ?? [];
  const screenshotMetrics = extractScreenshotMetrics(pureTextPosts);
  for (const post of pureTextPosts) {
      const postId = String(post.post_id);
      const classification = categoryById.get(postId);
      const screenshot = screenshotMetrics.get(post.screenshot_path) ?? {};
      const publicMetrics = metricsById.get(postId) ?? screenshot;
      const text = restoreScreenshotLineBreaks(post.original_text ?? post.csv_text, screenshot.bodyLines);
      if (!text.trim()) continue;
      const category = classification?.category || "其他";
      items.push({
        id: `existing-${source.id}-${postId}`,
        text,
        source: source.label,
        date: String(post.published_at || ""),
        link: String(post.link || ""),
        category,
        tags: [category, source.label],
        note: classification?.reason || "来自现有纯文字素材库",
        metrics: {
          replies: Number(publicMetrics.Replies ?? publicMetrics.replies ?? post.replies ?? 0),
          reposts: Number(publicMetrics.Reposts ?? publicMetrics.reposts ?? post.reposts ?? 0),
          likes: Number(publicMetrics.Likes ?? publicMetrics.likes ?? post.likes ?? 0),
          bookmarks: Number(publicMetrics.Bookmarks ?? publicMetrics.bookmarks ?? post.bookmarks ?? 0),
          views: Number(publicMetrics.Impressions ?? post.impressions ?? 0),
        },
      });
  }
}

const crawledItems = await readJson("app/data/crawled-high-exposure-materials.json");
const indexByPostId = new Map(
  items.map((item, index) => [String(item.link).match(/\/status\/(\d+)/u)?.[1], index]),
);
for (const crawled of crawledItems) {
  const postId = String(crawled.postId || crawled.link?.match(/\/status\/(\d+)/u)?.[1] || "");
  if (!postId) throw new Error(`Crawled material is missing a post id: ${crawled.link || "unknown"}`);
  const existingIndex = indexByPostId.get(postId);
  if (existingIndex == null) {
    indexByPostId.set(postId, items.length);
    items.push(crawled);
  } else {
    const existing = items[existingIndex];
    items[existingIndex] = {
      ...existing,
      ...crawled,
      id: existing.id,
      category: crawled.category === "其他" ? existing.category : crawled.category,
      tags: crawled.category === "其他" ? existing.tags : crawled.tags,
    };
  }
}

items.sort((left, right) => right.metrics.views - left.metrics.views || right.date.localeCompare(left.date));

const outputPath = path.resolve(projectRoot, "app/data/existing-materials.json");
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
await writeFile(path.resolve(projectRoot, "app/data/existing-accounts.json"), `${JSON.stringify(accounts, null, 2)}\n`, "utf8");
await writeFile(path.resolve(projectRoot, "app/data/existing-users.json"), `${JSON.stringify(users, null, 2)}\n`, "utf8");

const sourceSummary = Object.fromEntries(
  sources.map((source) => [source.label, items.filter((item) => item.source === source.label).length]),
);
console.log(JSON.stringify({ output: path.relative(projectRoot, outputPath), total: items.length, sources: sourceSummary }, null, 2));
