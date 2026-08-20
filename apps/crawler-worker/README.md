# crawler worker integration boundary

The production crawler is orchestrated by a Codex scheduled task. The task connects to the mini PC and invokes the deterministic project entrypoint:

```bash
bin/x-post-crawler-cycle --execute
```

The entrypoint calls the vendored, reviewed `gary-x-post-crawler`, preserves strict-original verification artifacts, runs the bounded `gary-x-analytics` pure-text classifier, and imports only records that pass the pure-text gate. New materials enter PostgreSQL as `pending`; existing approved materials keep their review state and classification while receiving fresh public metrics.

Before enabling a run, configure these paths in a project-local, owner-only environment file:

- Reviewed crawler source: `upstream/gary-x-post-crawler/`.
- Bounded analytics source: `upstream/gary-x-analytics/`.
- Project-specific storage state: `data/crawler/storage-states/primary.json`.
- Immutable run output: `data/crawler/runs/`.
- Persistent watermarks: `data/crawler/watermarks/`.

Every run first resolves and records a plan for the four enabled authors. Partial search errors, profile fallback, or `coverage_complete=false` never advance a watermark. The Codex task must remain disabled until the project-specific storage state, project runtimes, plan-only output, and one real bounded validation run all pass.
