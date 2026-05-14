import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const weatherTool = createTool({
  id: 'get-weather',
  description: 'Get the current weather for a city using Open-Meteo.',
  inputSchema: z.object({
    city: z.string().describe('City name, e.g. "São Paulo"'),
  }),
  outputSchema: z.object({
    city: z.string(),
    temperature: z.number(),
    windspeed: z.number(),
    description: z.string(),
  }),
  execute: async ({ context }) => {
    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(context.city)}&count=1`,
    ).then((r) => r.json());

    const place = geo?.results?.[0];
    if (!place) throw new Error(`City not found: ${context.city}`);

    const weather = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current_weather=true`,
    ).then((r) => r.json());

    const current = weather.current_weather;
    return {
      city: `${place.name}, ${place.country}`,
      temperature: current.temperature,
      windspeed: current.windspeed,
      description: `Current temperature ${current.temperature}°C, wind ${current.windspeed} km/h`,
    };
  },
});
