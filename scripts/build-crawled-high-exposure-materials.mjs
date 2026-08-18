import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = [
  { author: "rwayne", label: "rwayne", input: "outputs/x-high-exposure-pure-text/rwayne/materials-all.json" },
  { author: "ai_xiaomu", label: "黄小木", input: "outputs/x-high-exposure-pure-text/ai_xiaomu/materials-all.json" },
  { author: "dashen_wang", label: "AI最严厉的父亲", input: "outputs/x-high-exposure-pure-text/dashen_wang/materials-all.json" },
  { author: "ai_jacksaku", label: "阿川 | AI thinking", input: "outputs/x-high-exposure-pure-text/AI_jacksaku/materials-all.json" },
];
const outputPath = path.resolve(projectRoot, "app/data/crawled-high-exposure-materials.json");
const categoryPath = path.resolve(projectRoot, "scripts/high-exposure-category-overrides.json");

const readJson = async (filename) => JSON.parse(await readFile(filename, "utf8"));
const categories = await readJson(categoryPath);
const categoryById = new Map((categories.items ?? []).map((item) => [String(item.post_id), item]));
const items = [];

const hasTextUrl = (text) => {
  const compact = String(text ?? "").replace(/\s+/gu, "");
  return /(?:https?:\/\/|www\.|(?:x|twitter)\.com\/|t\.co\/)/iu.test(compact);
};

const includesAny = (text, words) => words.some((word) => text.includes(word));

function classifyByReuseIntent(value) {
  const text = String(value ?? "").toLowerCase();
  const isAi = /(?:^|[^a-z])ai(?:$|[^a-z])/iu.test(text) || includesAny(text, [
    "agi", "gpt", "chatgpt", "openai", "claude", "gemini", "deepseek", "grok",
    "大模型", "模型", "提示词", "智能体", "agent", "mcp", "codex", "vibe coding",
  ]);
  if (isAi) {
    if (includesAny(text, ["商业", "创业", "公司", "市场", "客户", "营收", "融资", "变现", "赚钱", "付费", "产品经理"])) return "AI商业";
    if (includesAny(text, ["学习", "课程", "教育", "学生", "老师", "训练营", "教材"])) return "AI学习";
    if (includesAny(text, ["工作流", "自动化", "效率", "生产力", "省时间", "提效", "批量", "流程"])) return "AI效率";
    if (includesAny(text, ["教程", "实操", "步骤", "提示词", "prompt", "怎么用", "如何用", "配置", "部署", "代码", "编程", "开发", "coding", "复现"])) return "AI实操";
    if (includesAny(text, ["未来", "时代", "革命", "趋势", "取代", "替代", "世界", "文明", "历史", "规则", "十年", "浪潮", "终局"])) return "AI世界观";
    if (includesAny(text, ["工具", "软件", "插件", "平台", "应用", "版本", "发布", "上线", "功能"])) return "AI工具";
    return "AI认知";
  }
  if (includesAny(text, ["副业", "赚钱", "收入", "生意", "利润", "带货", "变现", "理财", "投资", "股票", "房价"])) return "赚钱副业";
  if (includesAny(text, ["职场", "工作", "上班", "裁员", "面试", "简历", "工资", "老板", "同事", "程序员", "失业"])) return "职场裁员";
  if (includesAny(text, ["小红书", "抖音", "微博", "微信", "推特", "twitter", "x平台", "app", "产品", "平台", "用户体验"])) return "平台产品";
  if (includesAny(text, ["冷知识", "原来", "居然", "药", "医院", "医生", "身体", "健康", "吃", "喝", "睡", "天气", "手机", "电脑"])) return "生活冷知识";
  if (includesAny(text, ["明星", "八卦", "热搜", "恋爱", "前任", "婚姻", "离婚", "男女", "情绪", "笑死", "哈哈"])) return "情绪八卦";
  if (includesAny(text, ["社会", "国家", "城市", "政府", "政策", "教育", "人口", "年轻人", "中国", "日本", "美国", "深圳", "上海", "北京"])) return "社会观察";
  return "认知提升";
}

for (const source of sources) {
  const inputPath = path.resolve(projectRoot, source.input);
  await access(inputPath);
  const payload = await readJson(inputPath);
  if (payload.schema !== "x-high-exposure-pure-text/v1" || payload.author !== source.author) {
    throw new Error(`Unexpected high-exposure payload: ${source.input}`);
  }
  for (const raw of payload.items ?? []) {
    const classification = categoryById.get(String(raw.postId));
    const category = classification?.category || classifyByReuseIntent(raw.text);
    if (!raw.text || !raw.link || Number(raw.metrics?.views ?? 0) <= 5000 || hasTextUrl(raw.text)) {
      if (hasTextUrl(raw.text)) continue;
      throw new Error(`Invalid high-exposure material for X post ${raw.postId}`);
    }
    items.push({
      ...raw,
      source: source.label,
      category,
      tags: [category, source.label],
      note: classification?.reason || "严格抓取并按复用意图完成语义分类的高曝光纯文字原创帖",
    });
  }
}

const deduped = Array.from(new Map(items.map((item) => [String(item.postId), item])).values())
  .sort((left, right) => right.metrics.views - left.metrics.views || right.date.localeCompare(left.date));
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(deduped, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: path.relative(projectRoot, outputPath), total: deduped.length }, null, 2));
