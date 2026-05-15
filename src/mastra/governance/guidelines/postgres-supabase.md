# Database Design Guidelines — PostgreSQL & Supabase
**Version:** 0.4 (Draft — under review; sections after §11.6 truncated in source — see TODO note below)
**Date:** 2026-05-14
**Confirmed Supabase PostgreSQL version:** 17.6 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 13.2.0, 64-bit
**Authority:** Database Design Authority
**Scope:** PostgreSQL-specific rules, with a dedicated Supabase sub-section. Read `general.md` first — this document extends it.
**Companion documents:**
- `general.md` — engine-agnostic principles (read first)
- `sqlite.md` — SQLite-specific rules

---

> **Source truncation notice:**
> The source document was truncated at §11.6 in the original upload. Sections §12–§17 (Supabase environment verification, runbooks, hard rules, checklists) are referenced from §16.10/§16.11 markers in the changelog but not present here. The Research Authority should re-fetch the full document when available.

---

> **Cross-engine warning**
>
> Do not apply SQLite rules to PostgreSQL/Supabase without checking this document.
> Do not carry PostgreSQL habits into SQLite without checking the PostgreSQL guideline.
> This document extends `general.md` — it does not replace it.
> Engine-specific documents are not interchangeable.

---

## Changelog

### v0.4 — 2026-05-14
- Removed all agent-specific references (agent names replaced with role labels)
- §16.10 Volatile Claims Register: research authority reference generalised

### v0.3 — 2026-05-09
Based on analysis of 12 improvement suggestions (design authority):

| § | Change | Suggestion | Verdict |
|---|---|---|---|
| Header | Cross-engine warning box added | 10 | Accept |
| §15.4 | SET LOCAL override clarification added | 7 | Accept |
| §16.10 NEW | Volatile Claims Register | 4 | Accept |
| §16.11 NEW | Supabase Environment Verification Script | 6 | Accept |
| §17 NEW | Quick Reference Runbooks (PostgreSQL/Supabase-specific) | 11 | Accept — modified |
| Checklists | Split into Manual Review and Automated Check sections | 5 | Accept — modified |

**Modifications:**
- Suggestion 11: Top 3 PostgreSQL/Supabase-specific operations. Full runbook set deferred; see also general doc §19 for engine-agnostic runbooks.

### v0.2 — 2026-05-09
Based on analysis of 6 improvement suggestions (design authority + research authority):

| § | Change | Source | Verdict |
|---|---|---|---|
| §2.2 | Added explicit statement: pg_idkit and pg_uuidv7 not available on Supabase PG 17.6 as standard extensions | Research authority (Suggestion 3) | Accept with minor modification |
| §10.6 | New — PG17 B-tree IN-list (SAOP) optimisation | Research authority (Suggestion 4) | Accept |
| §11.5 | New — `JSON_TABLE` for shredding JSONB into relational rows | Design authority (Suggestion 2) | Accept with modification |
| §11.6 | New — MERGE vs INSERT ON CONFLICT decision rule | Research authority (Suggestion 6) | Accept — contextual |
| §15.4 | New — Storage cost parameters for NVMe/Supabase (effective_io_concurrency, random_page_cost) | Research authority (Suggestion 1) | Accept with modification |
| §15.5 | New — EXPLAIN (ANALYZE, BUFFERS) as default diagnostic | Design authority (Suggestion 5) | Accept with modification |
| §15.6 | New — EXPLAIN (ANALYZE, MEMORY) for planner memory diagnostics | Design authority (Suggestion 5) | Accept with modification |
| §15.7 | New — VACUUM on PostgreSQL 17 (TIDStore, autovacuum improvements) | Research authority (Suggestion 4) | Accept |
| §15.8 | Renumbered from §15.4 — Restore-test backups | — | No change to content |

---

## About This Document

This document covers PostgreSQL-specific design patterns with a dedicated Supabase section covering hosted-platform concerns (RLS, JWT auth, connection pooling, Realtime, Edge Functions, and tooling). The core PostgreSQL rules (§§1–15) apply to any PostgreSQL deployment. The Supabase section (§16) applies only to Supabase-hosted projects.

---

## 1. Naming and Schema Layout

### 1.1 Use `snake_case` everywhere, never quoted identifiers
**DO** name all tables, columns, indexes, constraints, functions, and schemas in lowercase `snake_case`.
**DON'T** use `camelCase`, `PascalCase`, or anything requiring double-quoting.

PostgreSQL folds unquoted identifiers to lowercase. Once you write `"UserProfile"`, every query everywhere needs the quotes — in views, functions, migration tools, and ORM schemas. It is a permanent productivity tax.

### 1.2 Name tables per the general convention
See `general.md §2.2`. Plural for entity tables, singular for log/audit tables.

### 1.3 Use schemas as namespaces
**DO** create a schema per bounded context: `auth`, `billing`, `loyalty`, `pharmacy`, `cms`.
**DON'T** dump everything into `public`.

You can JOIN across schemas with no performance cost. The benefit is that 200 tables stop being a flat, unnavigable list.

**For Supabase specifically:** Keep tables that must be exposed via PostgREST in the `public` schema. Move all internal tables (audit, jobs, internal lookup, queue tables) to a private schema not exposed through the API.

```sql
CREATE SCHEMA loyalty;
CREATE SCHEMA pharmacy;
CREATE SCHEMA audit;
-- public: only PostgREST-exposed tables
```

### 1.4 Mechanical join table naming
Name join tables by concatenating the two entity names alphabetically: `person_pet`, not `pet_person`. Exception: use a domain-meaningful name when one exists. Always add a unique index on `(a_id, b_id)`.

### 1.5 Deterministic constraint and index naming
- Primary key: auto-named (acceptable)
- Foreign key: `fk_<table>_<column>` or `fk_<table>_<referenced_table>`
- Unique: `uq_<table>_<columns>`
- Check: `ck_<table>_<rule>`
- Index: `idx_<table>_<column(s)>` — project convention

---

## 2. Primary Keys

### 2.1 Default to UUID primary keys
**DO** use `uuid` primary keys generated database-side for all application tables.
**DON'T** use `serial` / `bigserial` for application tables (acceptable for tiny internal lookup tables only).

UUIDs allow client-side ID generation, eliminate round-trips for ID retrieval, do not leak row counts, and survive sharding. The trade-offs (slightly more storage, random B-tree inserts) are real but small for typical SaaS workloads.

### 2.2 Prefer UUIDv7 over UUIDv4 when available
UUIDv7 is time-ordered, which keeps B-tree inserts sequential and dramatically reduces index bloat and WAL volume on write-heavy tables.

**Current project Supabase version: PostgreSQL 17.6**
Native `uuidv7()` is a **PostgreSQL 18+** feature. PG 17.6 does not have it.

**Extension-based UUIDv7 is also not available on Supabase PG 17.6.** Neither `pg_idkit` (Rust build) nor `pg_uuidv7` is available as a standard `CREATE EXTENSION` on Supabase. A PL/pgSQL variant of pg_idkit exists via the `database.dev` package manager but is not a first-class Supabase extension and carries maintenance risk — do not use it as a production default.

**For all current Supabase projects, generate UUIDv7 in the application layer:**

```sql
-- Column definition: default to UUIDv4 as fallback; application always supplies UUIDv7
CREATE TABLE transaction (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    ...
);
```

```typescript
import { uuidv7 } from "uuidv7";
await supabase.from('transaction').insert({ id: uuidv7(), ... });
```

**When Supabase upgrades to PG 18**, replace `gen_random_uuid()` with the native `uuidv7()` as the column default. No data migration is needed — existing UUIDv4 rows remain valid.

**Trade-off:** UUIDv7 leaks creation timestamps. For public-facing tokens, session IDs, share links → use UUIDv4 (`gen_random_uuid()`). For internal primary keys → UUIDv7.

### 2.3 Don't expose internal PKs in URLs
If a human-readable external handle is needed (invoice numbers, ticket IDs), generate a separate column (`INV-2026-00042`). Never let the PK serve double duty as a public identifier.

---

## 3. Timestamps and Audit

### 3.1 Every table gets `created_at` and `updated_at` [Hard Rule]
**Mandatory.** Both `timestamptz NOT NULL DEFAULT now()`.

```sql
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
```

**Exception:** Append-only tables (audit logs, status logs) omit `updated_at`. They still require `created_at`.

### 3.2 Maintain `updated_at` with a shared trigger function
Define the function once per schema, attach a trigger per table.

```sql
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_transaction_updated_at
    BEFORE UPDATE ON loyalty.transaction
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### 3.3 Always use `timestamptz`, never `timestamp` [Hard Rule]
`timestamptz` stores UTC and respects session time zone. `timestamp without time zone` is a footgun — it silently misinterprets data across time zones. There is no reason to use `timestamp` in a SaaS application.

### 3.4 Nullable timestamps over booleans for state
`published_at timestamptz` is strictly better than `is_published boolean`. See `general.md §5.4`.

---

## 4. Foreign Keys and Referential Integrity

### 4.1 Default to `ON UPDATE RESTRICT ON DELETE RESTRICT` [Hard Rule]
```sql
owner_id uuid NOT NULL REFERENCES loyalty.person(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
```

Use `CASCADE` only where the child is genuinely meaningless without the parent (join-table rows, owned attachment rows). Even then, prefer soft-deletion of the parent.

### 4.2 Always index FK columns [Hard Rule]
PostgreSQL does **not** auto-index FK columns. Add the index in the same migration as the FK:

```sql
CREATE INDEX idx_pet_owner_id ON loyalty.pet(owner_id);
```

### 4.3 NOT NULL all required FKs
Default to `NOT NULL`. Opt into nullable FK only when the absence of a parent relationship is genuinely meaningful.

---

## 5. Constraints

### 5.1 Push validation into the database
```sql
CREATE TABLE loyalty.transaction (
    id           uuid    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    amount_cents integer NOT NULL CHECK (amount_cents >= 0),
    currency     char(3) NOT NULL CHECK (currency = upper(currency)),
    email        text    CHECK (email ~* '^.+@.+\..+$')
);
```

### 5.2 Partial unique indexes for conditional uniqueness
```sql
CREATE UNIQUE INDEX uq_subscription_one_active
    ON loyalty.subscription(pharmacy_id)
    WHERE cancelled_at IS NULL;
```

### 5.3 Use `text` over `varchar(n)`
PostgreSQL stores both identically. `text` has no length cap. Use a `CHECK (length(name) <= 200)` constraint when a length limit is genuinely needed — easier to alter later.

---

## 6. Enums: Use Tables, Not Native Types

### 6.1 Model enums as reference tables with `text` PKs
PostgreSQL native `ENUM` types cannot have values removed or reordered, and migrations are awkward. Reference tables are flexible, queryable, and joinable.

```sql
CREATE TABLE loyalty.transaction_kind (
    value    text NOT NULL PRIMARY KEY,
    label_de text NOT NULL,
    label_en text NOT NULL,
    comment  text NOT NULL DEFAULT ''
);

CREATE TABLE loyalty.transaction (
    ...
    kind text NOT NULL REFERENCES loyalty.transaction_kind(value)
        ON UPDATE RESTRICT ON DELETE RESTRICT
);
```

For small, fixed, project-internal status values with no metadata, a CHECK constraint is also acceptable. See `general.md §8.1` for the decision rule.

---

## 7. State, Lifecycle, and Soft Deletion

See `general.md §9` for all state patterns. PostgreSQL-specific syntax:

### 7.1 Soft deletion
```sql
deleted_at timestamptz  -- NULL = active; value = soft-deleted (UTC)
```

```sql
CREATE VIEW loyalty.active_pet AS
    SELECT * FROM loyalty.pet WHERE deleted_at IS NULL;
```

### 7.2 Append-only status log with `latest`
```sql
CREATE TABLE loyalty.approval_status (
    id         uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    person_id  uuid        NOT NULL REFERENCES loyalty.person(id),
    status     text        NOT NULL REFERENCES loyalty.approval_status_kind(value),
    valid_at   timestamptz NOT NULL,
    latest     boolean     NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_approval_person_valid ON loyalty.approval_status(person_id, valid_at DESC);
CREATE UNIQUE INDEX uq_approval_latest ON loyalty.approval_status(person_id)
    WHERE latest = true;
```

### 7.3 `system_id` for magic rows
```sql
ALTER TABLE loyalty.account ADD COLUMN system_id text;
CREATE UNIQUE INDEX uq_account_system_id ON loyalty.account(system_id);
```

---

## 8. Multi-Tenancy

### 8.1 Carry `tenant_id` on every tenant-scoped table
Even when tenant membership is derivable through joins, denormalise the `tenant_id` column onto every tenant-scoped table.

### 8.2 Index every tenant-scoped column [Hard Rule]
```sql
CREATE INDEX idx_transaction_tenant_id ON loyalty.transaction(tenant_id);
```

---

## 9. Row Level Security

### 9.1 Enable RLS on every table in an exposed schema — no exceptions [Hard Rule]
```sql
ALTER TABLE loyalty.transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty.transaction FORCE ROW LEVEL SECURITY;
```

### 9.2 Write separate policies per operation
```sql
CREATE POLICY tx_select ON loyalty.transaction FOR SELECT TO authenticated
    USING (tenant_id = (SELECT auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY tx_insert ON loyalty.transaction FOR INSERT TO authenticated
    WITH CHECK (tenant_id = (SELECT auth.jwt() ->> 'tenant_id')::uuid);
```

### 9.3 Always wrap auth functions in `(select ...)` [Hard Rule]
```sql
-- WRONG — evaluates auth.uid() once per row
USING (auth.uid() = user_id)

-- CORRECT — evaluates once per query (initPlan optimisation)
USING ((SELECT auth.uid()) = user_id)
```

The `(select ...)` wrapper forces the Postgres query planner to evaluate the function once per query as an `initPlan`, not once per row. On a 100k-row table, this is a measured 100× speedup. Enforced by Supabase's built-in lint rule `0003_auth_rls_initplan`.

### 9.4 Index every column referenced in an RLS policy [Hard Rule]
RLS policies inject implicit `WHERE` clauses. Without an index, every query is a sequential scan.

---

## 10. Indexing

### 10.1 Index what you filter, sort, and join on — not everything
Indexes have a write cost. Read the query plan (`EXPLAIN (ANALYZE, BUFFERS)`).

### 10.2 Composite index column order
Leftmost columns reusable for prefix queries. Rightmost columns are not independently usable.

### 10.3 Partial indexes for hot subsets
```sql
CREATE INDEX idx_pet_active_owner
    ON loyalty.pet(owner_id) WHERE deleted_at IS NULL;
```

### 10.4 Always create indexes `CONCURRENTLY` in production [Hard Rule]
`CREATE INDEX` (without `CONCURRENTLY`) takes a `SHARE` lock — blocks all writes on the table for the duration.
`CREATE INDEX CONCURRENTLY` does not block writes but takes longer and **cannot run inside a transaction**.

```sql
CREATE INDEX CONCURRENTLY idx_transaction_tenant_created
    ON loyalty.transaction(tenant_id, created_at DESC);
```

If a `CONCURRENTLY` build fails, an `INVALID` index remains. Drop it and retry.

### 10.5 Choose the right index type
- **B-tree** (default) — equality, range, ordering. 95% of cases.
- **GIN** — `jsonb`, full-text search (`tsvector`), array containment (`@>`, `?`).
- **BRIN** — very large append-only tables.
- **GiST** — geometry, ranges, exclusion constraints.

### 10.6 PostgreSQL 17 — B-tree IN-list optimisation (automatic)
PG 17 introduced multi-dimensional B-tree scan optimisation for `IN (...)` and `ANY` operators. Composite indexes on columns that appear together in `IN`/`ANY` filter combinations are significantly more valuable in PG 17 than in earlier versions.

---

## 11. Views, Functions, JSONB, and DML Patterns

### 11.1 Views sparingly; never views-on-views
See `general.md §11.1`.

### 11.2 Build response shapes in SQL with `jsonb_build_object`
Use when shaping relational data **into** a JSON response.

```sql
SELECT jsonb_build_object(
    'id',   p.id,
    'name', p.name,
    'pets', (
        SELECT jsonb_agg(jsonb_build_object('id', pet.id, 'name', pet.name))
        FROM loyalty.pet pet
        WHERE pet.owner_id = p.id AND pet.deleted_at IS NULL
    )
) AS person
FROM loyalty.person p
WHERE p.id = $1;
```

### 11.3 `SECURITY DEFINER` functions — use with care
For aggregations a user cannot see row-by-row but needs a count of, a `SECURITY DEFINER` function bypasses RLS. Always:
- Set `search_path` explicitly: `SET search_path = public, pg_temp`
- `REVOKE EXECUTE ... FROM PUBLIC` and grant only to specific roles
- Parameterise all inputs — never concatenate into SQL

### 11.4 JSONB — when to use vs normalised columns

**Use JSONB when:**
- The set of fields varies between rows.
- Data evolves frequently and per-attribute migrations are impractical.
- Storing external API responses, event payloads, or webhook bodies.

**Use normalised columns when:**
- Attributes are stable, strongly typed, and frequently JOINed.
- You need FK constraints, NOT NULL enforcement, or CHECK on individual fields.
- The field is used in `ORDER BY`, `GROUP BY`, or range queries.

**Hybrid pattern (recommended):** Normalise the core entity fields as typed columns. Add a `metadata jsonb` or `attributes jsonb` column for the flexible remainder.

**Indexing JSONB:**
- For `@>` (containment) and `?` (key existence): GIN index.
- For a specific key's value (`data->>'status' = 'active'`): functional B-tree index `((data->>'status'))`.

### 11.5 JSON_TABLE — shredding JSONB into relational rows (PG 17)
`JSON_TABLE` is the complement of `jsonb_build_object`, not its replacement. They operate in **opposite directions**:
- `jsonb_build_object` — relational rows **→ JSON** (output shaping).
- `JSON_TABLE` — JSON **→ relational rows** (input processing).

**When to use JSON_TABLE:**
- Shredding stored event payloads or webhook bodies into typed columns for reporting.
- One-off analytics queries against JSONB columns.
- Backfilling a new normalised column from existing JSONB data in a migration.

```sql
SELECT jt.*
FROM orders o,
JSON_TABLE(
    o.line_items,
    '$[*]'
    COLUMNS (
        product_id  uuid          PATH '$.product_id',
        quantity    integer       PATH '$.quantity',
        unit_price  numeric(10,2) PATH '$.unit_price',
        currency    text          PATH '$.currency'  DEFAULT 'EUR' ON EMPTY
    )
) AS jt
WHERE o.id = $1;
```

### 11.6 Upsert patterns — INSERT ON CONFLICT vs MERGE (PG 17)
PostgreSQL 17 enhanced `MERGE` with a `RETURNING` clause and `merge_action()` function. The two patterns are not interchangeable.

**[TODO: section truncated in source — re-fetch from canonical document. The Research Authority should verify the latest decision rule once full text is available.]**

---

## §12–§17 [TODO: re-fetch from canonical source]

The following sections were referenced in the changelog but truncated in the source upload:
- §15 Performance: storage cost parameters, EXPLAIN diagnostics, VACUUM on PG 17, restore-test backups.
- §16 Supabase-specific: RLS, JWT auth, connection pooling, Realtime, Edge Functions, tooling, Volatile Claims Register, Environment Verification Script.
- §17 Quick Reference Runbooks (PostgreSQL/Supabase-specific).
- Hard Rules quick reference table.
- Pre-Production Checklist (Manual + Automated).

When the Research Authority re-fetches the full document, append the remaining sections here and remove this notice.
