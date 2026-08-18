"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import existingAccounts from "./data/existing-accounts.json";
import existingMaterials from "./data/existing-materials.json";

type Account = {
  id: string;
  name: string;
  handle: string;
  verified: boolean;
  label: string;
  accent: string;
  avatar?: string;
};

type PostMetrics = {
  replies: number;
  reposts: number;
  likes: number;
  bookmarks: number;
  views: number;
};

type Post = {
  id: string;
  text: string;
  source: string;
  date: string;
  link: string;
  category: string;
  tags: string[];
  note?: string;
  metrics: PostMetrics;
};

type Background = {
  id: string;
  name: string;
  kind: "gradient" | "image";
  value: string;
  palette?: string[];
};

type ActionIconName = "reply" | "repost" | "like" | "bookmark" | "share";

const X_TEMPLATE_WIDTH = 1196;
const X_TEMPLATE_BODY_FONT = 30;
const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1440;
const PREVIEW_BASE_SCALE = (CANVAS_WIDTH * 0.72) / (X_TEMPLATE_WIDTH / 2);
const PREVIEW_CARD_MARGIN = 0;
const CATEGORY_ORDER = [
  "AI工具",
  "AI效率",
  "AI实操",
  "AI世界观",
  "AI认知",
  "AI商业",
  "AI学习",
  "认知提升",
  "赚钱副业",
  "职场裁员",
  "社会观察",
  "平台产品",
  "生活冷知识",
  "情绪八卦",
  "其他",
];
const GLOBAL_TAG_POOL = [
  "认知",
  "思考",
  "洞察",
  "趋势",
  "成长",
  "方法论",
  "信息差",
  "新知",
  "观察",
  "经验",
];
const CATEGORY_PUBLISHING: Record<string, { caption: string; tag: string }> = {
  AI工具: { caption: "这个 AI 工具值得收藏，关键时刻真能提升效率。", tag: "AI工具" },
  AI效率: { caption: "真正拉开效率差距的，是把 AI 用进每天的工作流。", tag: "效率工具" },
  AI实操: { caption: "与其讨论 AI，不如先把这个方法真正跑一遍。", tag: "AI实战" },
  AI世界观: { caption: "AI 正在重写规则，越早看懂变化，越能掌握主动权。", tag: "AI趋势" },
  AI认知: { caption: "理解 AI 的边界，比盲目追逐每个新模型更重要。", tag: "AI思维" },
  AI商业: { caption: "AI 的价值最终要回到真实需求和商业结果。", tag: "AI商业化" },
  AI学习: { caption: "学 AI 最有效的方式，是边做边验证。", tag: "AI学习" },
  认知提升: { caption: "很多差距，往往从看待问题的方式开始拉开。", tag: "认知升级" },
  赚钱副业: { caption: "赚钱没有万能公式，但信息、执行和复利缺一不可。", tag: "副业思路" },
  职场裁员: { caption: "职场变化从不提前通知，持续积累选择权才是底气。", tag: "职场生存" },
  社会观察: { caption: "一个值得记录的社会切面，也许能帮我们重新理解日常。", tag: "社会洞察" },
  平台产品: { caption: "产品细节背后，往往藏着平台真正的取舍。", tag: "产品观察" },
  生活冷知识: { caption: "又学到一个看似不起眼、实际很有用的冷知识。", tag: "冷知识" },
  情绪八卦: { caption: "情绪之外，这件事也值得换个角度再看一遍。", tag: "热点观察" },
  其他: { caption: "先记下这个值得关注的信息，之后再慢慢消化。", tag: "值得关注" },
};
const METRIC_FIELDS: Array<{ key: keyof PostMetrics; label: string }> = [
  { key: "views", label: "浏览" },
  { key: "replies", label: "回复" },
  { key: "reposts", label: "转推" },
  { key: "likes", label: "点赞" },
  { key: "bookmarks", label: "书签" },
];
const X_ICON_PATHS: Record<ActionIconName, string> = {
  reply: "M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z",
  repost: "M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z",
  like: "M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z",
  bookmark: "M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z",
  share: "M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z",
};

function XActionIcon({ name }: { name: ActionIconName }) {
  return (
    <svg className="x-action-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={X_ICON_PATHS[name]} />
    </svg>
  );
}

function XAction({ name, value }: { name: ActionIconName; value?: number }) {
  return (
    <span className="tweet-action">
      <XActionIcon name={name} />
      {value != null && <span>{formatMetric(value)}</span>}
    </span>
  );
}

function CandidateMetric({ name, value, label }: { name: ActionIconName; value: number; label: string }) {
  return (
    <span className="candidate-metric" title={`${label} ${value}`}>
      <XActionIcon name={name} />
      <span>{formatMetric(value)}</span>
    </span>
  );
}

function SourceLinkIcon() {
  return (
    <svg className="source-link-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function AccountAvatar({ account, className }: { account: Account; className: string }) {
  return (
    <div className={className} style={{ background: account.accent }}>
      {account.avatar ? (
        <img src={account.avatar} alt="" draggable={false} />
      ) : (
        account.name.slice(0, 1)
      )}
    </div>
  );
}

const accounts = existingAccounts as Account[];

const seedPosts = existingMaterials as Post[];
const initialPost = seedPosts[0]!;
const accountForSource = (source: string) =>
  accounts.find((account) => account.name === source || account.handle.slice(1) === source);
const initialAccount = accountForSource(initialPost.source) ?? accounts[0]!;

function publishingForCategory(category: string) {
  return CATEGORY_PUBLISHING[category] ?? {
    caption: `关于${category}，这里有一个值得继续关注的观察。`,
    tag: category,
  };
}

function stableTagPair(key: string, offset = 0) {
  const seed = Array.from(key).reduce((total, character) => ((total * 31) + character.codePointAt(0)!) >>> 0, 0);
  const firstIndex = (seed + offset) % GLOBAL_TAG_POOL.length;
  let secondIndex = ((seed >>> 3) + offset * 3 + 1) % GLOBAL_TAG_POOL.length;
  if (secondIndex === firstIndex) secondIndex = (secondIndex + 1) % GLOBAL_TAG_POOL.length;
  return [GLOBAL_TAG_POOL[firstIndex]!, GLOBAL_TAG_POOL[secondIndex]!];
}

function buildPublishingTags(post: Post, account: Account, offset = 0) {
  const category = publishingForCategory(post.category);
  const categoryTag = post.category.startsWith("AI") ? "AI" : post.category;
  const [globalTagA, globalTagB] = stableTagPair(post.id, offset);
  return [categoryTag, globalTagA, globalTagB, category.tag, account.label.replace(/^#/u, "")];
}

function publishingTagLine(tags: string[]) {
  return tags.map((tag) => `#${tag}`).join(" ");
}

function buildPublishingDraft(post: Post, account: Account, offset = 0) {
  return `${publishingForCategory(post.category).caption}\n\n${publishingTagLine(buildPublishingTags(post, account, offset))}`;
}

function replacePublishingTagLine(draft: string, tags: string[]) {
  const lines = draft.split("\n");
  const lastContentIndex = lines.findLastIndex((line) => line.trim().length > 0);
  const tagPattern = /^(?:#\S+\s+){4}#\S+$/u;
  if (lastContentIndex >= 0 && tagPattern.test(lines[lastContentIndex]!.trim())) {
    lines[lastContentIndex] = publishingTagLine(tags);
    return lines.join("\n");
  }
  return `${draft.trimEnd()}\n\n${publishingTagLine(tags)}`;
}

const builtinBackgrounds: Background[] = [
  { id: "ny-sunset", name: "纽约落日", kind: "image", value: "/backgrounds/ny-sunset.jpg" },
  { id: "hongkong-neon", name: "香港霓虹", kind: "image", value: "/backgrounds/hongkong-neon.jpg" },
  { id: "itadaki-city-night", name: "城市夜幕", kind: "image", value: "/backgrounds/itadaki-city-night.jpg" },
  { id: "beijing-bluehour", name: "北京蓝调时刻", kind: "image", value: "/backgrounds/beijing-bluehour.jpg" },
  { id: "sunny-city-blue-sky", name: "晴日蓝天", kind: "image", value: "/backgrounds/sunny-city-blue-sky.jpg" },
  { id: "sunny-city-clouds", name: "晴日云城", kind: "image", value: "/backgrounds/sunny-city-clouds.jpg" },
  { id: "sunset-city-water", name: "落日水岸", kind: "image", value: "/backgrounds/sunset-city-water.jpg" },
  { id: "sunset-city-glass", name: "落日街景", kind: "image", value: "/backgrounds/sunset-city-glass.jpg" },
  { id: "alpine-clouds", name: "云下雪峰", kind: "image", value: "/backgrounds/alpine-clouds.jpg" },
  { id: "alpine-clear-sky", name: "蓝天雪峰", kind: "image", value: "/backgrounds/alpine-clear-sky.jpg" },
];

const backgroundStyle = (background: Background): CSSProperties => {
  if (background.kind === "image") {
    return { backgroundImage: `url("${background.value}")` };
  }
  const [a, b, c] = background.palette ?? ["#d7f58f", "#2d6257", "#162d28"];
  return {
    backgroundImage: `radial-gradient(circle at 20% 16%, ${a}aa 0, transparent 28%), radial-gradient(circle at 82% 80%, ${b}aa 0, transparent 34%), linear-gradient(155deg, ${b}, ${c} 62%, ${a})`,
  };
};

function formatMetric(value: number) {
  if (value >= 10000) {
    const digits = value < 1000000 ? 1 : 0;
    return `${(value / 10000).toFixed(digits).replace(/\.0$/u, "")}万`;
  }
  return String(value);
}

function formatChineseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const character of Array.from(paragraph)) {
      const test = line + character;
      if (line && context.measureText(test).width > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line = test;
      }
    }
    lines.push(line || " ");
  }
  return lines;
}

function drawCanvasAction(
  context: CanvasRenderingContext2D,
  name: ActionIconName,
  x: number,
  y: number,
  scale: number,
  value?: number,
) {
  const size = 45 * scale;
  context.save();
  context.translate(x, y - size * 0.78);
  context.scale(size / 24, size / 24);
  context.fillStyle = "#536471";
  context.fill(new Path2D(X_ICON_PATHS[name]));
  context.restore();
  if (value != null) {
    context.fillStyle = "#536471";
    context.font = `400 ${30 * scale}px Arial, PingFang SC, sans-serif`;
    context.fillText(formatMetric(value), x + 55 * scale, y);
  }
}

async function loadCanvasImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (/^https?:/i.test(url)) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("背景图片无法加载或不允许跨域导出"));
    image.src = url;
  });
}

export default function Home() {
  const [tab, setTab] = useState<"studio" | "library">("studio");
  const posts = seedPosts;
  const [selectedPostId, setSelectedPostId] = useState(initialPost.id);
  const [text, setText] = useState(initialPost.text);
  const [publishDraft, setPublishDraft] = useState(buildPublishingDraft(initialPost, initialAccount));
  const [tagOffset, setTagOffset] = useState(0);
  const [cardMetrics, setCardMetrics] = useState<PostMetrics>({ ...initialPost.metrics });
  const [accountId, setAccountId] = useState(initialAccount.id);
  const [backgrounds, setBackgrounds] = useState(builtinBackgrounds);
  const [backgroundId, setBackgroundId] = useState(builtinBackgrounds[0].id);
  const [backgroundUrl, setBackgroundUrl] = useState("");
  const [dim, setDim] = useState(24);
  const [cardScale, setCardScale] = useState(1);
  const [maxCardScale, setMaxCardScale] = useState(1);
  const [canvasDisplayScale, setCanvasDisplayScale] = useState(0.4);
  const [cardX, setCardX] = useState(50);
  const [cardY, setCardY] = useState(31);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("全部");
  const [author, setAuthor] = useState("全部");
  const [toast, setToast] = useState("");
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const posterRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const dragSession = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const resizeSession = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    startDistance: number;
    startScale: number;
  } | null>(null);

  const selectedPost = posts.find((post) => post.id === selectedPostId) ?? posts[0];
  const availableAccounts = accounts;
  const account = availableAccounts.find((item) => item.id === accountId) ?? availableAccounts[0] ?? accounts[0]!;
  const background = backgrounds.find((item) => item.id === backgroundId) ?? backgrounds[0] ?? builtinBackgrounds[0]!;
  const authors = useMemo(() => ["全部", ...Array.from(new Set(posts.map((post) => post.source)))], [posts]);
  const categories = useMemo(() => {
    const available = new Set(posts.map((post) => post.category));
    const ordered = CATEGORY_ORDER.filter((item) => available.delete(item));
    return ["全部", ...ordered, ...Array.from(available)];
  }, [posts]);
  const filteredPosts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return posts.filter((post) => {
      const matchesCategory = category === "全部" || post.category === category;
      const matchesAuthor = author === "全部" || post.source === author;
      const haystack = [post.text, post.source, post.category, ...post.tags].join(" ").toLowerCase();
      return matchesCategory && matchesAuthor && (!needle || haystack.includes(needle));
    });
  }, [author, category, posts, search]);
  const effectiveCardScale = Math.min(cardScale, maxCardScale);

  useEffect(() => {
    if (tab !== "studio") return;
    const canvasArea = canvasAreaRef.current;
    if (!canvasArea) return;

    const updateCanvasDisplayScale = () => {
      const styles = window.getComputedStyle(canvasArea);
      const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      const availableWidth = Math.max(1, canvasArea.clientWidth - horizontalPadding);
      const availableHeight = Math.max(1, canvasArea.clientHeight - verticalPadding);
      const nextScale = Math.max(
        0.08,
        Math.min(availableWidth / CANVAS_WIDTH, availableHeight / CANVAS_HEIGHT),
      );
      setCanvasDisplayScale((current) => Math.abs(current - nextScale) < 0.0005 ? current : nextScale);
    };

    updateCanvasDisplayScale();
    const observer = new ResizeObserver(updateCanvasDisplayScale);
    observer.observe(canvasArea);
    return () => observer.disconnect();
  }, [tab]);

  useEffect(() => {
    if (tab !== "studio") return;
    const poster = posterRef.current;
    const card = cardRef.current;
    if (!poster || !card) return;

    const updateFitLimit = () => {
      const baseWidth = Math.max(1, card.offsetWidth * PREVIEW_BASE_SCALE);
      const baseHeight = Math.max(1, card.offsetHeight * PREVIEW_BASE_SCALE);
      const widthLimit = poster.clientWidth / baseWidth;
      const heightLimit = poster.clientHeight / baseHeight;
      const nextLimit = Math.max(0.08, Math.min(widthLimit, heightLimit));
      setMaxCardScale((current) => Math.abs(current - nextLimit) < 0.001 ? current : nextLimit);
    };

    updateFitLimit();
    const observer = new ResizeObserver(updateFitLimit);
    observer.observe(poster);
    observer.observe(card);
    return () => observer.disconnect();
  }, [selectedPostId, tab, text]);

  useEffect(() => {
    if (tab !== "studio") return;
    const poster = posterRef.current;
    const card = cardRef.current;
    if (!poster || !card) return;

    const frame = window.requestAnimationFrame(() => {
      const visualWidth = card.offsetWidth * PREVIEW_BASE_SCALE * effectiveCardScale;
      const visualHeight = card.offsetHeight * PREVIEW_BASE_SCALE * effectiveCardScale;
      const minX = Math.min(50, ((PREVIEW_CARD_MARGIN + visualWidth / 2) / poster.clientWidth) * 100);
      const maxX = Math.max(50, 100 - minX);
      const minY = (PREVIEW_CARD_MARGIN / poster.clientHeight) * 100;
      const maxY = Math.max(
        minY,
        100 - ((PREVIEW_CARD_MARGIN + visualHeight) / poster.clientHeight) * 100,
      );
      setCardX((current) => Math.min(maxX, Math.max(minX, current)));
      setCardY((current) => Math.min(maxY, Math.max(minY, current)));
    });

    return () => window.cancelAnimationFrame(frame);
  }, [effectiveCardScale, selectedPostId, tab, text]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const choosePost = (post: Post) => {
    const sourceAccount = accountForSource(post.source) ?? account;
    setSelectedPostId(post.id);
    setText(post.text);
    setPublishDraft(buildPublishingDraft(post, sourceAccount));
    setTagOffset(0);
    setCardMetrics({ ...post.metrics });
    if (sourceAccount) setAccountId(sourceAccount.id);
  };

  const chooseAccount = (nextAccountId: string) => {
    const nextAccount = availableAccounts.find((item) => item.id === nextAccountId) ?? account;
    setAccountId(nextAccount.id);
    setPublishDraft((current) => replacePublishingTagLine(current, buildPublishingTags(selectedPost, nextAccount, tagOffset)));
  };

  const updateMetric = (key: keyof PostMetrics, value: string) => {
    const nextValue = Math.max(0, Math.floor(Number(value) || 0));
    setCardMetrics((current) => ({ ...current, [key]: nextValue }));
  };

  const restoreOriginal = () => {
    setText(selectedPost?.text ?? "");
    setCardMetrics({ ...(selectedPost?.metrics ?? initialPost.metrics) });
  };

  const restorePublishingDraft = () => {
    setPublishDraft(buildPublishingDraft(selectedPost, account, tagOffset));
  };

  const shufflePublishingTags = () => {
    const nextOffset = tagOffset + 1;
    setTagOffset(nextOffset);
    setPublishDraft((current) => replacePublishingTagLine(current, buildPublishingTags(selectedPost, account, nextOffset)));
  };

  const uploadBackground = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const item: Background = {
      id: `upload-${Date.now()}`,
      name: file.name.replace(/\.[^.]+$/, ""),
      kind: "image",
      value: URL.createObjectURL(file),
    };
    setBackgrounds((current) => [...current, item]);
    setBackgroundId(item.id);
    notify("背景已加入当前素材库");
  };

  const addNetworkBackground = () => {
    try {
      const url = new URL(backgroundUrl);
      if (!/^https?:$/.test(url.protocol)) throw new Error();
      const item: Background = {
        id: `remote-${Date.now()}`,
        name: url.hostname,
        kind: "image",
        value: url.toString(),
      };
      setBackgrounds((current) => [...current, item]);
      setBackgroundId(item.id);
      setBackgroundUrl("");
      notify("网络背景已加入；导出需图片源允许跨域");
    } catch {
      notify("请输入有效的 http(s) 图片地址");
    }
  };

  const copyPublishText = async () => {
    try {
      await navigator.clipboard.writeText(publishDraft);
      notify("发布文案已复制");
    } catch {
      notify("浏览器未授予剪贴板权限");
    }
  };

  const moveCard = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const resize = resizeSession.current;
    if (resize) {
      if (resize.pointerId !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - resize.originX, event.clientY - resize.originY);
      const minimumScale = Math.min(0.56, maxCardScale);
      const requestedScale = resize.startScale * (distance / resize.startDistance);
      setCardScale(Math.min(maxCardScale, Math.max(minimumScale, requestedScale)));
      return;
    }
    const drag = dragSession.current;
    if (!drag || drag.pointerId !== event.pointerId || resizing) return;
    const cardRect = cardRef.current?.getBoundingClientRect();
    if (!cardRect) return;
    const marginX = (PREVIEW_CARD_MARGIN / CANVAS_WIDTH) * 100;
    const marginY = (PREVIEW_CARD_MARGIN / CANVAS_HEIGHT) * 100;
    const halfWidth = (cardRect.width / rect.width) * 50;
    const cardHeight = (cardRect.height / rect.height) * 100;
    const minX = Math.min(50, marginX + halfWidth);
    const maxX = Math.max(50, 100 - minX);
    const minY = marginY;
    const maxY = Math.max(minY, 100 - marginY - cardHeight);
    const requestedX = ((event.clientX - drag.offsetX - rect.left) / rect.width) * 100;
    const requestedY = ((event.clientY - drag.offsetY - rect.top) / rect.height) * 100;
    setCardX(Math.min(maxX, Math.max(minX, requestedX)));
    setCardY(Math.min(maxY, Math.max(minY, requestedY)));
  };

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const cardRect = event.currentTarget.getBoundingClientRect();
    dragSession.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - (cardRect.left + cardRect.width / 2),
      offsetY: event.clientY - cardRect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const startResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const card = event.currentTarget.closest(".tweet-card");
    if (!(card instanceof HTMLElement)) return;
    const rect = card.getBoundingClientRect();
    const originX = rect.left + rect.width / 2;
    const originY = rect.top;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeSession.current = {
      pointerId: event.pointerId,
      originX,
      originY,
      startDistance: Math.max(1, Math.hypot(event.clientX - originX, event.clientY - originY)),
      startScale: effectiveCardScale,
    };
    setDragging(false);
    setResizing(true);
  };

  const stopPointerInteraction = () => {
    dragSession.current = null;
    resizeSession.current = null;
    setDragging(false);
    setResizing(false);
  };

  const downloadPng = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) return;
    try {
      if (background.kind === "image") {
        const image = await loadCanvasImage(background.value);
        const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      } else {
        const [a, b, c] = background.palette ?? ["#d7f58f", "#2d6257", "#162d28"];
        const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, b);
        gradient.addColorStop(0.62, c);
        gradient.addColorStop(1, a);
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
        const glow = context.createRadialGradient(210, 220, 0, 210, 220, 420);
        glow.addColorStop(0, `${a}dd`);
        glow.addColorStop(1, `${a}00`);
        context.fillStyle = glow;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.fillStyle = `rgba(0,0,0,${dim / 100})`;
      context.fillRect(0, 0, canvas.width, canvas.height);

      const basePadding = 32;
      context.font = `400 ${X_TEMPLATE_BODY_FONT}px Arial, PingFang SC, sans-serif`;
      const lines = wrapCanvasText(context, text, X_TEMPLATE_WIDTH - basePadding * 2);
      const baseLineHeight = 40;
      const baseTextTop = 134;
      const baseMetaTop = baseTextTop + Math.max(0, lines.length - 1) * baseLineHeight + 64;
      const baseDividerY = baseMetaTop + 41;
      const baseFooterY = baseDividerY + 63;
      const templateCardHeight = baseFooterY + 13;
      const requestedScale = ((canvas.width * 0.72) / X_TEMPLATE_WIDTH) * effectiveCardScale;
      const maxCanvasScale = Math.min(
        canvas.width / X_TEMPLATE_WIDTH,
        canvas.height / templateCardHeight,
      );
      const scale = Math.max(0.01, Math.min(requestedScale, maxCanvasScale));
      const width = X_TEMPLATE_WIDTH * scale;
      const cardHeight = templateCardHeight * scale;
      const padding = basePadding * scale;
      const x = Math.max(0, Math.min(canvas.width - width, (cardX / 100) * canvas.width - width / 2));
      let y = (cardY / 100) * canvas.height;
      y = Math.max(0, Math.min(y, canvas.height - cardHeight));

      context.save();
      context.shadowColor = "rgba(9,18,14,.28)";
      context.shadowBlur = 44;
      context.shadowOffsetY = 20;
      context.fillStyle = "rgba(255,255,255,.96)";
      context.fillRect(x, y, width, cardHeight);
      context.restore();

      const avatarX = x + padding + 40 * scale;
      const avatarY = y + 42 * scale;
      const avatarRadius = 40 * scale;
      if (account.avatar) {
        const avatarImage = await loadCanvasImage(account.avatar);
        context.save();
        context.beginPath();
        context.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
        context.clip();
        context.drawImage(
          avatarImage,
          avatarX - avatarRadius,
          avatarY - avatarRadius,
          avatarRadius * 2,
          avatarRadius * 2,
        );
        context.restore();
      } else {
        context.beginPath();
        context.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
        context.fillStyle = account.accent;
        context.fill();
        context.fillStyle = "#fff";
        context.font = `700 ${30 * scale}px Arial, PingFang SC, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(account.name.slice(0, 1), avatarX, avatarY + 1);
      }
      context.textAlign = "left";
      context.textBaseline = "alphabetic";

      context.fillStyle = "#0f1419";
      context.font = `700 ${30 * scale}px Arial, PingFang SC, sans-serif`;
      context.fillText(account.name, avatarX + 56 * scale, avatarY - 10 * scale);
      if (account.verified) {
        const nameWidth = context.measureText(account.name).width;
        context.beginPath();
        context.arc(avatarX + 56 * scale + nameWidth + 18 * scale, avatarY - 20 * scale, 12 * scale, 0, Math.PI * 2);
        context.fillStyle = "#1d9bf0";
        context.fill();
        context.fillStyle = "#fff";
        context.font = `700 ${15 * scale}px Arial`;
        context.textAlign = "center";
        context.fillText("✓", avatarX + 56 * scale + nameWidth + 18 * scale, avatarY - 15 * scale);
        context.textAlign = "left";
      }
      context.fillStyle = "#536471";
      context.font = `400 ${29 * scale}px Arial, PingFang SC, sans-serif`;
      context.fillText(account.handle, avatarX + 56 * scale, avatarY + 29 * scale);
      context.fillStyle = "#0f1419";
      context.font = `700 ${27 * scale}px Arial, sans-serif`;
      context.fillText("•••", x + width - padding - 52 * scale, y + 34 * scale);

      context.fillStyle = "#0f1419";
      context.font = `400 ${X_TEMPLATE_BODY_FONT * scale}px Arial, PingFang SC, sans-serif`;
      lines.forEach((line, index) => {
        context.fillText(line, x + padding, y + (baseTextTop + index * baseLineHeight) * scale);
      });

      const metaY = y + baseMetaTop * scale;
      context.fillStyle = "#536471";
      context.font = `400 ${30 * scale}px Arial, PingFang SC, sans-serif`;
      const dateText = `${formatChineseDate(selectedPost?.date ?? "")} · `;
      context.fillText(dateText, x + padding, metaY);
      const dateWidth = context.measureText(dateText).width;
      context.fillStyle = "#0f1419";
      context.font = `700 ${30 * scale}px Arial, PingFang SC, sans-serif`;
      const viewsText = formatMetric(cardMetrics.views);
      context.fillText(viewsText, x + padding + dateWidth, metaY);
      const viewsWidth = context.measureText(viewsText).width;
      context.fillStyle = "#536471";
      context.font = `400 ${30 * scale}px Arial, sans-serif`;
      context.fillText(" Views", x + padding + dateWidth + viewsWidth, metaY);

      const dividerY = y + baseDividerY * scale;
      context.strokeStyle = "#cfd9de";
      context.beginPath();
      context.moveTo(x + padding, dividerY);
      context.lineTo(x + width - padding, dividerY);
      context.stroke();

      const metricsY = y + baseFooterY * scale;
      drawCanvasAction(context, "reply", x + 31 * scale, metricsY, scale, cardMetrics.replies);
      drawCanvasAction(context, "repost", x + 298 * scale, metricsY, scale, cardMetrics.reposts);
      drawCanvasAction(context, "like", x + 574 * scale, metricsY, scale, cardMetrics.likes);
      drawCanvasAction(context, "bookmark", x + 847 * scale, metricsY, scale, cardMetrics.bookmarks);
      drawCanvasAction(context, "share", x + 1121 * scale, metricsY, scale);

      const link = document.createElement("a");
      link.download = `tweet-card-${selectedPost?.id ?? "custom"}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      notify("PNG 已生成");
    } catch (error) {
      notify(error instanceof Error ? error.message : "PNG 生成失败");
    }
  };

  return (
    <main className="app-shell">
      {toast && <div className="toast" role="status">{toast}</div>}
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <img src="/brand/xjlb-logo.png" alt="" />
        </div>
        <div className="brand-copy">
          <p className="eyebrow">星际留白 · 内容工具</p>
          <h1>推文卡片工作台</h1>
        </div>
        <nav aria-label="主导航">
          <button className={tab === "studio" ? "nav-active" : ""} onClick={() => setTab("studio")}>制作台</button>
          <button className={tab === "library" ? "nav-active" : ""} onClick={() => setTab("library")}>推文库</button>
        </nav>
        {tab === "studio" && <button className="primary-action" onClick={downloadPng}>↓ 导出 PNG</button>}
      </header>

      {tab === "studio" && (
        <section className="workspace">
          <aside className="panel library-panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">TEAM LIBRARY</span>
                <h2>团队推文库</h2>
              </div>
              <span className="count-pill">{posts.length}</span>
            </div>
            <label className="author-filter">
              <span>按作者筛选</span>
              <select value={author} onChange={(event) => setAuthor(event.target.value)} aria-label="按作者筛选">
                {authors.map((item) => <option key={item} value={item}>{item === "全部" ? "全部作者" : item}</option>)}
              </select>
            </label>
            <label className="search-box">
              <span>⌕</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="搜索推文" placeholder="搜索正文、来源或标签" />
            </label>
            <div className="category-row">
              {categories.map((item) => (
                <button key={item} className={category === item ? "chip-active" : ""} onClick={() => setCategory(item)}>{item}</button>
              ))}
            </div>
            <div className="post-list">
              {filteredPosts.map((post) => (
                <article key={post.id} className={`post-item ${post.id === selectedPostId ? "selected" : ""}`}>
                  <button className="post-select" onClick={() => choosePost(post)}>
                    <span className="post-meta"><b>{post.category}</b><time>{post.date.slice(5)}</time></span>
                    <span className="post-text">{post.text}</span>
                    <span className="candidate-metrics" aria-label={`浏览 ${post.metrics.views}，回复 ${post.metrics.replies}，转推 ${post.metrics.reposts}，点赞 ${post.metrics.likes}，书签 ${post.metrics.bookmarks}`}>
                      <span className="candidate-views">浏览 {formatMetric(post.metrics.views)}</span>
                      <CandidateMetric name="reply" value={post.metrics.replies} label="回复" />
                      <CandidateMetric name="repost" value={post.metrics.reposts} label="转推" />
                      <CandidateMetric name="like" value={post.metrics.likes} label="点赞" />
                      <CandidateMetric name="bookmark" value={post.metrics.bookmarks} label="书签" />
                    </span>
                  </button>
                  <div className="post-footer">
                    <span>{post.source} · #{post.tags[0]}</span>
                    <a href={post.link} target="_blank" rel="noreferrer" aria-label={`查看 ${post.source} 的原贴`} title="查看原贴"><SourceLinkIcon /></a>
                  </div>
                </article>
              ))}
              {!filteredPosts.length && <div className="empty-state">没有匹配的推文</div>}
            </div>
          </aside>

          <section className="stage" aria-label="卡片预览区">
            <div className="stage-toolbar">
              <span><i /> 实时预览</span>
              <span>拖动卡片调位置 · 拉右下角等比缩放 · 1080 × 1440</span>
            </div>
            <div ref={canvasAreaRef} className="canvas-area">
              <div
                className="canvas-viewport"
                style={{
                  width: CANVAS_WIDTH * canvasDisplayScale,
                  height: CANVAS_HEIGHT * canvasDisplayScale,
                }}
                aria-label="固定 1080 × 1440 画布"
              >
                <div
                  ref={posterRef}
                  className="poster"
                  style={{
                    ...backgroundStyle(background),
                    "--canvas-display-scale": canvasDisplayScale,
                    "--preview-card-base-scale": PREVIEW_BASE_SCALE,
                  } as CSSProperties}
                  onPointerMove={moveCard}
                  onPointerUp={stopPointerInteraction}
                  onPointerCancel={stopPointerInteraction}
                  onPointerLeave={() => {
                    if (!dragSession.current && !resizeSession.current) setDragging(false);
                  }}
                >
                  <div className="poster-dim" style={{ opacity: dim / 100 }} />
                  <div className="poster-noise" />
                  <article
                    ref={cardRef}
                    className={`tweet-card ${dragging ? "dragging" : ""} ${resizing ? "resizing" : ""}`}
                    style={{ "--card-scale": effectiveCardScale, left: `${cardX}%`, top: `${cardY}%` } as CSSProperties}
                    onPointerDown={startDrag}
                    onLostPointerCapture={stopPointerInteraction}
                  >
                    <header>
                      <AccountAvatar account={account} className="avatar" />
                      <div className="identity">
                        <strong>{account.name} {account.verified && <span className="verified">✓</span>}</strong>
                        <span>{account.handle}</span>
                      </div>
                      <span className="tweet-menu">•••</span>
                    </header>
                    <p>{text || "在右侧输入推文正文"}</p>
                    <div className="tweet-meta">
                      <span>{formatChineseDate(selectedPost?.date ?? "")}</span>
                      <span>·</span>
                      <strong>{formatMetric(cardMetrics.views)}</strong>
                      <span>Views</span>
                    </div>
                    <footer className="tweet-actions">
                      <XAction name="reply" value={cardMetrics.replies} />
                      <XAction name="repost" value={cardMetrics.reposts} />
                      <XAction name="like" value={cardMetrics.likes} />
                      <XAction name="bookmark" value={cardMetrics.bookmarks} />
                      <XAction name="share" />
                    </footer>
                    <span
                      className="resize-corner"
                      role="slider"
                      tabIndex={0}
                      aria-label="拖动调整卡片大小"
                      title="拖动调整卡片大小"
                      aria-valuemin={Math.round(Math.min(0.56, maxCardScale) * 100)}
                      aria-valuemax={Math.round(maxCardScale * 100)}
                      aria-valuenow={Math.round(effectiveCardScale * 100)}
                      onPointerDown={startResize}
                      onPointerUp={stopPointerInteraction}
                      onPointerCancel={stopPointerInteraction}
                      onLostPointerCapture={stopPointerInteraction}
                    />
                  </article>
                </div>
              </div>
            </div>
          </section>

          <aside className="panel control-panel">
            <div>
              <span className="section-kicker">CARD SETTINGS</span>
              <h2>卡片设置</h2>
            </div>
            <label>发布账号
              <select value={account.id} onChange={(event) => chooseAccount(event.target.value)}>
                {availableAccounts.map((item) => <option key={item.id} value={item.id}>{item.name} {item.handle}</option>)}
              </select>
            </label>
            <div className="account-preview">
              <AccountAvatar account={account} className="mini-avatar" />
              <div><strong>{account.name}</strong><span>{account.handle} · {account.label}</span></div>
              <span className="permission-ok">已授权</span>
            </div>
            <label>正文
              <textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} maxLength={280} />
            </label>
            <div className="text-actions">
              <button onClick={restoreOriginal}>使用原推</button>
              <span>{text.length} / 280</span>
            </div>
            <section className="metric-editor" aria-label="帖子数据">
              <div className="metric-editor-heading">
                <strong>帖子数据</strong>
                <button type="button" onClick={() => setCardMetrics({ ...(selectedPost?.metrics ?? initialPost.metrics) })}>恢复原始数据</button>
              </div>
              <div className="metric-input-grid">
                {METRIC_FIELDS.map((field) => (
                  <label key={field.key}>
                    <span>{field.label}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      value={cardMetrics[field.key]}
                      onChange={(event) => updateMetric(field.key, event.target.value)}
                    />
                  </label>
                ))}
              </div>
              <p>选择素材时自动带入原帖数据，修改后同步到当前预览和 PNG。</p>
            </section>
            <div className="slider-row">
              <label>背景压暗<input type="range" min="0" max="70" value={dim} onChange={(event) => setDim(Number(event.target.value))} /></label>
              <b>{dim}%</b>
            </div>
            <div className="background-heading"><strong>背景素材</strong><span>{backgrounds.length} 张</span></div>
            <div className="background-grid">
              {backgrounds.map((item) => (
                <button
                  key={item.id}
                  aria-label={item.name}
                  title={item.name}
                  className={item.id === background.id ? "background-active" : ""}
                  style={backgroundStyle(item)}
                  onClick={() => setBackgroundId(item.id)}
                />
              ))}
              <button className="background-add" onClick={() => backgroundInput.current?.click()} aria-label="上传背景">＋</button>
            </div>
            <input ref={backgroundInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadBackground} />
            <div className="url-row">
              <input value={backgroundUrl} onChange={(event) => setBackgroundUrl(event.target.value)} placeholder="粘贴网络图片地址" />
              <button onClick={addNetworkBackground}>添加</button>
            </div>
            <div className="copy-box">
              <div className="copy-box-heading">
                <span>发布文案</span>
                <button onClick={copyPublishText}>复制文案</button>
              </div>
              <textarea
                value={publishDraft}
                onChange={(event) => setPublishDraft(event.target.value)}
                rows={6}
                aria-label="发布文案"
              />
              <div className="copy-box-actions">
                <button type="button" onClick={shufflePublishingTags}>换一组通用标签</button>
                <button type="button" onClick={restorePublishingDraft}>恢复分类文案与标签</button>
              </div>
            </div>
          </aside>
        </section>
      )}

      {tab === "library" && (
        <section className="wide-page">
          <div className="page-intro">
            <span className="section-kicker">SHARED SOURCE OF TRUTH</span>
            <h2>同一个素材池，不绑定发布账号</h2>
            <p>来源人只说明素材从哪里来；最终用哪个账号发布，由制作台与服务端权限共同决定。</p>
          </div>
          <div className="library-table-wrap">
            <div className="table-tools">
              <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索素材库" /></label>
              <span>{filteredPosts.length} 条素材</span>
            </div>
            <div className="library-table" role="table">
              <div className="table-row table-head" role="row"><span>正文</span><span>来源</span><span>分类</span><span>日期</span><span>操作</span></div>
              {filteredPosts.map((post) => (
                <div className="table-row" role="row" key={post.id}>
                  <span><strong>{post.text}</strong><small>{post.tags.map((tag) => `#${tag}`).join(" ")}</small></span>
                  <span>{post.source}</span>
                  <span><i className="category-dot" />{post.category}</span>
                  <span>{post.date}</span>
                  <span className="table-actions">
                    <a href={post.link} target="_blank" rel="noreferrer" aria-label={`查看 ${post.source} 的原贴`} title="查看原贴"><SourceLinkIcon /></a>
                    <button onClick={() => { choosePost(post); setTab("studio"); }}>去制作</button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

    </main>
  );
}
