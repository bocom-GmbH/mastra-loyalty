import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { weatherTool } from '../tools/weather-tool';

export const weatherAgent = new Agent({
  id: 'weather-agent',
  name: 'weather-agent',
  instructions: `You are a helpful weather assistant. Use the weather tool to get
current conditions for any city the user asks about. Respond concisely and in
the user's language.`,
  model: openai('gpt-4o-mini'),
  tools: { weatherTool },
});
