import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getAdminPool } from '../pool';

export const recordWaiverTool = createTool({
  id: 'record-waiver',
  description:
    'Record a Hard Rule waiver. Creates the `governance.waiver` table on first use. Required before any Hard Rule departure can be executed (general.md §17.1).',
  inputSchema: z.object({
    specId: z.string().describe('The spec ID this waiver applies to.'),
    ruleReference: z.string().describe('The rule being waived, e.g. "general.md §17.2", "postgres-supabase.md §3.3".'),
    reason: z.string().describe('Why the Hard Rule is being departed from.'),
    compensatingControl: z.string().describe('What mitigates the risk of waiving this rule.'),
    signedOffBy: z.string().describe('Name or role of the Governance Authority approving the waiver.'),
    expiresAt: z.string().describe('ISO-8601 UTC timestamp when this waiver expires. Waivers are time-bounded.'),
  }),
  outputSchema: z.object({
    waiverId: z.string(),
    recordedAt: z.string(),
  }),
  execute: async ({ specId, ruleReference, reason, compensatingControl, signedOffBy, expiresAt }) => {
    const pool = getAdminPool();
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE SCHEMA IF NOT EXISTS governance;
        CREATE TABLE IF NOT EXISTS governance.waiver (
          id                   uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
          spec_id              text        NOT NULL,
          rule_reference       text        NOT NULL,
          reason               text        NOT NULL,
          compensating_control text        NOT NULL,
          signed_off_by        text        NOT NULL,
          expires_at           timestamptz NOT NULL,
          created_at           timestamptz NOT NULL DEFAULT now()
        );
      `);
      const { rows } = await client.query(
        `
        INSERT INTO governance.waiver
          (spec_id, rule_reference, reason, compensating_control, signed_off_by, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, created_at
        `,
        [specId, ruleReference, reason, compensatingControl, signedOffBy, expiresAt],
      );
      return { waiverId: rows[0].id, recordedAt: rows[0].created_at.toISOString() };
    } finally {
      client.release();
    }
  },
});
