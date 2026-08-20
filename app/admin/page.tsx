"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import styles from "./admin.module.css";

type Session = { username: string; displayName: string; role: string };
type Overview = { materials: number; pending: number; active_authors: number; last_crawl: string | null };
type Material = {
  id: string;
  text: string;
  originalText: string;
  publishedAt: string;
  category: string;
  tags: string[];
  sourceUrl: string;
  status: "pending" | "approved" | "rejected" | "archived";
  adminNote?: string | null;
  rejectionReason?: string | null;
  edited: boolean;
  sourceAuthor: { handle: string; displayName: string };
  metrics: { views: number | null; replies: number | null; reposts: number | null; likes: number | null; bookmarks: number | null };
};
type Author = { id: string; handle: string; display_name: string; enabled: boolean; minimum_impressions: number };
type Account = { id: string; name: string; handle: string; enabled: boolean };
type Background = { id: string; title: string; status: "active" | "disabled"; object_key: string };
type CrawlRun = { id: string; handle?: string; status: string; requested_since: string; requested_until: string; created_at: string; error_summary?: string | null };
type AuditLog = { id: string; action: string; entity_type: string; entity_id?: string | null; created_at: string };
type Tab = "materials" | "authors" | "accounts" | "backgrounds" | "runs" | "audit";

async function readJson<T>(response: Response) {
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `请求失败（${response.status}）`);
  return payload.data as T;
}

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [csrf, setCsrf] = useState("");
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [tab, setTab] = useState<Tab>("materials");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialTotal, setMaterialTotal] = useState(0);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [backgrounds, setBackgrounds] = useState<Background[]>([]);
  const [runs, setRuns] = useState<CrawlRun[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Material | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const api = useCallback(async <T,>(path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (init.method && init.method !== "GET") headers.set("X-CSRF-Token", csrf);
    const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
    return readJson<T>(response);
  }, [csrf]);

  const loadDashboard = useCallback(async () => {
    const query = new URLSearchParams({ limit: "100" });
    if (search.trim()) query.set("q", search.trim());
    if (status) query.set("status", status);
    const [overviewData, materialsData, authorData, accountData, backgroundData, runData, auditData] = await Promise.all([
      api<Overview>("/api/v1/admin/overview"),
      fetch(`/api/v1/admin/materials?${query}`, { credentials: "same-origin" }).then(async (response) => {
        const payload = await response.json() as { data: Material[]; page: { total: number }; error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message ?? "素材读取失败");
        return payload;
      }),
      api<Author[]>("/api/v1/admin/source-authors"),
      api<Account[]>("/api/v1/admin/publishing-accounts"),
      api<Background[]>("/api/v1/admin/backgrounds"),
      api<CrawlRun[]>("/api/v1/admin/crawl-runs"),
      api<AuditLog[]>("/api/v1/admin/audit-logs"),
    ]);
    setOverview(overviewData);
    setMaterials(materialsData.data);
    setMaterialTotal(materialsData.page.total);
    setAuthors(authorData);
    setAccounts(accountData);
    setBackgrounds(backgroundData);
    setRuns(runData);
    setAuditLogs(auditData);
  }, [api, search, status]);

  useEffect(() => {
    fetch("/api/v1/auth/session", { credentials: "same-origin" })
      .then(async (response) => {
        if (response.status === 401) return null;
        return readJson<{ user: Session; csrfToken: string }>(response);
      })
      .then((data) => {
        if (data) { setSession(data.user); setCsrf(data.csrfToken); }
      })
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!session || !csrf) return;
    const timer = window.setTimeout(() => loadDashboard().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "读取失败")), 180);
    return () => window.clearTimeout(timer);
  }, [csrf, loadDashboard, session]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setLoginError("");
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await readJson<{ user: Session; csrfToken: string }>(response);
      setSession(data.user);
      setCsrf(data.csrfToken);
      setPassword("");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  const mutate = async (path: string, init: RequestInit, message: string) => {
    setBusy(true);
    try {
      await api(path, init);
      await loadDashboard();
      setNotice(message);
      setEditing(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await api("/api/v1/auth/logout", { method: "POST", body: "{}" });
      setSession(null);
      setCsrf("");
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "退出失败");
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = useMemo(() => ({ pending: "待审核", approved: "已批准", rejected: "已拒绝", archived: "已归档" }), []);

  if (checking) return <main className={styles.gate}><p>正在检查管理员会话…</p></main>;
  if (!session) {
    return (
      <main className={styles.loginPage}>
        <form className={styles.loginCard} onSubmit={login}>
          <img src="/brand/xjlb-logo.png" alt="" />
          <p className={styles.kicker}>X-POST CONTROL</p>
          <h1>管理员登录</h1>
          <p>仅限已配置的本地管理员账号。</p>
          <label>用户名<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label>密码<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {loginError && <div className={styles.error}>{loginError}</div>}
          <button disabled={busy || !password}>{busy ? "正在登录…" : "登录"}</button>
          <Link href="/">返回制作台</Link>
        </form>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      {notice && <button className={styles.notice} onClick={() => setNotice("")}>{notice}</button>}
      <header className={styles.header}>
        <div><p className={styles.kicker}>星际留白 · X-POST</p><h1>内容管理台</h1></div>
        <div className={styles.user}><span>{session.displayName}</span><Link href="/">制作台</Link><button onClick={logout}>退出</button></div>
      </header>
      <section className={styles.metrics}>
        <article><span>素材总数</span><strong>{overview?.materials ?? "—"}</strong></article>
        <article><span>待审核</span><strong>{overview?.pending ?? "—"}</strong></article>
        <article><span>启用作者</span><strong>{overview?.active_authors ?? "—"}</strong></article>
        <article><span>最近成功抓取</span><strong className={styles.smallValue}>{overview?.last_crawl ? new Date(overview.last_crawl).toLocaleString("zh-CN") : "尚未启用"}</strong></article>
      </section>
      <nav className={styles.tabs}>
        {(["materials", "authors", "accounts", "backgrounds", "runs", "audit"] as Tab[]).map((item) => (
          <button key={item} className={tab === item ? styles.active : ""} onClick={() => setTab(item)}>
            {{ materials: "素材", authors: "作者", accounts: "发布账号", backgrounds: "背景", runs: "抓取任务", audit: "审计日志" }[item]}
          </button>
        ))}
      </nav>

      {tab === "materials" && <section className={styles.panel}>
        <div className={styles.toolbar}>
          <div><h2>素材管理</h2><span>共 {materialTotal} 条</span></div>
          <input placeholder="搜索正文" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="pending">待审核</option><option value="approved">已批准</option><option value="rejected">已拒绝</option><option value="archived">已归档</option></select>
        </div>
        <div className={styles.table}>
          {materials.map((item) => <article className={styles.material} key={item.id}>
            <div className={styles.materialMain}><div className={styles.materialMeta}><span className={`${styles.badge} ${styles[item.status]}`}>{statusLabel[item.status]}</span><b>@{item.sourceAuthor.handle}</b><time>{item.publishedAt.slice(0, 10)}</time>{item.edited && <em>已编辑</em>}</div><p>{item.text}</p><small>{item.category} · {item.tags.map((tag) => `#${tag}`).join(" ")} · 浏览 {item.metrics.views ?? 0}</small></div>
            <div className={styles.actions}><a href={item.sourceUrl} target="_blank" rel="noreferrer">原贴</a><button onClick={() => setEditing(item)}>编辑</button>{item.status !== "approved" && <button onClick={() => mutate(`/api/v1/admin/materials/${item.id}/approve`, { method: "POST", body: "{}" }, "素材已批准")}>批准</button>}{item.status !== "archived" && <button onClick={() => mutate(`/api/v1/admin/materials/${item.id}/archive`, { method: "POST", body: "{}" }, "素材已归档")}>归档</button>}</div>
          </article>)}
        </div>
      </section>}

      {tab === "authors" && <section className={styles.panel}><h2>抓取作者</h2><div className={styles.cards}>{authors.map((item) => <article key={item.id}><div><strong>{item.display_name}</strong><span>@{item.handle}</span></div><label>曝光门槛<input type="number" min="0" defaultValue={item.minimum_impressions} onBlur={(event) => mutate(`/api/v1/admin/source-authors/${item.id}`, { method: "PATCH", body: JSON.stringify({ minimumImpressions: Number(event.target.value) }) }, "作者门槛已更新")} /></label><button onClick={() => mutate(`/api/v1/admin/source-authors/${item.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !item.enabled }) }, item.enabled ? "作者已停用" : "作者已启用")}>{item.enabled ? "停用" : "启用"}</button></article>)}</div></section>}

      {tab === "accounts" && <section className={styles.panel}><h2>发布账号</h2><div className={styles.cards}>{accounts.map((item) => <article key={item.id}><div><strong>{item.name}</strong><span>@{item.handle}</span></div><button onClick={() => mutate(`/api/v1/admin/publishing-accounts/${item.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !item.enabled }) }, item.enabled ? "账号已停用" : "账号已启用")}>{item.enabled ? "停用" : "启用"}</button></article>)}</div></section>}

      {tab === "backgrounds" && <section className={styles.panel}><h2>背景素材</h2><div className={styles.cards}>{backgrounds.map((item) => <article key={item.id}><div><strong>{item.title}</strong><span>{item.object_key}</span></div><button onClick={() => mutate(`/api/v1/admin/backgrounds/${item.id}`, { method: "PATCH", body: JSON.stringify({ status: item.status === "active" ? "disabled" : "active" }) }, "背景状态已更新")}>{item.status === "active" ? "停用" : "启用"}</button></article>)}</div></section>}

      {tab === "runs" && <section className={styles.panel}><h2>抓取任务</h2><p className={styles.hint}>项目 Cookie 未配置前，这里只展示计划与历史，不会启动真实抓取。</p><div className={styles.cards}>{runs.length ? runs.map((item) => <article key={item.id}><div><strong>@{item.handle ?? "unknown"} · {item.status}</strong><span>{new Date(item.created_at).toLocaleString("zh-CN")}</span></div>{["failed", "partial"].includes(item.status) && <button onClick={() => mutate(`/api/v1/admin/crawl-runs/${item.id}/retry`, { method: "POST", body: "{}" }, "已建立重试任务")}>重试</button>}</article>) : <p>暂无抓取任务。</p>}</div></section>}

      {tab === "audit" && <section className={styles.panel}><h2>审计日志</h2><div className={styles.audit}>{auditLogs.map((item) => <div key={item.id}><time>{new Date(item.created_at).toLocaleString("zh-CN")}</time><strong>{item.action}</strong><span>{item.entity_type}{item.entity_id ? ` · ${item.entity_id.slice(0, 8)}` : ""}</span></div>)}</div></section>}

      {editing && <div className={styles.modalBackdrop}><form className={styles.modal} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); mutate(`/api/v1/admin/materials/${editing.id}`, { method: "PATCH", body: JSON.stringify({ text: form.get("text"), category: form.get("category"), tags: String(form.get("tags") ?? "").split(/[,，\s]+/u).filter(Boolean), adminNote: form.get("note") }) }, "素材已更新"); }}><h2>编辑素材</h2><label>正文<textarea name="text" rows={10} defaultValue={editing.text} /></label><label>分类<input name="category" defaultValue={editing.category} /></label><label>标签<input name="tags" defaultValue={editing.tags.join(" ")} /></label><label>管理员备注<textarea name="note" rows={3} defaultValue={editing.adminNote ?? ""} /></label><div className={styles.modalActions}><button type="button" onClick={() => setEditing(null)}>取消</button>{editing.edited && <button type="button" onClick={() => mutate(`/api/v1/admin/materials/${editing.id}`, { method: "PATCH", body: JSON.stringify({ restoreOriginal: true }) }, "已恢复原始正文")}>恢复原文</button>}<button type="submit" disabled={busy}>保存</button></div></form></div>}
    </main>
  );
}
