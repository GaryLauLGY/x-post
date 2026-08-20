/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  XPOST_API_ORIGIN?: string;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

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

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
