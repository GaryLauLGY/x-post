# rollback

Milestone A does not switch the public frontend, so public rollback is initially a no-op.

1. Stop the user API service: `systemctl --user stop x-post-api.service`.
2. Preserve a failure backup with `scripts/backup.sh` before changing data.
3. Restore a known backup into an isolated smoke container and reconcile counts before any production replacement.
4. Roll the API source back by deploying a previously recorded source archive/SHA and rebuilding. Do not use `git reset --hard` or delete persistent data.
5. Prefer a forward migration that restores compatibility. Do not run destructive down migrations automatically.
6. If the database must be replaced, keep the failed data directory as a timestamped project-local recovery point and only swap after the isolated restore passes.

Future frontend rollback must switch its feature flag to the last verified JSON bundle; it must not reverse database migrations.
