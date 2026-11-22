# Map revision conflicts

Apply `supabase/migrations/20261121000000_map_versions.sql` after the base learning-map migration, then deploy the client from this change. Configure both server `SUPABASE_*` variables and browser `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` with the project's public URL and publishable key. Never use a service-role key in browser variables.

Existing database maps start at revision 1. `save_learning_map_versioned` accepts the loaded revision as `p_expected_version`, updates the header and complete graph atomically, and returns the committed revision. New maps use a null expected revision. Stale writes raise `PT409 / CONCURRENCY_CONFLICT`. Reads retrieve metadata, revision, nodes, and edges in one relational query.

A database trigger rejects blind header updates that do not advance the revision by exactly one. Older clients will receive save errors after this migration rather than bypass concurrency protection. Deploy the migration and new client together. The separate atomic-save PR's older RPC cannot bypass this guard.

The editor allows one save at a time. On conflict, further saves and background shortcuts pause and a focus-trapped dialog offers:

- **Save as copy**: create a separate map with fresh map, node, and edge IDs before navigating to it.
- **Reload latest**: replace the canvas and undo history with the newest saved graph.
- **Overwrite remote**: fetch the latest revision and attempt another conditional save. A third competing writer still causes a conflict.

Current edits remain in memory and a best-effort per-tab recovery draft in `sessionStorage` while a save is attempted. Shared map caches are not replaced on a failed cloud save. Offline/guest saves use Web Locks to serialize local revision checks across tabs; browsers without Web Locks report a save error instead of promising safe concurrent writes.

The current editor uses explicit save actions; this change guards the shared save callback so future autosave callers also stop during an unresolved conflict.

## Verification

Run `npm test`, `npm run lint`, and `npm run build`.

For real database regression checks, run `psql -v ON_ERROR_STOP=1 -f supabase/tests/map-versioning.sql` against an **empty disposable PostgreSQL test database**. This installs local auth/storage stubs and the real migrations inside a transaction, verifies revisions, stale rejection, rollback, legacy-client rejection, and RLS, then rolls back the entire setup.

For truly simultaneous writers, put PostgreSQL's `initdb`, `pg_ctl`, and `psql` on PATH and run `python supabase/tests/concurrent-writers.py`. It creates its own private temporary PostgreSQL cluster on loopback, runs competing sessions, verifies the winning graph, and stops that server. It never connects to an existing cluster or removes roles/files. The temporary cluster files are retained for inspection.

Browser reproduction without cloud credentials:

1. Open the same sample map editor in two tabs before either tab saves.
2. Complete a concept in Tab A and save.
3. Edit notes in Tab B and save; the conflict dialog must appear.
4. Verify each recovery action on a fresh conflict. Reload must show Tab A's work; a copy must keep Tab B's notes; overwrite requires an explicit choice.

The checked-in screenshots show actual browser sessions. Database transcripts show local PostgreSQL checks. Hosted Supabase networking and cross-device login were not exercised without project credentials.

## Compatibility with merged revision history (#150)

Also apply `20261122030000_versioned_history_integration.sql` after the version and snapshot-table migrations. It composes versioned graph writes with immutable snapshot insertion/20-revision retention in the same transaction. Snapshot failure rolls back the graph and version increment. Restore uses a server-owned snapshot and the actual live expected version; it creates a new forward revision with a restore trigger. The UI uses committed version tokens, refreshes canvas refs and undo state after restore, and records guest snapshots only after a successful local compare-and-swap. A matching pair of stale dialog counters cannot authorize a restore.

`supabase/tests/versioned-history.sql` covers atomic snapshot creation/restore, stale restore rejection, snapshot failure rollback, retention and owner/anonymous isolation in an empty disposable database. Client tests also verify actual committed browser state, RPC version acknowledgements and missing-migration failure.

Guest browser verification saved two graph revisions and restored the earlier eight-node graph as a new revision 3, retaining the nine-node revision 2. Evidence: `docs/pr-evidence/142/history-restore.jpg`.
