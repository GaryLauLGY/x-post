# crawler worker integration boundary

Milestone A does not run X or copy any browser state. The future worker must call the project-specified `gary-x-post-crawler`, preserve its strict-original verification artifacts, and import only records that pass the pure-text gate.

Before enabling a run, configure these paths in a project-local, owner-only environment file:

- `XPOST_CRAWLER_ROOT`: reviewed `gary-x-post-crawler` source.
- `XPOST_CRAWLER_STORAGE_STATE`: a storage-state file explicitly placed for this project by the user; never copy it from another project implicitly.
- `XPOST_CRAWLER_OUTPUT_ROOT`: `/home/gary/x-post/data/crawler/runs`.

The scheduler remains disabled until all four handles have an explicitly approved date window and storage state, a plan-only run has been reviewed, and the internal import identity is configured. Partial search errors, profile fallback, or `coverage_complete=false` must never advance a watermark.
