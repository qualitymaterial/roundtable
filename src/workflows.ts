import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Stage, validateStages } from './policy.js';

const directory = fileURLToPath(new URL('../examples/workflows/', import.meta.url));
export const Workflow = z.object({ version: z.literal(1), name: z.string().min(1).max(100), objective: z.string().min(1).max(12000), constraints: z.string().max(12000), stages: z.array(Stage).min(1).max(20).optional(), policy: z.enum(['open', 'goal', 'structured', 'parallel']).default('goal') }).strict();
export const workflows = () => readdirSync(directory).filter(name => name.endsWith('.json')).map(name => ({ id: name.slice(0, -5), ...Workflow.parse(JSON.parse(readFileSync(resolve(directory, name), 'utf8'))) }));
export function loadWorkflow(reference: string) {
  const path = /^[a-z-]+$/.test(reference) && existsSync(resolve(directory, reference + '.json')) ? resolve(directory, reference + '.json') : resolve(reference);
  const data = readFileSync(path); if (data.byteLength > 64000) throw new Error('Workflow is too large');
  const workflow = Workflow.parse(JSON.parse(data.toString('utf8'))); if (workflow.stages) validateStages(workflow.stages); return workflow;
}
