import { mastra } from './mastra';

const AGENT_ID = 'weather-agent';

async function main() {
  const editor = mastra.getEditor();
  if (!editor) throw new Error('MastraEditor is not configured on this Mastra instance');

  const existing = await editor.agent.getById(AGENT_ID).catch(() => null);

  const snapshot = {
    name: 'weather-agent',
    description: 'Helpful weather assistant backed by the weather tool',
    instructions:
      'You are a helpful weather assistant. Use the weather tool to get current conditions for any city the user asks about. Respond concisely and always in English, regardless of the language the user writes in.',
    model: { provider: 'openai', name: 'gpt-4o-mini' },
    tools: { weatherTool: {} },
  } as const;

  if (existing) {
    await editor.agent.update({ id: AGENT_ID, ...snapshot, status: 'published' });
    console.log(`Updated agent "${AGENT_ID}"`);
  } else {
    await editor.agent.create({ id: AGENT_ID, ...snapshot });
    await editor.agent.update({ id: AGENT_ID, status: 'published' });
    console.log(`Created agent "${AGENT_ID}"`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
