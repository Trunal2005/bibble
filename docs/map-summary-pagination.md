# Explore summary pages

Apply `20261122000000_map_summaries.sql` after the base map migration before deploying the client. The owner-only RPC returns at most 26 rows for a 25-card page; the extra row signals another page. Progress/counts are computed for those rows only. Notes, resources, positions and edges never enter a list response. Opening a map still fetches its complete graph.

Search and category filters apply before pagination. Ordering is `(updated_at DESC, id DESC)`, so timestamp ties have deterministic cursors. A stable collection has no skipped or duplicated entries. A map edited during browsing can move ahead of the cursor; refresh/retry the search to see its new position. IDs are deduplicated when pages and local/sample entries are merged. This is a live listing, not a frozen database snapshot.

Browser-only maps remain available while cloud loading fails. Local/sample cards retain previews; cloud-only cards display summaries. The loaded-card count is not presented as the total collection size. Retry states are separate from empty search results. In-flight results from an old filter are discarded.

## Verification

`npm test` covers cursor request/response handling, guest behavior, cloud/session errors and local/cloud reconciliation. `supabase/tests/map-summaries.sql` runs in an empty disposable PostgreSQL database, including auth/storage stubs; it checks equal-timestamp ordering, pagination, searches beyond the first page, aggregates, RLS and anonymous denial. It does not exercise hosted Supabase.

For payload comparison, seed maps with long notes/resources and compare `JSON.stringify` byte sizes for the old joined-map response and the new RPC. The old path returns every map and its graphs in one request; the new path makes one request per 25-card page and transfers no graph fields. No hosted latency measurements are claimed.
