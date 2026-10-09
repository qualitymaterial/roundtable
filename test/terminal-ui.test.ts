import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WriteStream } from 'node:tty';
import type { Interface } from 'node:readline/promises';
import { safeTerminalText, TerminalUI } from '../src/terminal-ui.js';
import { Limits, type SessionRecord, type AgentRecord } from '../src/domain.js';

test('terminal renderer shows identity, access, budgets and exact approval details at narrow widths', () => {
  let output = ''; const stream = { columns: 64, write: (text: string) => { output += text; return true; } } as WriteStream;
  const ui = new TerminalUI(stream, true, false, false);
  const session: SessionRecord = { id: 'session-fixture', objective: 'Terminal fixture only; no live model call', state: 'paused', reason: 'Request limit', createdAt: '', workspace: '/workspace', policy: 'goal', constraints: '', permissions: [], limits: Limits.parse({}), usage: { requests: 4, toolCalls: 2, tokens: 100, dollars: 0.1, exchanges: 3 }, providerRequests: {} };
  const agent: AgentRecord = { id: 'agent-fixture', sessionId: session.id, name: 'Example participant', provider: 'fixture', model: 'mock-model', instructions: '', permissions: ['collaborate'], state: 'active', compatible: true };
  ui.banner('/a/project/with/a/long/path/'.repeat(4), '/private/runtime'); ui.session(session); ui.agents([agent]);
  ui.host({ readRoots: ['/a'], writeRoots: ['/a/project'], shell: true }); ui.status(session, [agent], 1, 2);
  ui.approval({ id: 'approval-fixture', sessionId: session.id, agentId: agent.id, state: 'pending', capability: 'host.execute', reason: 'Exact command approval', command: { text: 'echo fixture', cwd: '/a/project', fingerprint: 'fixture' } });
  assert.ok(output.includes('ROUNDTABLE')); assert.ok(output.includes('fixture  /  mock-model')); assert.ok(output.includes('Paused: Request limit'));
  assert.ok(output.includes('exact command approval')); assert.ok(output.includes('echo fixture')); assert.ok(output.includes('/approve approval-fixture'));
  assert.ok(!output.includes('\x1b'));
  for (const line of output.split('\n').filter(line => /^[╭│╰]/.test(line))) assert.equal(line.length, 64, line);
});

test('terminal output strips escape/control injections and keeps provider messages distinguishable', () => {
  const malicious = '\x1b[2Jhidden\x1b]0;spoof title\x07\u202ereversed\0';
  assert.equal(safeTerminalText(malicious), 'hiddenreversed');
  let output = ''; const ui = new TerminalUI({ write: (text: string) => { output += text; return true; } } as WriteStream, false, false);
  ui.message('Agent [provider/model]', 'Actual response', ['Other agent'], false);
  ui.tool('Agent [provider/model]', 'host_read', { ok: false, data: 'Permission denied' });
  assert.ok(output.includes('[message] Agent [provider/model] -> Other agent'));
  assert.ok(output.includes('"ok":false')); assert.ok(output.includes('Permission denied'));
});

test('background updates restore the editable prompt without clearing input', () => {
  let output = ''; const prompts: (boolean | undefined)[] = [];
  const input = { line: '/send partially typed', setPrompt: () => {}, prompt: (preserve?: boolean) => { prompts.push(preserve); }, getCursorPos: () => ({ rows: 0, cols: 20 }) } as unknown as Interface;
  const ui = new TerminalUI({ write: (text: string) => { output += text; return true; } } as WriteStream, true, false);
  ui.attach(input); ui.prompt(); ui.message('Agent [fixture/model]', 'Background response', [], false);
  assert.equal(prompts.at(-1), true); assert.equal(input.line, '/send partially typed'); assert.ok(output.includes('Background response'));
  ui.submitted(); ui.detach();
});
