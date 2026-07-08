# API Migration Baseline Runbook

## Reason For The Baseline

The API no longer owns Kanban, work-item, or project-domain schema changes. Historical API migrations that created or modified those tables were archived outside active API source so boundary linting can enforce a zero-allowlist cutover. Active API deployments now use a neutral post-cutover baseline migration plus post-cutover API migrations.

## Fresh Database Bootstrap

Fresh environments should run the active migration registry normally. The baseline migration applies frozen explicit SQL for the current API-owned schema, then later active migrations apply incremental post-cutover changes. Do not replay archived migrations into a fresh database through the API service.

For local and development environments, the approved cutover path is reset-based:

1. Take and verify a backup first.
2. Stop the API and any workers connected to the database.
3. Drop and recreate the local/development API database.
4. Start the API or run the migration command that applies the active registry.
5. Confirm the neutral baseline and later active migrations are present in the TypeORM migration ledger.

Production-like environments should not be reset casually. Use a verified backup or snapshot and decide whether to restore from a known-good post-cutover snapshot or follow a planned maintenance procedure.

## Required Backup

Before changing migration state, take a database backup and verify it can be restored.

Recommended minimum backup command for local PostgreSQL:

```bash
pg_dump "$DATABASE_URL" --format=custom --file api-pre-cutover-baseline.backup
```

Do not mark a baseline as applied until the backup exists and the application is stopped or otherwise prevented from running migrations concurrently.

## Check Migration Table State

Connect to the API database and inspect the TypeORM migration ledger:

```sql
SELECT id, timestamp, name
FROM migrations
ORDER BY timestamp, name;
```

Confirm whether the historical API migrations have already been applied in that environment. If they have not run, do not apply them from the archived copy through the API service; provision a fresh database from the current active migrations instead.

## Mark The Baseline Applied

Existing environments that already ran the historical migration chain should normally be rebuilt through the reset path. Manual baseline marking is reserved for production-like maintenance windows and may be done only after confirming the live schema is equivalent to the frozen baseline schema. Marking the baseline without that preflight can hide missing tables, indexes, enum types, or constraints because TypeORM will treat the baseline as already applied.

Before inserting the marker:

1. Compare the live schema against a fresh database built from the active migration registry.
2. Resolve any missing or mismatched API-owned objects before changing the migration ledger.
3. Confirm the backup from the required backup step is restorable.

Use the TypeORM ledger timestamp and exact class name from the active baseline migration. These migrations use 14-digit wall-clock class suffixes, while TypeORM stores the last 13 digits in the `migrations.timestamp` column.

```sql
INSERT INTO migrations (timestamp, name)
SELECT 260517000000, 'ApiPostCutoverBaseline20260517000000'
WHERE NOT EXISTS (
  SELECT 1
  FROM migrations
  WHERE timestamp = 260517000000
    AND name = 'ApiPostCutoverBaseline20260517000000'
);
```

After inserting the marker, restart the API and verify startup does not attempt to run archived migrations.

## Drift Check Behavior

The API drift check compares the TypeORM ledger directly against the active migration registry. It does not suppress archived pre-cutover migration rows. Reset local and development databases should contain only the neutral baseline and later active migrations. If archived rows remain, the warning is actionable: follow this runbook to back up, rebuild or validate the schema, and reconcile the migration ledger rather than suppressing the drift.

## Rollback Limitations

The baseline is a ledger marker, not a schema rollback mechanism. Removing the baseline record does not restore archived migration files to active API source and does not undo historical schema changes. To roll back a failed cutover, restore the pre-cutover database backup and deploy a build from before the baseline cutover.

Archived migration files are retained only for operator reference and forensic comparison; they are not part of the active API migration registry.
