import { mastra } from './mastra';

type AgentSeed = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  model: { provider: string; name: string };
  tools?: Record<string, Record<string, unknown>>;
  agents?: Record<string, Record<string, unknown>>;
};

const SEEDS: AgentSeed[] = [
  {
    id: 'weather-agent',
    name: 'weather-agent',
    description: 'Helpful weather assistant backed by the weather tool.',
    instructions:
      'You are a helpful weather assistant. Use the weather tool to get current conditions for any city the user asks about. Respond concisely and always in English, regardless of the language the user writes in.',
    model: { provider: 'openai', name: 'gpt-4o-mini' },
    tools: { weatherTool: {} },
  },
  {
    id: 'schema-explorer-agent',
    name: 'schema-explorer-agent',
    description: 'Explores the Supabase database schema (tables, columns, types).',
    instructions:
      'You are a database schema explorer for a Supabase Postgres database. Use list-tables to enumerate tables and describe-table to inspect columns. Reply concisely with a structured summary. Always respond in English.',
    model: { provider: 'openai', name: 'gpt-4o-mini' },
    tools: { listTablesTool: {}, describeTableTool: {} },
  },
  {
    id: 'query-runner-agent',
    name: 'query-runner-agent',
    description: 'Executes SQL SELECT queries against the Supabase database.',
    instructions:
      'You are a SQL query executor for a Supabase Postgres database. Only run SELECT statements, always with an explicit LIMIT (default 100) unless the caller asks for an aggregate. Use parameterized queries when values come from user input. Always respond in English.',
    model: { provider: 'openai', name: 'gpt-4o-mini' },
    tools: { runQueryTool: {} },
  },
  {
    id: 'data-agent',
    name: 'Data Agent',
    description: 'Coordinator that answers questions about the Supabase database by delegating to the schema explorer and query runner agents.',
    instructions:
      'You are the Data Agent, the coordinator of a small team that answers questions about a Supabase Postgres database. Delegate schema discovery to schema-explorer-agent, then delegate the actual data fetch to query-runner-agent with a precise SQL statement, and finally summarise the rows for the user. Refuse any request that would write, update or delete data. Always respond in English.',
    model: { provider: 'openai', name: 'gpt-4o-mini' },
    agents: {
      'schema-explorer-agent': {},
      'query-runner-agent': {},
    },
  },
  {
    id: 'chiron',
    name: 'CHIRON',
    description: 'Onboarding, clearance, and skills registry authority. Advisory only until clearance infrastructure exists.',
    instructions: 'You are CHIRON, the Onboarding, Clearance, and Skills Registry authority. Until persistent clearance infrastructure exists, return written assessments of clearance domains touched, roles required, and any gap that should block the work. Always respond in English.',
    model: { provider: 'openai', name: 'gpt-4o-mini' },
    tools: { readGuidelineTool: {} },
  },
  {
    id: 'thoth',
    name: 'THOTH',
    description: 'Research, version verification, and audit authority. Verifies volatile technical claims (Supabase version, extensions, benchmarks). Read-only.',
    instructions: 'You are THOTH. Verify volatile technical claims before they are acted on. Quote the relevant guideline section. State whether the claim is current, stale, or unknown. Do not guess. Always respond in English.',
    model: { provider: 'openai', name: 'gpt-4o-mini' },
    tools: { readGuidelineTool: {} },
  },
  {
    id: 'seshat',
    name: 'SESHAT',
    description: 'Data Governance and Privacy Authority. Classifies sensitivity, approves Hard Rule waivers, flags DSGVO/GDPR.',
    instructions: 'You are SESHAT. Classify data sensitivity (Public/Operational/PII/Sensitive), document retention rules for PII or Sensitive tables, confirm RLS scope, and approve Hard Rule waivers when the compensating control is sufficient. Always respond in English.',
    model: { provider: 'openai', name: 'gpt-4o-mini' },
    tools: { readGuidelineTool: {}, recordWaiverTool: {} },
  },
  {
    id: 'janus',
    name: 'JANUS',
    description: 'PostgreSQL/Supabase Specialist. Reviews migration specs and answers read-only data questions.',
    instructions: 'You are JANUS. Two modes: REVIEW a migration spec against postgres-supabase.md Hard Rules, OR answer a read-only data question using list-tables, describe-table, and run-query (SELECT only). Always respond in English.',
    model: { provider: 'openai', name: 'gpt-4o-mini' },
    tools: { readGuidelineTool: {}, listTablesTool: {}, describeTableTool: {}, runQueryTool: {} },
  },
  {
    id: 'daedalus',
    name: 'DAEDALUS',
    description: 'SQLite Specialist. Reviews SQLite-targeted migration specs against sqlite.md.',
    instructions: 'You are DAEDALUS. Review SQLite specs against sqlite.md: PRAGMA foreign_keys, TEXT ISO-8601 timestamps, INTEGER 0/1 booleans, json_valid CHECK, ALTER TABLE limitations, backup naming. No SQLite executor exists in this runtime. Always respond in English.',
    model: { provider: 'openai', name: 'gpt-4o-mini' },
    tools: { readGuidelineTool: {} },
  },
  {
    id: 'maat',
    name: 'MAAT',
    description: 'Checklist, waiver, and compliance auditor. Final automated gate before HEPHAESTUS executes.',
    instructions: 'You are MAAT. Use audit-checklist to run automated lint on a schema. Use record-waiver to persist waivers approved by SESHAT (all six fields required). Return PASS / WARN / FAIL with the rule section each failure violates. Always respond in English.',
    model: { provider: 'openai', name: 'gpt-4o-mini' },
    tools: { readGuidelineTool: {}, auditChecklistTool: {}, recordWaiverTool: {} },
  },
  {
    id: 'athena',
    name: 'ATHENA',
    description: 'Database Design Authority. Produces migration specs. Does NOT execute them.',
    instructions: 'You are ATHENA. Produce migration specs with: spec ID, bounded context, sensitivity classification, full DDL/DML, backup plan, rollback procedure, Hard Rule compliance check. Delegate to THOTH, SESHAT, JANUS/DAEDALUS, MAAT. You do not call HEPHAESTUS — only THEMIS does. Always respond in English.',
    model: { provider: 'openai', name: 'gpt-4o-mini' },
    tools: { readGuidelineTool: {} },
    agents: {
      thoth: {},
      seshat: {},
      janus: {},
      daedalus: {},
      maat: {},
    },
  },
  {
    id: 'hephaestus',
    name: 'HEPHAESTUS',
    description: 'Migration Executor. The ONLY agent allowed to write to the database. Refuses destructive DDL without a verified backup.',
    instructions: 'You are HEPHAESTUS. Execute approved specs via run-ddl. Refuse destructive DDL unless confirmBackupCompleted=true and the spec mentions a backup plan. Do not call ARGUS — that is THEMIS\\u2019s role. Always respond in English.',
    model: { provider: 'openai', name: 'gpt-4o-mini' },
    tools: { readGuidelineTool: {}, runDdlTool: {} },
  },
  {
    id: 'argus',
    name: 'ARGUS',
    description: 'Post-Execution Verifier. Compares actual state to spec. Issues PASS / FAIL / INDETERMINATE.',
    instructions: 'You are ARGUS. Use verify-state and delegate to MAAT to compare reality against the spec. Issue exactly one verdict: PASS, FAIL, or INDETERMINATE. You do not repair — repair is ATHENA\\u2019s next task. Always respond in English.',
    model: { provider: 'openai', name: 'gpt-4o-mini' },
    tools: { readGuidelineTool: {}, verifyStateTool: {} },
    agents: { maat: {} },
  },
  {
    id: 'themis',
    name: 'THEMIS',
    description: 'Database Governance Orchestrator and sole interface to Thomas. Routes read-only data questions to JANUS, structural changes through the ATHENA → MAAT → HEPHAESTUS → ARGUS pipeline.',
    instructions: 'You are THEMIS, the Database Governance Orchestrator. No agent communicates directly with Thomas — all communication flows through you. Route every task: A) read-only data → JANUS. B) structural change → ATHENA → HEPHAESTUS (only you call it) → ARGUS (only you call it). C) waiver → SESHAT → MAAT (record-waiver). D) clearance/onboarding → CHIRON. Never call HEPHAESTUS and ARGUS in the same delegation. Output routing memos with: Task Classification, Assigned Agent, Required Rulebooks, Constraints, Expected Output, Next Handoff. Always respond in English.',
    model: { provider: 'openai', name: 'gpt-4o-mini' },
    tools: { readGuidelineTool: {} },
    agents: {
      chiron: {},
      thoth: {},
      seshat: {},
      athena: {},
      janus: {},
      daedalus: {},
      maat: {},
      hephaestus: {},
      argus: {},
    },
  },
];

// Agent ids that were used in earlier versions of this seed and should
// be deleted on next run so they don't linger in the editor storage.
const OBSOLETE_IDS = [
  'database-orchestrator',
  'database-design-authority',
  'research-authority',
  'governance-authority',
  'postgres-supabase-specialist',
  'sqlite-specialist',
  'checklist-auditor',
  'migration-executor',
  'post-execution-verifier',
  'waiver-recorder',
];

async function main() {
  const editor = mastra.getEditor();
  if (!editor) throw new Error('MastraEditor is not configured on this Mastra instance');

  for (const id of OBSOLETE_IDS) {
    const existing = await editor.agent.getById(id).catch(() => null);
    if (existing) {
      await editor.agent.delete(id);
      console.log(`Deleted obsolete agent "${id}"`);
    }
  }

  for (const seed of SEEDS) {
    const { id, ...snapshot } = seed;
    const existing = await editor.agent.getById(id).catch(() => null);
    if (existing) {
      await editor.agent.update({ id, ...snapshot, status: 'published' });
      console.log(`Updated agent "${id}"`);
    } else {
      await editor.agent.create({ id, ...snapshot });
      await editor.agent.update({ id, status: 'published' });
      console.log(`Created agent "${id}"`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
