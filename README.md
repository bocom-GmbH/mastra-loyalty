# Mastra + Studio on Coolify

Mastra application deployed via **Docker Compose** on Coolify. A single container serves both the Mastra API and the bundled Studio UI, protected by Basic Auth at the Traefik layer managed by Coolify.

## What's inside

- **Data team** (Q&A read-only): `data-agent`, `schema-explorer-agent`, `query-runner-agent`.
- **Database governance team** (10 agents) — manifest names from the DELPHI spec, persona-rich instructions, separation of powers wired via Mastra's `agents:` field:
  - **THEMIS** — orchestrator and sole interface to the human decision-maker
  - **CHIRON** — onboarding / clearance (advisory only for now)
  - **THOTH** — research, version verification
  - **SESHAT** — data governance, privacy, DSGVO/GDPR clearance, waiver approver
  - **ATHENA** — database design authority (spec writer)
  - **JANUS** — PostgreSQL / Supabase specialist (also handles read-only Q&A)
  - **DAEDALUS** — SQLite specialist
  - **MAAT** — checklist, waiver recording, compliance auditor
  - **HEPHAESTUS** — migration executor (the only writer)
  - **ARGUS** — post-execution verifier

The guideline documents the agents read live in [src/mastra/governance/guidelines/](src/mastra/governance/guidelines/). The original DELPHI agent spec files are kept for reference in [docs/agent-specs/](docs/agent-specs/).

## Repository layout

```
.
├── Dockerfile               # Builds the Mastra app and bundles seed.mjs
├── docker-compose.yml       # Coolify stack — single `mastra` service
├── package.json
├── tsconfig.json
├── docs/
│   └── agent-specs/         # Reference: DELPHI six-agent spec
└── src/
    ├── mastra/
    │   ├── index.ts                 # Mastra() instance with all agents registered
    │   ├── data/                    # Q&A team + Supabase read-only pool + tools
    │   └── governance/              # Governance team + admin pool + tools + guidelines
    │       ├── agents.ts
    │       ├── guideline-tool.ts
    │       ├── pool.ts
    │       ├── guidelines/{general,postgres-supabase,sqlite}.md
    │       └── tools/{run-ddl,audit-checklist,record-waiver,verify-state}.ts
    └── seed-editor.ts        # Registers every agent in the editor storage
```

## Prerequisites on Coolify

1. A project created.
2. A **PostgreSQL** running in the same project (Resource → Database → PostgreSQL). Note the internal hostname (something like `postgresql-xxxx`). This is the **Mastra storage** — it holds threads, messages, agent versions, traces. It is not Supabase.
3. A **Supabase project** if you want the data and governance teams to talk to a real database.
4. One domain pointed at this server, e.g. `mastra.yourdomain.com`. Coolify generates Traefik routing automatically from the **Domains** tab.

## Environment variables

Set these in **Resource → Environment Variables** in Coolify:

| Variable                  | What it does                                                                 |
|---------------------------|------------------------------------------------------------------------------|
| `DATABASE_URL`            | Connection to the Coolify-managed Postgres used as Mastra's internal storage |
| `DATABASE_SSL`            | `false` for the internal Coolify Postgres, `true` for a managed Postgres     |
| `OPENAI_API_KEY`          | OpenAI key — every agent uses `gpt-4o-mini` by default                        |
| `SUPABASE_READONLY_URL`   | Read-only Postgres role on Supabase. Used by JANUS and the data team Q&A     |
| `SUPABASE_DATA_SSL`       | `true` (default) — Supabase requires TLS                                     |
| `SUPABASE_ADMIN_URL`      | DDL-capable Postgres role on Supabase. Used by HEPHAESTUS and MAAT           |
| `SUPABASE_ADMIN_SSL`      | `true` (default)                                                             |

### Creating the Supabase roles

**`data_agent_ro`** — read-only, bypasses RLS so the agent can audit any table:

```sql
CREATE ROLE data_agent_ro LOGIN PASSWORD '<generate-with-openssl-rand>';
GRANT USAGE ON SCHEMA public TO data_agent_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO data_agent_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO data_agent_ro;
ALTER ROLE data_agent_ro BYPASSRLS;
```

Connection string (transaction pooler, port 6543):
```
postgresql://data_agent_ro.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres
```

**`data_agent_admin`** — DDL on the `public` schema, bypasses RLS, **not a superuser**:

```sql
CREATE ROLE data_agent_admin LOGIN PASSWORD '<generate-with-openssl-rand>';
GRANT USAGE, CREATE ON SCHEMA public TO data_agent_admin;
GRANT ALL ON ALL TABLES IN SCHEMA public TO data_agent_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO data_agent_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO data_agent_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO data_agent_admin;
ALTER ROLE data_agent_admin BYPASSRLS;
```

For DDL the **direct connection** is recommended over the pooler, since some DDL (`CREATE INDEX CONCURRENTLY`) cannot run inside a transaction pooler. If the network only allows IPv4, the session pooler (port 5432 of the pooler host) is the next best choice.

### Basic Auth at the Traefik level

The hash is inlined in [docker-compose.yml](docker-compose.yml). Generate a new one with:

```bash
htpasswd -nbB admin 'your-password'
```

Paste the raw output into the `traefik.http.middlewares.mastra-auth.basicauth.users` label, keeping single `$` characters (Coolify does not unescape `$$` before passing labels to Traefik).

## Deploy flow

1. Push this repo to your Git provider (Coolify pulls from the same branch you configured).
2. Coolify rebuilds. The Dockerfile runs:
   - `npm ci --include=dev`
   - `npx mastra build --studio` → produces `.mastra/output/` including the Studio UI assets
   - `npx esbuild src/seed-editor.ts ... --outfile=.mastra/output/seed.mjs` → bundles the seed script for the runtime container
   - Copies the guideline `.md` files alongside the output so the `read-guideline` tool can locate them.
3. The container starts with `node .mastra/output/index.mjs`.

## Seeding the editor storage

Every agent definition lives in code, but for Studio to render and let you edit instructions you also need a row in the editor storage. The seed reads `instructions` and `description` directly from the live `Agent` instances, so what you see in Studio is what the agent actually runs.

After a deploy:

```bash
# In the Coolify resource Terminal:
node /app/.mastra/output/seed.mjs
```

Expected output: each agent is created or updated, and obsolete IDs from earlier iterations are deleted from storage.

The seed is **idempotent**, but it **overwrites** any edits you made in Studio. If you want to keep Studio edits, do not re-run the seed.

## Using the agents in Studio

Open the Studio URL (with Basic Auth) and pick an agent.

- **JANUS** — set Chat Method to `Generate` or `Stream`. Ask read-only questions about the live Supabase database, e.g. *"List all tables in the public schema"*, *"How many rows in customer?"*.
- **THEMIS** — set Chat Method to `Network`. THEMIS routes the task to the right agent and runs the pipeline. Use for both read-only questions and structural changes.
- The other agents work in `Generate`/`Stream` for direct testing, or are invoked by THEMIS through `Network` mode.

## Local development

```bash
npm install
cp .env.example .env       # fill in DATABASE_URL + OPENAI_API_KEY + SUPABASE_*_URL
npm run dev                # mastra dev (API + Studio at http://localhost:4111)
npm run seed               # seed the editor storage (uses tsx, no build required)
npm run typecheck          # tsc --noEmit
```

## Notes

- **Storage**: `PostgresStore` creates the Mastra tables (`mastra_messages`, `mastra_threads`, agent version snapshots, traces) in `public` of `DATABASE_URL` on first start. No manual migration needed.
- **Studio in production has full access** to agents, tools, and workflows. Always keep Basic Auth in front of it, or swap for another Traefik middleware (e.g. `forwardAuth` with an OAuth provider).
- **All agents respond in English** regardless of the input language — the instructions enforce this.
- **Separation of powers** in the governance team is wired in the `agents:` field on each Mastra agent:
  - Only THEMIS can call HEPHAESTUS and ARGUS.
  - ATHENA cannot call HEPHAESTUS — only generate specs.
  - HEPHAESTUS cannot call ARGUS — only THEMIS does.
- **Models**: every agent uses `openai/gpt-4o-mini`. The DELPHI spec recommends `anthropic/claude-sonnet-4-6`; to switch, install `@ai-sdk/anthropic` and change the `model:` field per agent.
- **Versions**: `@mastra/core` ^1.33, `mastra` CLI ^1.9.2, Node 22.
