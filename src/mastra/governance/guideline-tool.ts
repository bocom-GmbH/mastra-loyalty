import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUIDELINES_DIR = join(HERE, 'guidelines');

const DOC_FILES = {
  general: 'general.md',
  'postgres-supabase': 'postgres-supabase.md',
  sqlite: 'sqlite.md',
} as const;

type DocName = keyof typeof DOC_FILES;

async function loadDoc(name: DocName): Promise<string> {
  return await readFile(join(GUIDELINES_DIR, DOC_FILES[name]), 'utf8');
}

function extractSection(doc: string, section: string): string {
  const normalised = section.trim().replace(/^§/, '').replace(/^#+\s*/, '');
  const lines = doc.split('\n');
  const headerPattern = new RegExp(
    `^#{1,6}\\s+(?:§\\s*)?${normalised.replace(/[.*+?^${}()|[\\\]]/g, '\\$&')}(?:\\s|$|[.:])`,
    'i',
  );

  let start = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (headerPattern.test(line)) {
      start = i;
      startLevel = (line.match(/^#+/) ?? [''])[0].length;
      break;
    }
  }
  if (start === -1) return `[Section "${section}" not found in document]`;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= startLevel) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

export const readGuidelineTool = createTool({
  id: 'read-guideline',
  description:
    'Read the database design guideline documents (general, postgres-supabase, sqlite). Always read the general document first, then the engine-specific one. Pass a section number/title to extract just one section instead of the whole file.',
  inputSchema: z.object({
    doc: z
      .enum(['general', 'postgres-supabase', 'sqlite'])
      .describe('Which guideline document to read.'),
    section: z
      .string()
      .optional()
      .describe(
        'Optional section reference, e.g. "§9.3", "17", "Hard Rules". If omitted, returns the full document.',
      ),
  }),
  outputSchema: z.object({
    doc: z.string(),
    section: z.string().nullable(),
    content: z.string(),
  }),
  execute: async ({ doc, section }) => {
    const full = await loadDoc(doc);
    const content = section ? extractSection(full, section) : full;
    return { doc, section: section ?? null, content };
  },
});
