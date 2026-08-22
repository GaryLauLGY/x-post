# Project marker: x-post

- Project root: `/home/gary/x-post`
- Purpose: private server API, PostgreSQL data store, media store, and controlled X material ingestion for the 星际留白推文卡片工具.
- Local migration source: `/Users/garylau/Work/x-post`
- Frontend hosting: project-owned vinext Cloudflare Worker `x-post` in Gary's account, live at `https://xpost.garylau.ai` since 2026-08-22. OpenAI Sites is retired.
- Frontend migration authority: `docs/frontend-hosting-migration.md`.
- Migration execution host: Mac project `/Users/garylau/Work/x-post`; the mini PC is not the frontend build/deployment host.
- API service: `x-post-api.service`, bound to `127.0.0.1:3002`.
- Public API base: `https://xpost.garylau.ai/api/v1`; the project-owned Worker proxies `/api/*` to the unchanged mini PC Tunnel origin.
- Administrator: local `admin` account with a PostgreSQL scrypt password hash and revocable server session; public registration is disabled.
- PostgreSQL: project Compose service, bound to `127.0.0.1:54329`.
- Tunnel origin: `xpost-origin.garylau.ai` routes only through the shared Cloudflare Tunnel to `127.0.0.1:3002`; no mini PC public listener or firewall rule.
- Persistent data: `/home/gary/x-post/data`.
- Backups: `/home/gary/x-post/archive`.
- Crawler scheduler: active Codex cron automation `05-30-x-post`, running daily at 05:30 Asia/Shanghai and calling `bin/x-post-crawler-cycle`; authentication, project runtimes, plan-only output, and bounded real runs were validated on 2026-08-20.
