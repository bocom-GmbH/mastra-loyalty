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
];

async function main() {
  const editor = mastra.getEditor();
  if (!editor) throw new Error('MastraEditor is not configured on this Mastra instance');

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
