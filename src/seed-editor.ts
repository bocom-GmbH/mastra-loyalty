import type { Agent } from '@mastra/core/agent';
import { weatherAgent } from './mastra/agents/weather-agent';
import { dataAgent, queryRunnerAgent, schemaExplorerAgent } from './mastra/data/agents';
import { mastra } from './mastra';
import {
  argusAgent,
  athenaAgent,
  chironAgent,
  daedalusAgent,
  hephaestusAgent,
  janusAgent,
  maatAgent,
  seshatAgent,
  themisAgent,
  thothAgent,
} from './mastra/governance/agents';

type AgentSeedExtras = {
  toolKeys: string[];
  agentKeys?: string[];
};

// Map an Agent instance into the shape the editor storage expects.
async function buildSeed(agent: Agent<any, any>, extras: AgentSeedExtras) {
  const id = agent.id;
  const instructions = await agent.getInstructions({});
  const instructionsText =
    typeof instructions === 'string' ? instructions : JSON.stringify(instructions);
  return {
    id,
    name: agent.name,
    description: agent.getDescription(),
    instructions: instructionsText,
    model: { provider: 'openai', name: 'gpt-4o-mini' },
    tools: Object.fromEntries(extras.toolKeys.map((k) => [k, {} as Record<string, unknown>])),
    ...(extras.agentKeys?.length
      ? {
          agents: Object.fromEntries(
            extras.agentKeys.map((k) => [k, {} as Record<string, unknown>]),
          ),
        }
      : {}),
  };
}

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

  const SEEDS = await Promise.all([
    buildSeed(weatherAgent, { toolKeys: ['weatherTool'] }),
    buildSeed(schemaExplorerAgent, { toolKeys: ['listTablesTool', 'describeTableTool'] }),
    buildSeed(queryRunnerAgent, { toolKeys: ['runQueryTool'] }),
    buildSeed(dataAgent, {
      toolKeys: [],
      agentKeys: ['schema-explorer-agent', 'query-runner-agent'],
    }),
    buildSeed(chironAgent, { toolKeys: ['readGuidelineTool'] }),
    buildSeed(thothAgent, { toolKeys: ['readGuidelineTool'] }),
    buildSeed(seshatAgent, { toolKeys: ['readGuidelineTool', 'recordWaiverTool'] }),
    buildSeed(janusAgent, {
      toolKeys: ['readGuidelineTool', 'listTablesTool', 'describeTableTool', 'runQueryTool'],
    }),
    buildSeed(daedalusAgent, { toolKeys: ['readGuidelineTool'] }),
    buildSeed(maatAgent, {
      toolKeys: ['readGuidelineTool', 'auditChecklistTool', 'recordWaiverTool'],
    }),
    buildSeed(athenaAgent, {
      toolKeys: ['readGuidelineTool'],
      agentKeys: ['thoth', 'seshat', 'janus', 'daedalus', 'maat'],
    }),
    buildSeed(hephaestusAgent, { toolKeys: ['readGuidelineTool', 'runDdlTool'] }),
    buildSeed(argusAgent, {
      toolKeys: ['readGuidelineTool', 'verifyStateTool'],
      agentKeys: ['maat'],
    }),
    buildSeed(themisAgent, {
      toolKeys: ['readGuidelineTool'],
      agentKeys: [
        'chiron',
        'thoth',
        'seshat',
        'athena',
        'janus',
        'daedalus',
        'maat',
        'hephaestus',
        'argus',
      ],
    }),
  ]);

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
