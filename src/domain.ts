import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const id = () => randomUUID();
export const timestamp = () => new Date().toISOString();
export const messageTypes = ['direct', 'group', 'broadcast', 'tool_result', 'task_request', 'task_response', 'reply', 'artifact', 'human', 'system'] as const;
export const MessageInput = z.object({
  id: z.string().min(1).max(100).optional(), sessionId: z.string(), sender: z.string(),
  recipients: z.array(z.string()).max(64), threadId: z.string().min(1).max(100).default('main'),
  type: z.enum(messageTypes), body: z.string().min(1).max(24000),
  artifacts: z.array(z.string()).max(32).default([]), correlationId: z.string().optional(), taskId: z.string().optional(),
});
export type MessageDraft = z.input<typeof MessageInput>;
export type Message = z.output<typeof MessageInput> & { id: string; sequence: number; timestamp: string };
export const AgentInput = z.object({
  id: z.string().uuid().optional(), name: z.string().min(1).max(80),
  provider: z.string().min(1), model: z.string().min(1), instructions: z.string().max(12000).default(''),
  permissions: z.array(z.string()).default(['collaborate', 'memory', 'artifact']),
});
export type AgentRecord = z.output<typeof AgentInput> & { id: string; sessionId: string; state: 'active' | 'paused' | 'removed'; compatible: boolean };
export const Limits = z.object({
  exchanges: z.number().int().positive().default(100), toolCalls: z.number().int().positive().default(300),
  requests: z.number().int().positive().default(100), concurrency: z.number().int().min(1).max(16).default(3),
  queue: z.number().int().positive().default(200), timeoutMs: z.number().int().positive().default(900000),
  turnTimeoutMs: z.number().int().positive().default(120000), tokens: z.number().positive().default(500000),
  dollars: z.number().positive().default(10),
  providerRequests: z.record(z.string(), z.number().int().positive()).default({}),
});
export type SessionRecord = {
  hostAccess?: { readRoots: string[]; writeRoots: string[]; shell: boolean };
  id: string; objective: string; policy: 'open' | 'goal' | 'structured' | 'parallel'; constraints: string;
  createdAt: string; state: 'active' | 'paused'; reason?: string; workspace: string;
  permissions: string[]; limits: z.output<typeof Limits>;
  usage: { exchanges: number; toolCalls: number; requests: number; tokens: number; dollars: number };
  providerRequests: Record<string, number>;
};
export type Task = { id: string; sessionId: string; title: string; state: 'open' | 'claimed' | 'done' | 'cancelled'; owner?: string; findings: string; dependencies: string[] };
export type Artifact = { id: string; sessionId: string; name: string; content: string; hash: string; author: string; createdAt: string; provenance: string };
export type Approval = { id: string; sessionId: string; agentId: string; capability: string; reason: string; state: 'pending' | 'approved' | 'rejected' | 'consumed'; command?: { text: string; cwd: string; fingerprint: string } };
export type Note = { id: string; sessionId: string; author: string; text: string; kind: 'note' | 'decision'; timestamp: string };
export type Delivery = { messageId: string; agentId: string; state: 'pending' | 'inflight' | 'acknowledged' | 'failed'; attempts: number; error?: string };
export interface AgentAdapter {
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
}
export interface ApprovalProvider { decide(id: string, approve: boolean): void }
export interface CollaborationPolicy { eligible(agent: AgentRecord, session: SessionRecord): boolean }

// Redact known environment credentials and common token formats before persistence/display.
export function redact(value: string): string {
  let result = value.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{8,})/gi, '[REDACTED]');
  for (const [key, secret] of Object.entries(process.env)) {
    if (/(KEY|TOKEN|SECRET|PASSWORD)/i.test(key) && secret && secret.length >= 8) result = result.split(secret).join('[REDACTED]');
  }
  return result;
}
