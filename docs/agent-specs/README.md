# Agent specs (reference)

These files came from DELPHI as a six-agent reference design for the
database governance pipeline. They are **not** wired into the Mastra runtime
— the actual agents live in `src/mastra/governance/agents.ts`.

## Mapping to live agents

| Reference file              | Live agent(s) in this repo                   |
|-----------------------------|----------------------------------------------|
| `orchestrator.agent.ts`     | THEMIS                                       |
| `design-authority.agent.ts` | ATHENA                                       |
| `governance-authority.agent.ts` | SESHAT                                   |
| `engine-specialist.agent.ts` | JANUS (PostgreSQL/Supabase) + DAEDALUS (SQLite) |
| `migration-executor.agent.ts` | HEPHAESTUS                                |
| `post-execution-verifier.agent.ts` | ARGUS                                |
| _no equivalent_             | CHIRON, THOTH, MAAT                          |

The live agents preserve the manifest persona names (Greek/Egyptian deities)
and pull in the rich `instructions` content from these specs.

## Differences from the spec

1. **Engine specialist split into two agents.** DELPHI's spec describes one
   `engine-specialist` that switches engines per task. We split it into
   JANUS (PG/Supabase) and DAEDALUS (SQLite) so each can hold engine-specific
   tools cleanly — JANUS has read-only Q&A tools against the live Supabase
   database; DAEDALUS does not (no SQLite executor exists yet).

2. **MAAT covers `checklist-auditor` + waiver recording.** Not present in the
   six-agent spec, but kept from the manifest because it provides a useful
   automated PASS/FAIL gate before HEPHAESTUS executes.

3. **CHIRON and THOTH are advisory-only placeholders.** The manifest names
   them but the project has no clearance registry or research database
   yet, so they currently respond in prose.

4. **Model is `openai/gpt-4o-mini`, not `anthropic/claude-sonnet-4-6`.**
   The spec recommends Anthropic; this project routes through OpenAI to
   avoid adding `@ai-sdk/anthropic` and changing billing. Swap per agent
   if needed.

5. **Tools are wired in.** The spec leaves `// TODO: add tools` in every
   file. The live agents use:
   - `read-guideline` (all agents)
   - `list-tables`, `describe-table`, `run-query` (JANUS — read-only Q&A)
   - `audit-checklist` (MAAT)
   - `record-waiver` (SESHAT, MAAT)
   - `run-ddl` (HEPHAESTUS only — the sole writer)
   - `verify-state` (ARGUS)

6. **Memory.** Orchestrators that use `agent.network()` (THEMIS, ATHENA, ARGUS)
   have a `Memory` instance attached. Leaf agents don't need it.

7. **Separation of powers** is enforced via the `agents: { ... }` field on
   each Mastra agent. Specifically:
   - THEMIS is the only agent that can call HEPHAESTUS and ARGUS.
   - ATHENA can call THOTH, SESHAT, JANUS, DAEDALUS, MAAT — but not HEPHAESTUS.
   - HEPHAESTUS cannot call ARGUS.
   - ARGUS can call MAAT (for checklist re-run) but cannot call HEPHAESTUS.
