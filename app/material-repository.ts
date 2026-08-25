import existingAccounts from "./data/existing-accounts.json";
import existingMaterials from "./data/existing-materials.json";

export type Account = {
  id: string;
  name: string;
  handle: string;
  verified: boolean;
  label: string;
  accent: string;
  avatar?: string;
};

export type PostMetrics = { replies: number; reposts: number; likes: number; bookmarks: number; views: number };
export type Post = { id: string; text: string; source: string; date: string; link: string; category: string; tags: string[]; note?: string; metrics: PostMetrics };
export type Background = { id: string; name: string; kind: "gradient" | "image"; value: string; palette?: string[]; isPersonal?: boolean };

export const legacyBootstrap = {
  accounts: existingAccounts as Account[],
  posts: existingMaterials as Post[],
};

type ApiMaterial = {
  id: string;
  text: string;
  publishedAt: string;
  category: string;
  tags: string[];
  sourceUrl: string;
  sourceAuthor: { displayName: string; handle: string };
  metrics: Partial<PostMetrics>;
};

async function responseJson<T>(url: string) {
  const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`API 请求失败（${response.status}）`);
  return response.json() as Promise<T>;
}

function preloadLibraryImage(url: string, priority: "high" | "auto") {
  if (typeof Image === "undefined") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, 12000);
    image.fetchPriority = priority;
    image.addEventListener("load", finish, { once: true });
    image.addEventListener("error", finish, { once: true });
    image.src = url;
    if (image.complete) finish();
  });
}

export async function loadLiveLibrary() {
  const accountsRequest = responseJson<{ data: Array<{ id: string; name: string; handle: string; verified: boolean; label?: string; accent?: string; avatarUrl?: string }> }>("/api/v1/publishing-accounts");
  const backgroundsRequest = responseJson<{ data: Array<{ id: string; title: string; url: string }> }>("/api/v1/backgrounds");
  const preloadedAccountsRequest = accountsRequest.then(async (response) => {
    await Promise.all(response.data.map((item) => item.avatarUrl ? preloadLibraryImage(item.avatarUrl, "high") : Promise.resolve()));
    return response;
  });
  const preloadedBackgroundsRequest = backgroundsRequest.then(async (response) => {
    await Promise.all(response.data.map((item) => preloadLibraryImage(item.url, "auto")));
    return response;
  });
  const materials: ApiMaterial[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const page = await responseJson<{ data: ApiMaterial[]; page: { nextCursor: string | null } }>(`/api/v1/materials?${query}`);
    materials.push(...page.data);
    cursor = page.page.nextCursor;
  } while (cursor);

  const [accountsResponse, backgroundsResponse] = await Promise.all([preloadedAccountsRequest, preloadedBackgroundsRequest]);

  const posts: Post[] = materials.map((item) => ({
    id: item.id,
    text: item.text,
    source: item.sourceAuthor.displayName || item.sourceAuthor.handle,
    date: item.publishedAt.slice(0, 10),
    link: item.sourceUrl,
    category: item.category,
    tags: item.tags ?? [],
    metrics: {
      views: Number(item.metrics.views ?? 0),
      replies: Number(item.metrics.replies ?? 0),
      reposts: Number(item.metrics.reposts ?? 0),
      likes: Number(item.metrics.likes ?? 0),
      bookmarks: Number(item.metrics.bookmarks ?? 0),
    },
  }));
  const accounts: Account[] = accountsResponse.data.map((item) => ({
    id: item.id,
    name: item.name,
    handle: item.handle.startsWith("@") ? item.handle : `@${item.handle}`,
    verified: item.verified,
    label: item.label ?? "",
    accent: item.accent ?? "#5b6ff5",
    avatar: item.avatarUrl,
  }));
  const backgrounds: Background[] = backgroundsResponse.data.map((item) => ({ id: item.id, name: item.title, kind: "image", value: item.url }));
  if (!posts.length || !accounts.length || !backgrounds.length) throw new Error("服务器素材数据不完整");
  return { posts, accounts, backgrounds };
}
