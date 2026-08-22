/** Cloudflare Worker entry point for the vinext-starter template. */
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  XPOST_API_ORIGIN?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (!env.XPOST_API_ORIGIN) {
        return Response.json({ error: { code: "API_ORIGIN_NOT_CONFIGURED", message: "API origin is unavailable" } }, { status: 503 });
      }
      const origin = new URL(env.XPOST_API_ORIGIN);
      if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/") {
        return Response.json({ error: { code: "API_ORIGIN_INVALID", message: "API origin is invalid" } }, { status: 503 });
      }
      const target = new URL(url.pathname + url.search, origin);
      const headers = new Headers(request.headers);
      headers.set("x-forwarded-host", url.host);
      headers.set("x-forwarded-proto", "https");
      const response = await fetch(new Request(target, { method: request.method, headers, body: request.body, redirect: "manual" }));
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Cache-Control", response.headers.get("Cache-Control") ?? "no-store");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
