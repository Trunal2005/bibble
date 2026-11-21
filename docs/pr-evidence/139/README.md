# Atomic map persistence verification

Apply `supabase/migrations/20261120000000_atomic_map_persistence.sql` before deploying the client. A missing or failed RPC returns a save failure; the editor retains its browser copy. Separate REST writes are intentionally not used because they cannot provide transaction rollback.

Run `npm test` for client serialization, RPC acknowledgement/error handling, and joined-query coverage.

Run `psql -v ON_ERROR_STOP=1 -f supabase/tests/atomic-map-persistence.sql` against an **empty disposable PostgreSQL database** for actual transactional rollback and RLS checks. The script creates auth/storage stubs and test roles inside a transaction, applies the real migrations, verifies constraint rollback and account isolation, and rolls back its setup. It does not test hosted Supabase networking or Storage.
