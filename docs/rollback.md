# rollback

Server rollback and frontend-hosting rollback are separate. The production frontend is the project-owned `x-post` Cloudflare Worker defined in `frontend-hosting-migration.md`.

1. Stop the user API service: `systemctl --user stop x-post-api.service`.
2. Preserve a failure backup with `scripts/backup.sh` before changing data.
3. Restore a known backup into an isolated smoke container and reconcile counts before any production replacement.
4. Roll the API source back by deploying a previously recorded source archive/SHA and rebuilding. Do not use `git reset --hard` or delete persistent data.
5. Prefer a forward migration that restores compatibility. Do not run destructive down migrations automatically.
6. If the database must be replaced, keep the failed data directory as a timestamped project-local recovery point and only swap after the isolated restore passes.

Frontend-hosting rollback first redeploys the last verified `x-post` Worker version and rechecks its custom-domain route. The recorded Sites attachment/DNS state is an emergency fallback only and requires explicit authorization because Sites is retired. No frontend rollback may reverse database migrations, alter crawler watermarks, or replace mini PC data.
