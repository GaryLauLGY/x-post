import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = [
  { author: "rwayne", label: "rwayne", input: "outputs/x-high-exposure-pure-text/rwayne/materials-all.json" },
  { author: "ai_xiaomu", label: "黄小木", input: "outputs/x-high-exposure-pure-text/ai_xiaomu/materials-all.json" },
];
const outputPath = path.resolve(projectRoot, "app/data/crawled-high-exposure-materials.json");
const categoryPath = path.resolve(projectRoot, "scripts/high-exposure-category-overrides.json");

const readJson = async (filename) => JSON.parse(await readFile(filename, "utf8"));
const categories = await readJson(categoryPath);
const categoryById = new Map((categories.items ?? []).map((item) => [String(item.post_id), item]));
const items = [];

for (const source of sources) {
  const inputPath = path.resolve(projectRoot, source.input);
  await access(inputPath);
  const payload = await readJson(inputPath);
  if (payload.schema !== "x-high-exposure-pure-text/v1" || payload.author !== source.author) {
    throw new Error(`Unexpected high-exposure payload: ${source.input}`);
  }
  for (const raw of payload.items ?? []) {
    const classification = categoryById.get(String(raw.postId));
    if (!classification || !classification.category || classification.category === "其他") {
      throw new Error(`Missing semantic category for X post ${raw.postId}`);
    }
    if (!raw.text || !raw.link || Number(raw.metrics?.views ?? 0) <= 100000) {
      throw new Error(`Invalid high-exposure material for X post ${raw.postId}`);
    }
    items.push({
      ...raw,
      source: source.label,
      category: classification.category,
      tags: [classification.category, source.label],
      note: classification.reason || "严格抓取并完成语义分类的高曝光纯文字原创帖",
    });
  }
}

const deduped = Array.from(new Map(items.map((item) => [String(item.postId), item])).values())
  .sort((left, right) => right.metrics.views - left.metrics.views || right.date.localeCompare(left.date));
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(deduped, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: path.relative(projectRoot, outputPath), total: deduped.length }, null, 2));
