import { Mastra } from '@mastra/core';
import { MastraEditor } from '@mastra/editor';
import { PinoLogger } from '@mastra/loggers';
import { PostgresStore } from '@mastra/pg';
import { dataAgent, queryRunnerAgent, schemaExplorerAgent } from './data/agents';
import { governanceAgents } from './governance/agents';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const storage = new PostgresStore({
  id: 'pg-storage',
  connectionString: process.env.DATABASE_URL,
  schemaName: 'public',
  ssl:
    process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : false,
  max: 20,
  idleTimeoutMillis: 30_000,
});

export const mastra = new Mastra({
  storage,
  agents: {
    dataAgent,
    schemaExplorerAgent,
    queryRunnerAgent,
    ...governanceAgents,
  },
  editor: new MastraEditor(),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
