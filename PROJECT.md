# Project marker: x-post

- Project root: `/home/gary/x-post`
- Purpose: private server API, PostgreSQL data store, media store, and controlled X material ingestion for the 星际留白推文卡片工具.
- Local migration source: `/Users/garylau/Work/x-post`
- Public frontend: OpenAI Sites/Cloudflare deployment at `https://xpost.garylau.ai/`.
- API service: `x-post-api.service`, bound to `127.0.0.1:3002`.
- Public API base: `https://xpost.garylau.ai/api/v1`; the Sites worker proxies `/api/*` to the mini PC Tunnel origin.
- Administrator: local `admin` account with a PostgreSQL scrypt password hash and revocable server session; public registration is disabled.
- PostgreSQL: project Compose service, bound to `127.0.0.1:54329`.
- Tunnel origin: `xpost-origin.garylau.ai` routes only through the shared Cloudflare Tunnel to `127.0.0.1:3002`; no mini PC public listener or firewall rule.
- Persistent data: `/home/gary/x-post/data`.
- Backups: `/home/gary/x-post/archive`.
- Crawler scheduler: disabled until authentication, date windows, strict-gate dry-runs, and watermarks are explicitly validated.
