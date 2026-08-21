# Frontend hosting migration

Updated: 2026-08-22

## Decision and status

- Production is the `x-post` vinext Cloudflare Worker deployed in Gary's own Cloudflare account.
- The public hostname remains `https://xpost.garylau.ai` and the public API remains same-origin at `/api/v1`.
- Cutover completed on 2026-08-22. The OpenAI Sites custom-domain attachment and old `custom-domains.chatgpt.site` CNAME were removed after temporary-host validation.
- Frontend changes, builds, Worker deployment, and hostname cutover run from `/Users/garylau/Work/x-post` on the Mac. The mini PC remains the PostgreSQL/API/crawler origin.

## Target architecture

```mermaid
flowchart LR
    B[Browser] --> W[xpost.garylau.ai\nGary-owned Cloudflare Worker]
    W -->|frontend and assets| B
    W -->|/api/*| T[xpost-origin.garylau.ai\nCloudflare Tunnel]
    T --> A[127.0.0.1:3002\nFastify API]
    A --> P[PostgreSQL 127.0.0.1:54329]
    C[Codex 05:30 automation] -->|SSH one cycle| R[mini PC crawler runtime]
    R --> P
```

The migration does not add a mini PC public listener, firewall rule, database container, hostname, or crawler scheduler. `xpost-origin.garylau.ai` remains the origin route to `127.0.0.1:3002`.

## Source changes

The current application is already a vinext Worker. Migration work should:

1. Remove `@openai/sites-vite-plugin` and the `sites()` Vite plugin.
2. Replace the Sites-owned hosting configuration with a project-owned Wrangler configuration.
3. Keep `worker/index.ts` as the frontend entry and keep its same-origin `/api/*` proxy.
4. Configure `XPOST_API_ORIGIN` through the Worker environment without committing secrets. The origin must remain HTTPS and credential-free.
5. Preserve the current frontend behavior, admin session cookies, media paths, and PNG export.

The obsolete `.openai/hosting.json` was removed after cutover. Do not recreate it or add the Sites Vite plugin in normal development.

## Migration sequence

1. Record local and remote Git status, the exact source SHA, current Sites custom-domain metadata, current public DNS answers, and current public/API health.
2. Reconcile Mac source with mini PC server-only changes. Do not overwrite crawler config, storage states, run artifacts, watermarks, database data, or unrelated worktree changes.
3. Implement the project-owned Worker configuration and run build, rendered HTML tests, server tests, lint, and `git diff --check`.
4. Deploy the replacement Worker to a temporary Worker hostname. Do not change `xpost.garylau.ai` yet.
5. On the temporary hostname, verify the homepage, current material count, authors, backgrounds/media, `/admin` unauthenticated response, and PNG export. Do not weaken the production Origin/CSRF policy merely to test authenticated writes on `workers.dev`.
6. Attach or route `xpost.garylau.ai` to the verified Worker. This production hostname change requires explicit user authorization at execution time.
7. Verify authenticated admin login/write/logout and same-origin cookies on the production hostname, then verify homepage and API from at least two independent network exits, including one route that OpenAI Sites previously blocked. Confirm responses are no longer served through `chatgpt.site`.
8. Detach/decommission Sites only after the new Worker is healthy and the rollback path has been recorded. This was completed on 2026-08-22.

## 2026-08-22 cutover evidence

- Temporary Worker hostname served the homepage, 347 current approved materials, backgrounds/media, the unauthenticated admin boundary, and a visually checked 1080 x 1440 PNG export.
- `xpost.garylau.ai` was attached as a Worker custom domain after removing only the old Sites CNAME.
- Mac, a WeChat mobile user agent, and the mini PC exit returned the application successfully; the mini PC route that Sites previously blocked returned HTTP 200.
- Production public API reported 347 approved materials with the newest record dated 2026-08-21; `/api/v1/admin/overview` remained protected with HTTP 401 when unauthenticated.
- The deployed Worker version and the pre-cutover Sites/DNS state were recorded in the execution evidence. No database, crawler state, public listener, firewall, or Tunnel origin changed.

## Cutover completion criteria

Migration is complete only when all of the following are true:

- `xpost.garylau.ai` serves the recorded self-managed Worker deployment and no longer resolves through or returns content from `custom-domains.chatgpt.site`.
- Homepage, assets, media, public materials API, admin authentication, authenticated writes, and PNG export pass.
- Public approved-material totals equal current PostgreSQL approved rows; per-author counts are reconciled without using a stale hard-coded baseline.
- mini PC loopback health and Tunnel origin health pass; no new public port or firewall rule exists.
- Mac and the previously blocked independent exit both return the expected application response instead of the Cloudflare `Attention Required` page.
- The deployed source SHA, Worker deployment identifier, DNS/route state, and rollback instructions are recorded without credentials.

## Rollback

If cutover verification fails:

1. Preserve the failed Worker deployment and its logs for diagnosis.
2. Prefer redeploying the last verified `x-post` Worker version. Restore the recorded Sites custom-domain attachment and DNS state only as an explicitly authorized emergency fallback.
3. Verify the old homepage and same-origin API before declaring rollback complete.
4. Do not roll back PostgreSQL migrations, crawler imports, material states, or watermarks as part of a frontend-hosting rollback.

Never treat a successful Worker upload, DNS propagation, or one working network exit alone as completion.
