# mini PC server deployment

## Fixed scope

- Host: `minipc` / `gary-YO2`, user `gary`.
- Project root: `/home/gary/x-post`.
- Persistent data: `/home/gary/x-post/data`.
- Project backups: `/home/gary/x-post/archive`.
- API: `127.0.0.1:3002`.
- PostgreSQL: `127.0.0.1:54329`.
- Public frontend remains on Sites at `https://xpost.garylau.ai/`.
- Public API base: `https://xpost.garylau.ai/api/v1`.
- Tunnel origin: `xpost-origin.garylau.ai` -> `127.0.0.1:3002`.

No mini PC public port or firewall rule is used. The Tunnel hostname is an origin for the Sites worker; browser traffic stays on `xpost.garylau.ai`.

## Deploy sequence

1. Record the source Git SHA and build a public-data migration manifest.
2. Transfer only the reviewed repository files. Exclude `.git`, dependency/build caches, `.env`, output, private crawler state, and adjacent workspaces.
3. Create `data/postgres`, `data/media/{backgrounds,avatars}`, `data/crawler/{storage-states,runs,quarantine}`, `data/exports`, and `archive/database`. Keep storage-state directories at `700`.
4. Generate `.env` on the target with mode `600`; never copy or print a password from another machine.
5. Start the pinned PostgreSQL image with `deploy/compose.yaml`, wait for its health check, and record the resolved image digest.
6. Run `pnpm db:migrate`, then `pnpm data:migrate:dry`, then the transactional `pnpm data:migrate`.
7. Build the API and install `deploy/systemd/x-post-api.service` as a user service.
8. Run migration `0003_local_admin_auth.sql`, bootstrap the local administrator over stdin, and verify authenticated/unauthenticated behavior.
9. Add the Tunnel origin route, publish the Sites worker proxy and `/admin`, then verify health, pagination, counts, media checksums, backup, and restore smoke test.

The crawler timer, `/admin`, public reverse proxy, CORS production origin, and frontend feature flag remain disabled until their separate prerequisites are available and tested.
