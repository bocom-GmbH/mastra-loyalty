/**
 * Database Governance Pipeline — Mastra Agent Roster
 *
 * Six-agent pipeline for spec-driven database migrations:
 *   1. orchestrator             — intake, routing, close-out
 *   2. design-authority         — schema design and spec issuance
 *   3. governance-authority     — privacy / DSGVO / PII clearance
 *   4. engine-specialist        — engine-specific rule review (SQLite, PostgreSQL)
 *   5. migration-executor       — sole execution authority
 *   6. post-execution-verifier  — read-only verification, PASS gate
 *
 * Register with a Mastra instance:
 *
 *   import { Mastra } from '@mastra/core';
 *   import { agents } from './agents';
 *
 *   export const mastra = new Mastra({ agents });
 */

export { orchestratorAgent } from './orchestrator.agent';
export { designAuthorityAgent } from './design-authority.agent';
export { governanceAuthorityAgent } from './governance-authority.agent';
export { engineSpecialistAgent } from './engine-specialist.agent';
export { migrationExecutorAgent } from './migration-executor.agent';
export { postExecutionVerifierAgent } from './post-execution-verifier.agent';

import { orchestratorAgent } from './orchestrator.agent';
import { designAuthorityAgent } from './design-authority.agent';
import { governanceAuthorityAgent } from './governance-authority.agent';
import { engineSpecialistAgent } from './engine-specialist.agent';
import { migrationExecutorAgent } from './migration-executor.agent';
import { postExecutionVerifierAgent } from './post-execution-verifier.agent';

/**
 * All six agents keyed by their `name` field, ready to drop into
 * `new Mastra({ agents })`.
 */
export const agents = {
  orchestrator: orchestratorAgent,
  'design-authority': designAuthorityAgent,
  'governance-authority': governanceAuthorityAgent,
  'engine-specialist': engineSpecialistAgent,
  'migration-executor': migrationExecutorAgent,
  'post-execution-verifier': postExecutionVerifierAgent,
} as const;
