# Project marker: x-post

- Project root: `/home/gary/x-post`
- Purpose: private server API, PostgreSQL data store, media store, and controlled X material ingestion for the 星际留白推文卡片工具.
- Local migration source: `/Users/garylau/Work/x-post`
- Public frontend: remains on its existing Sites/Cloudflare deployment until a separately verified feature-flag switch.
- API service: `x-post-api.service`, bound to `127.0.0.1:3002`.
- PostgreSQL: project Compose service, bound to `127.0.0.1:54329`.
- Public domain, DNS, Tunnel route, and TLS: not declared in milestone A.
- Persistent data: `/home/gary/x-post/data`.
- Backups: `/home/gary/x-post/archive`.
- Crawler scheduler: disabled until authentication, date windows, strict-gate dry-runs, and watermarks are explicitly validated.
