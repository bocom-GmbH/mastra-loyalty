# Database Design Guidelines — General (Engine-Agnostic)
**Version:** 0.2 (Draft — reconstructed from cross-references in the PostgreSQL/Supabase and SQLite guidelines)
**Date:** 2026-05-15
**Authority:** Database Design Authority
**Scope:** Engine-agnostic principles. Every database change in this project must comply with this document plus the relevant engine-specific guideline.

**Status note:** This document was reconstructed from the cross-references in the PostgreSQL/Supabase v0.4 and SQLite v0.3 guidelines. Sections marked with **[TODO: confirm with original]** need verification once the source document is provided.

---

## How to Use This Document

Read this document **first**. Then read the engine-specific guideline:
- PostgreSQL or Supabase target → `postgres-supabase.md`
- SQLite target → `sqlite.md`

The engine-specific documents extend this one — they do not replace it.

---

## 1. Execution Contract

Before any work begins, the acting agent must:
1. Read this document.
2. Read the correct engine-specific document.
3. Identify the bounded context (which database file / schema is affected).
4. Classify data sensitivity (PII / operational / public).
5. Confirm the change type (read-only Q&A vs structural migration vs data migration).

Before execution, the acting agent must:
6. Check Hard Rules (§17).
7. Run the relevant pre-production checklist.
8. Confirm a backup exists for destructive DDL.

After execution:
9. The post-execution verifier validates the resulting state against the spec and issues PASS, FAIL, or INDETERMINATE.
10. The orchestrator does not close the task until a PASS verdict is received.

**Separation of powers (Hard Rule):**
- The agent that designs a migration MUST NOT execute it.
- The agent that executes a migration MUST NOT verify it.

---

## 2. Naming Conventions

### 2.1 General rule
Lowercase `snake_case` everywhere. No quoted identifiers.

### 2.2 Table names
- **Entity tables:** plural. Example: `transactions`, `pets`, `pharmacies`. **[TODO: confirm singular vs plural — PostgreSQL guideline §1.2 references this section but the SQLite examples use singular (`task`, `pharmacy`). Likely: plural for entity tables.]**
- **Log / audit tables:** singular. Example: `task_log`, `approval_status`, `audit_event`.
- **Join tables:** entity names concatenated alphabetically: `person_pet`, not `pet_person`. Exception: use a domain-meaningful name when one exists.

### 2.3 Constraint names
- Primary key: auto-named.
- Foreign key: `fk_<table>_<column>` or `fk_<table>_<referenced_table>`.
- Unique: `uq_<table>_<columns>`.
- Check: `ck_<table>_<rule>`.
- Index: `idx_<table>_<columns>`.

---

## 3. Identity and Primary Keys

The engine-specific document decides the default ID strategy:
- PostgreSQL/Supabase → UUID (UUIDv7 in PG18, UUIDv4 or application-generated UUIDv7 in PG17).
- SQLite → `INTEGER PRIMARY KEY` (rowid alias).

Never expose internal PKs in public URLs. Use a separate human-readable handle column when needed.

---

## 4. Timestamps and Audit

Every entity table carries `created_at` and `updated_at`. The engine-specific document defines the column type:
- PostgreSQL/Supabase → `timestamptz NOT NULL DEFAULT now()`.
- SQLite → `TEXT NOT NULL DEFAULT (datetime('now'))` (ISO-8601 UTC).

Append-only tables (logs, audit) omit `updated_at` but keep `created_at`.

---

## 5. Modeling State

### 5.1 Soft deletion via nullable timestamp
A `deleted_at` column (nullable timestamp). `NULL` means active. A value means soft-deleted. Pair with an "active" view.

### 5.2 Approval / status transitions
For state machines, prefer an append-only status log table with a `latest = true` partial unique index, over a single column that mutates in place. The log preserves history.

### 5.3 Published / archived / disabled
Use a nullable timestamp column instead of a boolean: `published_at`, `archived_at`, `disabled_at`.

### 5.4 Nullable timestamps over booleans for state
**[Hard Rule]** A nullable timestamp encodes both **whether** and **when** in one column. `is_published boolean` encodes only whether, and forces a separate column for when. The timestamp form is strictly more informative, costs the same, and naturally sorts.

```sql
-- Anti-pattern
is_published boolean NOT NULL DEFAULT false,
published_at timestamptz

-- Correct
published_at timestamptz   -- NULL = draft; value = published at this instant
```

---

## 6. Foreign Keys

- Every FK column is `NOT NULL` unless absence of the parent is genuinely meaningful.
- Every FK column is indexed (PostgreSQL does not auto-index FKs; SQLite has no automatic FK index either).
- Default actions: `ON UPDATE RESTRICT ON DELETE RESTRICT`. Use `CASCADE` only where the child is meaningless without the parent.
- FK enforcement is on by default in PostgreSQL but **off by default in SQLite** (see `sqlite.md §1.1`).

---

## 7. Constraints

Push validation into the database, not the application:
- `NOT NULL` for required columns.
- `CHECK` for value ranges, regex, enum-like sets.
- `UNIQUE` (including partial unique indexes) for conditional uniqueness.

The application is one of many clients. The database is the only thing that enforces invariants across all clients.

---

## 8. Enums

### 8.1 Decision rule: reference table vs CHECK constraint
Use a **reference table** with a `text` primary key when:
- Values carry metadata (labels, descriptions, sort order).
- Values are queried, filtered, or joined.
- Values may grow or change over the lifetime of the project.

Use a **CHECK constraint** with literal values when:
- The set is small (≤ 5), fixed, internal, with no metadata.
- The values are project-internal status flags.

Never use PostgreSQL native `ENUM` types (they cannot have values removed or reordered cleanly). Never use SQLite `TEXT 'true'/'false'` for booleans.

---

## 9. Lifecycle and Soft Deletion

### 9.1 The soft-deletion pattern
A nullable `deleted_at` column. NULL means active. A timestamp value means soft-deleted at that moment. The application MUST filter on `deleted_at IS NULL` for all "list active rows" queries, or use a view (`CREATE VIEW active_x AS SELECT * FROM x WHERE deleted_at IS NULL`).

Hard delete (`DELETE FROM x`) is reserved for:
- GDPR/DSGVO right-to-erasure requests.
- Test fixtures.
- Schema cleanup migrations.

Production application code does not hard-delete user data.

---

## 10. JSON / JSONB

Prefer normalised columns when the field is strongly typed, stable, and frequently filtered or joined.
Use JSON when:
- Field set varies between rows.
- Schema evolves frequently.
- Storing external payloads (webhooks, API responses).

Hybrid pattern: normalised columns for the stable core + a single `metadata jsonb` (PostgreSQL) or `metadata TEXT CHECK(json_valid(metadata))` (SQLite) for the flexible remainder.

---

## 11. Views

### 11.1 Use views sparingly; never views-on-views
One level of view abstraction is acceptable. Two is a smell. Three is a design failure — debug paths become impossible to trace and the planner has trouble producing good plans.

Acceptable uses:
- An `active_x` view for soft-deleted tables.
- A read-shaped projection of a normalised model for a specific consumer.

Avoid:
- Views built on top of views.
- Views that hide complex business logic — put that in functions or the application.

---

## 12. Bounded Contexts

### 12.1 Decision tree: when to split into a separate database/schema
Split when:
- Different owner service / different writer.
- Independent backup or lifecycle requirements.
- No JOIN-level data sharing needed.

Do not split when:
- Tables are frequently JOINed.
- A single transaction must span both groups.
- The split is purely organisational (use a schema or a naming prefix instead).

### 12.2 Bounded context registry
**[TODO: this section is referenced by `sqlite.md §16.1` as the canonical list of database files. Populate with the actual list once provided. Example placeholder:]**

| Context | Engine | Identifier | Owner | Notes |
|---|---|---|---|---|
| _example_ | SQLite | `themis_team.db` | _team_ | Orchestration context |
| _example_ | Supabase | schema `loyalty` | _team_ | Customer loyalty data |

---

## 13. Data Sensitivity Classification

Every table must be classified at creation time:

| Class | Meaning | Required handling |
|---|---|---|
| **Public** | No restrictions, may be exposed via API | Standard rules apply. |
| **Operational** | Internal system state, no PII | Standard rules apply. |
| **PII** | Personal data covered by DSGVO/GDPR | Retention policy required. Deletion path required. Encryption at rest where supported. Embeddings derived from PII must be marked and deletable. |
| **Sensitive** | Financial, health, credentials | Stronger access control. RLS mandatory (PostgreSQL/Supabase). Audit logging mandatory. |

Classification is decided by the Governance Authority before the Design Authority writes the spec.

---

## 14. Retention and Deletion

For every PII or Sensitive table, the spec must answer:
- How long is the data retained?
- What triggers deletion (user request, time-based, account closure)?
- Is the data exportable (DSGVO Art. 20)?
- Are derived artifacts (embeddings, search indexes, caches) also deleted?

The Governance Authority signs off on the retention policy before the Design Authority finalises the schema.

---

## 15. Performance

### 15.1 Index what you filter on
Read query plans (`EXPLAIN (ANALYZE, BUFFERS)` for PostgreSQL, `EXPLAIN QUERY PLAN` for SQLite). Add indexes that convert sequential scans to index scans for queries you actually run. Indexes have a write cost — do not blanket-index every column.

### 15.2 Composite index column order
The leftmost columns are reusable for prefix queries. Place equality filters before range filters before sort columns.

---

## 16. Migration Workflow

### 16.1 The pipeline
1. **Design Authority** produces a spec: SQL, rationale, hard rules check, backup plan, rollback plan.
2. **Engine Specialist** reviews the spec against the engine-specific document.
3. **Governance Authority** confirms sensitivity classification and retention policy.
4. **Checklist Auditor** runs automated checks.
5. **Migration Executor** confirms the backup, executes the SQL, logs the result.
6. **Post-Execution Verifier** checks the resulting state against the spec.
7. **Orchestrator** closes the task.

### 16.2 Spec contents
Every migration spec includes:
- A unique spec ID (e.g. `SPEC-008`).
- Affected bounded context.
- Sensitivity classification.
- Full SQL — DDL and DML.
- Hard rules compliance check.
- Backup naming (engine-specific convention).
- Rollback procedure or explanation of why rollback is impossible.

---

## 17. Hard Rules

A **Hard Rule** is non-negotiable. Departures require a **Full Waiver** signed off by the Governance Authority and recorded by the Waiver Recorder before execution.

### 17.1 Full Waiver requirements
A Full Waiver is a written record containing:
- Spec ID and section of the Hard Rule being waived.
- Reason for the departure.
- Compensating control (what mitigates the risk of waiving).
- Sign-off from the Governance Authority.
- Expiry date (waivers are time-bounded — they are not permanent exceptions).

### 17.2 Hard Rules in this document

| Rule | Section |
|---|---|
| The agent that designs a migration must not execute it | §1 |
| The agent that executes a migration must not verify it | §1 |
| Nullable timestamps over booleans for state (no `is_published boolean` paired with `published_at`) | §5.4 |
| Every PII or Sensitive table has a documented retention policy | §14 |

### 17.3 Engine-specific Hard Rules
See `postgres-supabase.md §17` and `sqlite.md §17` for engine-specific Hard Rules. They are additive.

---

## 18. Pre-Production Checklist (Manual)

- [ ] Engine confirmed — PostgreSQL/Supabase or SQLite, per §12.1 decision tree.
- [ ] Bounded context confirmed and registered in §12.2.
- [ ] Sensitivity classification documented (§13).
- [ ] Retention policy documented if PII or Sensitive (§14).
- [ ] Hard Rules reviewed (§17).
- [ ] Engine-specific Hard Rules reviewed.
- [ ] Spec reviewed by Design Authority.
- [ ] Spec reviewed by Engine Specialist.
- [ ] Spec reviewed by Governance Authority for sensitive data.
- [ ] Backup naming follows the engine convention.
- [ ] Rollback procedure documented (or impossibility justified).

---

## 19. Quick Reference Runbooks (Engine-Agnostic)

**[TODO: this section is referenced by both engine documents as the source of engine-agnostic runbooks. Populate with the canonical versions once provided.]**

### 19.1 Creating a new entity table
1. Pick the bounded context (§12).
2. Pick the engine if multiple are in scope.
3. Classify sensitivity (§13).
4. Define `id`, `created_at`, `updated_at`, `deleted_at` (if applicable) per engine convention.
5. Define columns with `NOT NULL` and `CHECK` defaults pushed into the database.
6. Define FKs with explicit `ON UPDATE` and `ON DELETE`.
7. Define indexes for every FK and every filter column.
8. Submit the spec to the Engine Specialist for review.

### 19.2 Adding a foreign key
1. Add the column with the FK reference and `ON UPDATE` / `ON DELETE` action.
2. Add an index on the column in the same migration.
3. Test on a copy that the FK enforces what you expect (especially in SQLite — `PRAGMA foreign_keys = ON` must be set in the test connection).

### 19.3 Destructive migration (drop column, change type, etc.)
1. Confirm the change cannot be done as additive ADD COLUMN + backfill + later DROP.
2. Plan the backup name per engine convention.
3. Execute the backup. Verify integrity.
4. Execute the DDL.
5. Run the post-execution verifier before closing the task.

### 19.4 Handling sensitive data
1. Governance Authority classifies the data.
2. Retention policy documented before the schema is written.
3. RLS (PostgreSQL/Supabase) or application-layer access control (SQLite) is mandatory.
4. Deletion path (including derived artifacts like embeddings) is documented.

---

## 20. Roles and Responsibilities

| Role | Reads | Writes | Calls |
|---|---|---|---|
| Database Orchestrator | All guidelines | — | Any other role |
| Database Design Authority | All guidelines | Specs | Research, Governance, Engine Specialist, Checklist |
| Research Authority | All guidelines | Research notes | — |
| Governance Authority | All guidelines | Classifications, retention, waivers | — |
| PostgreSQL/Supabase Specialist | General + PostgreSQL doc | Engine-specific review | — |
| SQLite Specialist | General + SQLite doc | Engine-specific review | — |
| Migration Executor | All guidelines | The database (DDL/DML) | — |
| Post-Execution Verifier | All guidelines | Verdicts | Checklist Auditor |
| Checklist Auditor | All guidelines | Audit reports | — |
| Waiver Recorder | All guidelines | Waivers | — |

**Hard separation:** Migration Executor and Post-Execution Verifier must be distinct agents with no shared call path. The Orchestrator routes between them.
