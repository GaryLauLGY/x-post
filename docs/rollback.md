# rollback

Server rollback and frontend-hosting rollback are separate. The approved frontend migration is defined in `frontend-hosting-migration.md`; until its cutover occurs, OpenAI Sites remains the current production frontend.

1. Stop the user API service: `systemctl --user stop x-post-api.service`.
2. Preserve a failure backup with `scripts/backup.sh` before changing data.
3. Restore a known backup into an isolated smoke container and reconcile counts before any production replacement.
4. Roll the API source back by deploying a previously recorded source archive/SHA and rebuilding. Do not use `git reset --hard` or delete persistent data.
5. Prefer a forward migration that restores compatibility. Do not run destructive down migrations automatically.
6. If the database must be replaced, keep the failed data directory as a timestamped project-local recovery point and only swap after the isolated restore passes.

Frontend-hosting rollback restores the previously recorded Sites custom-domain attachment/DNS state only if the self-managed Worker cutover fails. It must not reverse database migrations, alter crawler watermarks, or replace mini PC data. Keep the last verified Worker deployment available while the hostname route is rolled back.
