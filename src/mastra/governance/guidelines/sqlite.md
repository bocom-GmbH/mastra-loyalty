# Database Design Guidelines — SQLite
**Version:** 0.3 (Draft — under review)
**Date:** 2026-05-14
**Authority:** Database Design Authority
**Scope:** SQLite-specific rules. Read `general.md` first — this document extends it.
**Companion documents:**
- `general.md` — engine-agnostic principles (read first)
- `postgres-supabase.md` — PostgreSQL and Supabase rules

---

## Changelog

### v0.3 — 2026-05-14
- Removed all agent-specific references (agent names replaced with role labels)
- Project-specific database and table name examples annotated with `[Project example]`

### v0.2 — 2026-05-09

| § | Change | Suggestion | Verdict |
|---|---|---|---|
| Header | Cross-engine warning box added | 10 | Accept |
| §16 NEW | Quick Reference Runbooks (SQLite-specific) | 11 | Accept — modified |
| Checklist | Split into Manual Review and Automated Check sections | 5 | Accept — modified |

**Modifications:**
- Suggestion 11: Top 3 SQLite-specific operations only. Full runbook set deferred; see also general doc §19 for engine-agnostic runbooks.

---

> **Cross-engine warning**
>
> Do not apply PostgreSQL rules to SQLite without checking this document.
> Do not carry SQLite habits into PostgreSQL/Supabase without checking the PostgreSQL guideline.
> This document extends `general.md` — it does not replace it.
> Engine-specific documents are not interchangeable.

---

## About This Document

SQLite is the primary engine for all internal project databases in this system `[Project example: themis_team.db, pharmacy_eu.db, sales_prospects.db, mvp_pim.db]`. It has fundamental differences from PostgreSQL that make many PG patterns inapplicable, misleading, or actively wrong when used here.

This document covers SQLite-specific rules, SQLite equivalents for general patterns, and an explicit list of PostgreSQL patterns that do NOT translate.

---

## 1. Engine Configuration — Mandatory Pragmas

These pragmas must be set on every connection before any queries are issued. They are not persistent across connections — they must be re-applied each time a connection is opened.

```sql
PRAGMA journal_mode = WAL;         -- Write-Ahead Logging: readers don't block writers
PRAGMA foreign_keys = ON;          -- CRITICAL: foreign key enforcement is OFF by default
PRAGMA busy_timeout = 5000;        -- Wait up to 5s on a locked DB before returning error
PRAGMA synchronous = NORMAL;       -- Safe with WAL; full is unnecessarily slow
PRAGMA wal_autocheckpoint = 1000;  -- Incremental checkpointing, not one blocking burst
```

### 1.1 `PRAGMA foreign_keys = ON` — the most important pragma [Hard Rule]
**This is a SQLite-specific footgun with no PostgreSQL equivalent.**

In PostgreSQL, foreign key enforcement is always on. In SQLite, it is **disabled by default** and must be enabled on every connection, every time. A connection that opens the database without this pragma will silently allow orphaned rows, FK violations, and cascade rules will not fire.

**DO** set `PRAGMA foreign_keys = ON` as the first statement in every connection, in every service, in every migration script.

### 1.2 WAL mode
`journal_mode = WAL` is the single most impactful production configuration change for SQLite.

**Default journal mode (rollback):** Readers block writers and writers block readers. All I/O is serialised.
**WAL mode:** Readers do not block writers. A writer does not block readers. Multiple concurrent readers are safe.

WAL mode is persistent once set — it survives database close and reopen. Set it once per database file. It does not need to be set on every connection after the first time.

**WAL concurrency model — critical constraint:**
WAL mode allows concurrent reads but **only one writer at a time**. Concurrent write attempts return `SQLITE_BUSY`. Do not use a thread pool to manage SQLite write concurrency — this creates write contention that degrades throughput below single-writer performance.

**DO** serialise writes at the application level using a single write connection, a mutex, or an async write queue.

---

## 2. Primary Keys and ID Strategy

### 2.1 Default to `INTEGER PRIMARY KEY`
**DO** use `INTEGER PRIMARY KEY` as the default for internal tables.

```sql
CREATE TABLE task (
    id         INTEGER PRIMARY KEY,   -- alias for the rowid; fastest, smallest
    name       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

`INTEGER PRIMARY KEY` is an alias for SQLite's built-in `rowid`. It is the fastest and most storage-efficient primary key in SQLite. IDs are assigned automatically on INSERT.

**Behaviour on delete:** Deleted IDs may be reused (the next auto-assigned value is `max(id) + 1`). This is acceptable for most tables. See §2.2 for the exception.

### 2.2 Use `INTEGER PRIMARY KEY AUTOINCREMENT` only when non-reuse is required
`AUTOINCREMENT` guarantees that a deleted ID is never reused — the counter is strictly monotonic. Use it for:
- Audit logs and append-only tables where ID reuse could mislead (e.g. `task_log` `[Project example: hephaestus_log]`)
- Any table referenced by external systems that cache the numeric ID

**Overhead:** `AUTOINCREMENT` requires an extra write to the `sqlite_sequence` table on every INSERT. It is slightly slower and slightly larger. Use it only when the non-reuse guarantee is required.

### 2.3 Use `TEXT` UUID only when an external protocol requires it
**DON'T** use UUID primary keys in SQLite by default. They are larger, slower, and the B-tree locality problem (random inserts) is measurably worse.

**DO** use `TEXT` UUID primary keys when:
- The row's identity must be portable across systems or services (e.g. JMAP objects in `mvp_pim.db` per SPEC-009)
- An external protocol mandates UUID-format identifiers
- Cross-database joins require a globally unique reference

```sql
-- UUID as TEXT (SQLite) — generate in application layer
CREATE TABLE capture_item (
    id         TEXT    NOT NULL PRIMARY KEY,   -- UUID generated by application
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

Generate UUIDs in the application layer (e.g. `crypto.randomUUID()`, `uuid.uuid4()`, or the `uuidv7` library). SQLite has no native UUID function.

---

## 3. Time Storage

### 3.1 Always store times as `TEXT` in ISO-8601 UTC format [Hard Rule]
SQLite has no native timestamp or timezone-aware type. Times are stored as `TEXT`, `INTEGER` (Unix epoch), or `REAL` (Julian day). **Always use `TEXT` ISO-8601 UTC.**

```sql
-- Standard second-precision (most tables)
created_at TEXT NOT NULL DEFAULT (datetime('now'))
-- Output: "2026-05-09 14:23:45"

-- Millisecond-precision (for time-sensitive sequencing)
created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
-- Output: "2026-05-09T14:23:45.123Z"
```

**DO** use `datetime('now')` as the default for standard timestamp columns. The output format `"YYYY-MM-DD HH:MM:SS"` is directly sortable and comparable in SQLite.

**DO** use `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` when millisecond precision is needed (SPEC-009 pattern).

**DON'T** store local time. **DON'T** store Unix epoch integers as your primary time format — they are opaque in `sqlite3` and in `.md` logs. Store ISO-8601 TEXT for human readability.

### 3.2 Date-only columns
For columns that hold a calendar date (no time component), use `TEXT` in `YYYY-MM-DD` format:

```sql
report_date TEXT NOT NULL DEFAULT (date('now'))
-- Output: "2026-05-09"
```

`[Project examples: talos_design_log.date_created, momos_review_log.review_date]`

### 3.3 Comparisons and arithmetic
SQLite's date/time functions work correctly on ISO-8601 TEXT strings:

```sql
-- Rows from the last 7 days
WHERE created_at >= datetime('now', '-7 days')

-- Days since creation
julianday('now') - julianday(created_at)
```

---

## 4. Boolean Storage

SQLite has no native BOOLEAN type. All boolean-like values are stored as `INTEGER`.

### 4.1 Use `INTEGER 0/1` with a CHECK constraint
```sql
is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
is_primary   INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1))
```

`[Project examples: company_affiliations.is_primary, momos_review_log.clean_review, pharmacy_apps.is_helloagain]`

**DON'T** use `TEXT 'true'/'false'` — this requires exact string matching and is not indexable without a function.

---

## 5. JSON Storage

SQLite supports JSON via the JSON1 extension. It was an opt-in compile-time feature from 3.9.0 (2015) and became a mandatory built-in from 3.38.0 (2022). All modern SQLite distributions include it.

### 5.1 Store JSON as `TEXT` with a `json_valid()` CHECK
```sql
CREATE TABLE context_assignment (
    id       INTEGER PRIMARY KEY,
    contexts TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(contexts)),
    metadata TEXT    DEFAULT '{}' CHECK (metadata IS NULL OR json_valid(metadata))
);
```

**DO** set meaningful defaults (`'[]'` for arrays, `'{}'` for objects) so the column is never NULL when collection semantics are expected.

**DO** use `CHECK (json_valid(col))` to prevent storing malformed JSON.

### 5.2 Use JSON1 functions for querying
```sql
-- Extract a field
json_extract(metadata, '$.status')

-- Test key existence
json_type(metadata, '$.pharmacy_id') IS NOT NULL

-- Aggregate rows into a JSON array
SELECT json_group_array(json_object('id', id, 'name', name))
FROM pharmacy WHERE deleted_at IS NULL
```

### 5.3 Generated columns + index for hot JSON paths
SQLite has no native JSON path indexes. For a JSON field that is queried frequently, use a generated column:

```sql
ALTER TABLE event ADD COLUMN event_type TEXT
    GENERATED ALWAYS AS (json_extract(payload, '$.type')) VIRTUAL;
CREATE INDEX idx_event_type ON event(event_type);
```

**Note:** Virtual generated columns in SQLite work differently from PostgreSQL 18's virtual generated columns. In SQLite, virtual generated columns CAN be indexed via an index on the expression.

---

## 6. Naming and Schema

### 6.1 No schema namespaces in SQLite
SQLite has no `CREATE SCHEMA` equivalent. All tables share a single flat namespace per database file. There is no way to create `loyalty.person` and `billing.person` in the same file.

**DO** use separate database files per bounded context when namespace separation is needed. This is the SQLite equivalent of PostgreSQL schemas.

```
[Project example]
themis_team.db          → orchestration context
pharmacy_eu.db          → pharmacy data context
sales_prospects.db      → trade fair intelligence context
mvp_pim.db              → CLA app PIM context
```

**Criteria for a separate .db file:**
- Different owner service (different writer)
- Independent backup and lifecycle requirements
- No JOIN-level data sharing needed (cross-file JOINs via `ATTACH DATABASE` are possible but add fragility)

### 6.2 `ATTACH DATABASE` is not a schema equivalent
`ATTACH DATABASE` links a second SQLite file into the current connection, exposing its tables as `<alias>.<table>`. It is useful for bulk copy operations and migration tooling.

**DON'T** use ATTACH as a permanent multi-context architecture. Each ATTACH is a separate file and connection with its own locking. Cross-attached JOINs bypass the individual-file WAL modes and produce unexpected locking behaviour.

---

## 7. Foreign Keys

All general FK rules from `general.md` (§6) apply. SQLite-specific additions:

### 7.1 FK enforcement is off by default — see §1.1 [Hard Rule]
This is restated here because it is the most critical SQLite-specific gotcha. Without `PRAGMA foreign_keys = ON`, FK declarations are parsed and stored but never enforced. Inserts, updates, and deletes that would violate FK constraints will succeed silently.

### 7.2 Explicit `ON DELETE / ON UPDATE` is recommended
SQLite's default FK action when neither `ON DELETE` nor `ON UPDATE` is specified is `NO ACTION` — evaluated at the end of the statement (similar to RESTRICT but different in deferred FK semantics). Be explicit:

```sql
pharmacy_id INTEGER NOT NULL REFERENCES pharmacy(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
```

---

## 8. Constraints and Indexes

### 8.1 Partial unique indexes — yes, SQLite supports them
**Critical project note:** SQLite has supported partial unique indexes since version 3.8.0 (2013). This was incorrectly documented as unsupported in SPEC-006 memory. It is not a PostgreSQL-only feature.

```sql
-- "At most one primary affiliation per company while active"
CREATE UNIQUE INDEX uq_affiliations_one_primary_active
    ON company_affiliations(company_id)
    WHERE is_primary = 1 AND status = 'active';
```

`[Project example]` The `is_primary` uniqueness constraint on `company_affiliations` is currently enforced at the application layer due to the false belief that SQLite couldn't support it. A partial unique index should be created.

### 8.2 Partial indexes for performance
```sql
-- Index only active rows (the 95% of queries)
CREATE INDEX idx_task_active_project
    ON task(project_id) WHERE deleted_at IS NULL;
```

### 8.3 Composite index column order
The leftmost columns in a composite index are reusable for prefix queries. Column order matters:

```sql
-- For: WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC
CREATE INDEX idx_subscription_tenant_status_date
    ON subscription(tenant_id, status, created_at DESC);
```

### 8.4 Index creation in SQLite locks the database
Unlike PostgreSQL, SQLite has no `CREATE INDEX CONCURRENTLY`. Index creation takes a write lock on the entire database file for the duration. For large tables, create indexes during a maintenance window when no other writes are in flight.

---

## 9. Triggers for `updated_at`

The function-once-reuse pattern from PostgreSQL does not exist in SQLite — triggers are table-specific. Define one trigger per table.

```sql
CREATE TRIGGER set_task_updated_at
    AFTER UPDATE ON task
    FOR EACH ROW
BEGIN
    UPDATE task SET updated_at = datetime('now') WHERE id = OLD.id;
END;
```

Recommended: use `AFTER UPDATE` with an explicit `UPDATE ... SET updated_at` for clarity.

---

## 10. Soft Deletion

Soft deletion in SQLite uses the same pattern as the general document (§9.1), with TEXT ISO-8601 timestamps:

```sql
deleted_at TEXT    -- NULL = active; ISO-8601 UTC = soft-deleted
```

Build an active-rows view:
```sql
CREATE VIEW active_task AS
    SELECT * FROM task WHERE deleted_at IS NULL;
```

---

## 11. Views

The general document rules (§11) apply. SQLite-specific note: SQLite views are always read-only unless `INSTEAD OF` triggers are defined. For write operations on views, define appropriate triggers.

---

## 12. `ALTER TABLE` Limitations and Migration Patterns

### 12.1 What SQLite ALTER TABLE supports
```
SQLite >= 3.25.0: RENAME COLUMN ... TO ...
SQLite >= 3.35.0: DROP COLUMN ...
All versions:     ADD COLUMN ...
All versions:     RENAME TABLE ... TO ...
```

### 12.2 What SQLite ALTER TABLE does NOT support
- Changing a column's type
- Changing a column's `NOT NULL` constraint after creation
- Changing a column's default value
- Adding a constraint to an existing column (`ADD CONSTRAINT` is not supported)
- Dropping or adding a primary key
- Reordering columns

For any unsupported change, use the **table-copy pattern**.

### 12.3 The table-copy pattern [Hard Rule]
```sql
-- When ALTER TABLE cannot make the required change:
PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- 1. Create the new table with the desired schema
CREATE TABLE task_new (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 2. Copy data
INSERT INTO task_new (id, title, status, created_at, updated_at)
    SELECT id, title, status, created_at, updated_at FROM task;

-- 3. Drop the old table
DROP TABLE task;

-- 4. Rename the new table
ALTER TABLE task_new RENAME TO task;

-- 5. Recreate indexes, triggers, views
CREATE INDEX idx_task_status ON task(status);

COMMIT;
PRAGMA foreign_keys = ON;
```

**Critical:** `PRAGMA foreign_keys = OFF` must be set *before* the transaction and re-enabled after. This is the only safe way to drop and recreate tables that are referenced by FK constraints.

### 12.4 ADD COLUMN with a constant default is instant
On SQLite >= 3.37.0, adding a column with a constant (non-computed) default does NOT rewrite the table — the default is stored in the catalog and applied on read. This is safe for zero-downtime migrations.

```sql
-- Instant: constant default, no table rewrite (SQLite >= 3.37.0)
ALTER TABLE task ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';

-- NOT NULL without a default: impossible via ADD COLUMN — use the table-copy pattern (§12.3)
-- Nullable without a default: instant — omit NOT NULL and the default becomes NULL
```

### 12.5 Migration tooling for SQLite

| Tool | Notes |
|---|---|
| **Flyway** | SQL-first, sequential versioned migrations, lightweight. Good default for simple projects. |
| **Atlas** | Schema-as-code, declarative diff, 50+ lint checks. Preferred when governance matters. |
| **Drizzle Kit** | Native SQLite support via `generate`. Cannot auto-generate table-copy SQL for complex changes — review every generated migration manually. |
| **goose** | Popular for Go-based embedded/mobile backends. |
| **Manual + migration executor** | Current project convention for all structural changes via design spec. |

**Reminder:** In this project, all structural changes go through the design spec → executor pipeline regardless of tooling. Tooling assists with SQL generation; the design authority reviews the output before the executor applies it.

---

## 13. Connection Management and WAL

### 13.1 Single writer architecture
SQLite allows concurrent reads but only one writer at a time. Design around this:

**DO** use a single write connection (or a dedicated write actor/queue) for all write operations.

**DON'T** open multiple write connections expecting them to round-robin. `SQLITE_BUSY` errors and write degradation follow.

### 13.2 `busy_timeout` instead of `lock_timeout`
SQLite has no `lock_timeout` DDL pragma. Use `PRAGMA busy_timeout = N` (milliseconds) to set how long a write will wait for a locked database before returning `SQLITE_BUSY`.

```sql
PRAGMA busy_timeout = 5000;  -- Wait up to 5 seconds
```

### 13.3 `mmap_size` and `cache_size` for production performance
```sql
PRAGMA mmap_size = 268435456;   -- 256 MB memory-mapped I/O (reduce system call overhead)
PRAGMA cache_size = -65536;     -- 64 MB page cache (negative = KB, positive = pages)
```

Tune to a fraction of available RAM. The defaults are often too small for production workloads.

---

## 14. Backup Strategy

### 14.1 Never copy a live SQLite file directly [Hard Rule]
Copying an active SQLite file while writes are in progress produces a corrupt backup. The WAL file (`database.db-wal`) may contain uncommitted pages that do not appear in the main file copy.

### 14.2 Safe backup methods
**Option A — WAL checkpoint then copy (offline):**
```sql
PRAGMA wal_checkpoint(TRUNCATE);
-- Then copy the .db file (no -wal or -shm files will exist after TRUNCATE checkpoint)
```

**Option B — SQLite Online Backup API (online):**
All major language bindings (Python `sqlite3`, Node.js `better-sqlite3`, Go `go-sqlite3`) expose the Online Backup API, which produces a consistent point-in-time copy without locking the database.

**Option C — Litestream (continuous replication):**
Litestream streams WAL frames incrementally to S3, GCS, Azure Blob, or SFTP. Requires no application code changes. Supports point-in-time recovery. The standard production tool for high-availability SQLite.

### 14.3 Executor backup convention
Before any destructive DDL in this project, the migration executor creates a named backup:
```
<dbname>.bak_<spec-id>_<UTC-timestamp>
-- Example: mydb.bak_SPEC-008_20260501T201921Z
```

This convention is mandatory for all spec-driven changes.

### 14.4 VACUUM and integrity check
```sql
PRAGMA integrity_check;  -- Run after a backup restore to verify no corruption
VACUUM;                  -- Reclaim space after large deletes; must be run outside a transaction
```

Run `integrity_check` after any restore before promoting the backup to active use. Schedule `VACUUM` periodically for databases with frequent deletes.

---

## 15. PostgreSQL Patterns That Do NOT Apply to SQLite

The following rules from the PostgreSQL guidelines are either inapplicable or must be replaced with SQLite equivalents:

| PostgreSQL Rule | Status in SQLite | SQLite Alternative |
|---|---|---|
| `CREATE SCHEMA` namespaces | **N/A** | Separate `.db` files per bounded context (§6.1) |
| `CREATE INDEX CONCURRENTLY` | **N/A** | Plain `CREATE INDEX`; do during maintenance window (§8.4) |
| `lock_timeout` on DDL | **N/A** | `PRAGMA busy_timeout` for connection-level wait (§13.2) |
| `statement_timeout` per role | **N/A** | No equivalent; use application-layer timeouts |
| PgBouncer / Supavisor pooling | **N/A** | SQLite is embedded; no server process (§13.1) |
| `SECURITY DEFINER` functions | **N/A** | No user/role system; security is 100% application-layer |
| Row Level Security (RLS) | **N/A** | No RLS concept; access control is application-layer |
| `gen_random_uuid()` / `uuidv7()` | **N/A** | Generate UUIDs in application layer (§2.3) |
| `LISTEN/NOTIFY` | **N/A** | No equivalent; use polling or application callbacks |
| `NOT VALID` constraint validation | **N/A** | No deferred validation path; constraints are checked immediately |
| `timestamptz` type | **N/A** | `TEXT` ISO-8601 UTC (§3.1) |
| GIN / GiST / BRIN index types | **N/A** | B-tree only; FTS5 for full-text search |
| `uuid` as a native column type | **N/A** | `TEXT` (36-char string) or `BLOB` (16-byte) |
| PostgreSQL native ENUM types | **N/A** | CHECK literals or reference tables (general §8.1) |
| `ALTER TABLE ... ADD CONSTRAINT` | **N/A** | Table-copy pattern required (§12.3) |
| Foreign keys enforced by default | **DIFFERENT** | Must enable with `PRAGMA foreign_keys = ON` each connection (§1.1) |
| `uuidv7()` native function | **N/A** (PG 18+) | Application-layer generation (§2.3) |

---

## 16. Quick Reference Runbooks (SQLite)

See also general doc §19 for engine-agnostic runbooks (creating a table, adding an FK, destructive migrations, sensitive data).

### 16.1 Setting up a new SQLite database
1. Create the file and set the mandatory pragmas on first connection (§1).
2. Confirm WAL mode is persistent: check that `database.db-wal` and `database.db-shm` are created alongside the `.db` file after the first write.
3. Add the pragma block to every connection setup in application code — WAL is persistent; the others must be re-applied.
4. Document the new database file in `general.md §12.2` (bounded context registry).

### 16.2 Performing a safe backup before DDL
1. Check for in-flight writes — confirm no write connections are active.
2. Run `PRAGMA wal_checkpoint(TRUNCATE)` to flush the WAL.
3. Copy the `.db` file using the executor naming convention (§14.3).
4. Verify: `PRAGMA integrity_check` on the copy before proceeding.
5. Proceed with the DDL.

### 16.3 Applying the table-copy pattern for unsupported ALTER TABLE changes
1. Identify the required schema change and confirm `ALTER TABLE` cannot handle it (§12.2).
2. The design authority issues a spec with the full table-copy SQL (§12.3).
3. Set `PRAGMA foreign_keys = OFF` before the transaction (§12.3 [Hard Rule] — required to allow DROP/RENAME of FK-referenced tables).
4. Execute: CREATE new table → INSERT data → DROP old → RENAME new → recreate indexes and triggers.
5. Set `PRAGMA foreign_keys = ON` after COMMIT.
6. The post-execution verifier confirms row counts match before and after.

---

## 17. Hard Rules — SQLite Quick Reference

The following rules in this document are classified [Hard Rule] and require a Full Waiver (see general doc §17.1) for any departure:

| Rule | Section |
|---|---|
| `PRAGMA foreign_keys = ON` must be set on every connection | §1.1 |
| Always store times as `TEXT` ISO-8601 UTC | §3.1 |
| FK enforcement is off by default — enable on every connection | §7.1 |
| `PRAGMA foreign_keys = OFF` required before table-copy transaction | §12.3 |
| Never copy a live SQLite file directly | §14.1 |

See `general.md §17.3` for additional Hard Rules that apply to all engines.

---

## SQLite Pre-Production Checklist

### Manual Review Items

- [ ] Data confirmed to belong in SQLite (not PostgreSQL) — single-writer, embedded, internal context (general §12.1 decision tree)
- [ ] Bounded context split justified if creating a new `.db` file (§6.1)
- [ ] ID strategy is `INTEGER PRIMARY KEY` unless UUID is justified by an external protocol (§2)
- [ ] Boolean columns use `INTEGER 0/1` pattern, not `TEXT 'true'/'false'` (§4.1)
- [ ] JSON columns have meaningful defaults (`'[]'` or `'{}'`) (§5.1)
- [ ] Soft-delete column needed for this table? (general §9.1)
- [ ] Migration type assessed: simple ALTER or table-copy pattern required? (§12)
- [ ] Backup strategy confirmed: executor naming convention or Litestream (§14)
- [ ] No PostgreSQL-only patterns applied (§15 reference table)

### Automated Check Items

- [ ] All mandatory pragmas documented and set on every connection (§1)
- [ ] `PRAGMA foreign_keys = ON` explicitly in connection setup (§1.1)
- [ ] `journal_mode = WAL` confirmed set on the database file (§1.2)
- [ ] Timestamps are `TEXT` ISO-8601 UTC with `datetime('now')` default (§3.1)
- [ ] Boolean columns are `INTEGER 0/1` with CHECK constraint (§4.1)
- [ ] JSON columns have `json_valid()` CHECK constraint (§5.1)
- [ ] FK enforcement tested with `PRAGMA foreign_keys = ON` in test environment (§7.1)
- [ ] Partial unique indexes used (not application-layer enforcement) where conditional uniqueness is required (§8.1)
- [ ] `updated_at` trigger defined per-table (§9)
