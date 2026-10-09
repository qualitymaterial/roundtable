import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const id = () => randomUUID();
export const timestamp = () => new Date().toISOString();
export const messageTypes = ['direct', 'group', 'broadcast', 'tool_result', 'task_request', 'task_response', 'reply', 'artifact', 'human', 'system'] as const;
export const MessageInput = z.object({
  id: z.string().min(1).max(100).optional(), sessionId: z.string(), sender: z.string(),
  recipients: z.array(z.string()).max(64), threadId: z.string().min(1).max(100).default('main'),
  type: z.enum(messageTypes), body: z.string().min(1).max(24000),
  attachments: z.array(z.string()).max(16).optional(),
  artifacts: z.array(z.string()).max(32).default([]), correlationId: z.string().optional(), taskId: z.string().optional(),
});
export type MessageDraft = z.input<typeof MessageInput>;
export type Message = z.output<typeof MessageInput> & { id: string; sequence: number; timestamp: string };
export const AgentInput = z.object({
  id: z.string().uuid().optional(), name: z.string().min(1).max(80),
  provider: z.string().min(1), model: z.string().min(1), instructions: z.string().max(12000).default(''),
  effort: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  contextWindowTokens: z.number().int().min(1024).optional(),
  permissions: z.array(z.string()).default(['collaborate', 'memory', 'artifact']),
});
export type AgentRecord = z.output<typeof AgentInput> & { id: string; sessionId: string; state: 'active' | 'paused' | 'removed'; compatible: boolean };
export const Limits = z.object({
  exchanges: z.number().int().positive().default(100), toolCalls: z.number().int().positive().default(300),
  requests: z.number().int().positive().default(100), concurrency: z.number().int().min(1).max(16).default(3),
  queue: z.number().int().positive().default(200), timeoutMs: z.number().int().positive().default(900000),
  turnTimeoutMs: z.number().int().positive().default(120000), tokens: z.number().int().positive().nullable().default(null),
  dollars: z.number().positive().default(10),
  providerRequests: z.record(z.string(), z.number().int().positive()).default({}),
});
export type SessionRecord = {
  projectInstructions?: { content: string; hash: string; source: string; reviewedAt: string };
  importedProjectInstructions?: { content: string; hash: string; source: string; reviewedAt: string };
  sourceSession?: string;
  referenceMap?: Record<string, string>;
  workflow?: import('./policy.js').WorkflowState;
  projectRoot?: string;
  name?: string;
  archived?: boolean;
  completion?: { at: string; note: string; by: 'human' };
  hostAccess?: { readRoots: string[]; writeRoots: string[]; shell: boolean };
  id: string; objective: string; policy: 'open' | 'goal' | 'structured' | 'parallel'; constraints: string;
  createdAt: string; state: 'active' | 'paused'; reason?: string; pauseKind?: 'budget' | 'manual'; workspace: string;
  permissions: string[]; limits: z.output<typeof Limits>;
  usage: { exchanges: number; toolCalls: number; requests: number; tokens: number; dollars: number };
  providerRequests: Record<string, number>;
};
export type Task = { id: string; sessionId: string; title: string; state: 'open' | 'claimed' | 'done' | 'cancelled'; owner?: string; findings: string; dependencies: string[]; updatedAt?: string };
export type Artifact = { id: string; sessionId: string; name: string; content: string; hash: string; author: string; createdAt: string; provenance: string; encoding?: 'base64'; mimeType?: string; bytes?: number };
export type Approval = { id: string; sessionId: string; agentId: string; capability: string; reason: string; state: 'pending' | 'approved' | 'rejected' | 'consumed'; command?: { text: string; cwd: string; fingerprint: string; background?: boolean; timeoutMs?: number } };
export type Note = { id: string; sessionId: string; author: string; text: string; kind: 'note' | 'decision'; timestamp: string };
export type Delivery = { messageId: string; agentId: string; state: 'pending' | 'inflight' | 'acknowledged' | 'failed' | 'cancelled'; attempts: number; error?: string };
export interface AgentAdapter {
  steer?(text: string, delivered: () => void): Promise<boolean>;
  clearSteering?(): void;
  compact?(): Promise<unknown>;
  context?(): unknown;
  prompt(text: string, images?: { type: 'image'; data: string; mimeType: string }[]): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
}
export interface ApprovalProvider { decide(id: string, approve: boolean): void }
export interface CollaborationPolicy { eligible(agent: AgentRecord, session: SessionRecord): boolean }

const runtimeSecrets = new Set<string>();
export function protectSecret(value: string | undefined): void { if (value && value.length >= 8) runtimeSecrets.add(value); }
// Redact known environment credentials and common token formats before persistence/display.
export function redact(value: string): string {
  let result = value.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{8,})/gi, '[REDACTED]');
  for (const [key, secret] of Object.entries(process.env)) {
    if (/(KEY|TOKEN|SECRET|PASSWORD)/i.test(key) && secret && secret.length >= 8) result = result.split(secret).join('[REDACTED]');
  }
  for (const secret of runtimeSecrets) result = result.split(secret).join('[REDACTED]');
  return result;
}
