import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WriteStream } from 'node:tty';
import type { Interface } from 'node:readline/promises';
import { safeTerminalText, TerminalUI } from '../src/terminal-ui.js';
import { Limits, type SessionRecord, type AgentRecord } from '../src/domain.js';

test('stream previews keep agent labels separate and redact secrets split across chunks', () => {
  let output = ''; const ui = new TerminalUI({ write: (text: string) => { output += text; return true; } } as WriteStream, true, false, false, 'verbose');
  const previous = process.env.ROUNDTABLE_TEST_SECRET; process.env.ROUNDTABLE_TEST_SECRET = 'private-credential-1234567890';
  try {
    ui.stream('A', 'Finding\nprivate-cred'); ui.stream('B', 'Separate finding\n' + 'x'.repeat(150));
    ui.stream('A', 'ential-1234567890\n' + 'x'.repeat(150));
    assert.match(output, /Separate finding/); assert.match(output, /Finding/); assert.match(output, /REDACTED/);
    assert.doesNotMatch(output, /private-cred|ential-1234567890/);
  } finally { if (previous === undefined) delete process.env.ROUNDTABLE_TEST_SECRET; else process.env.ROUNDTABLE_TEST_SECRET = previous; }
});

test('terminal renderer shows identity, access, budgets and exact approval details at narrow widths', () => {
  let output = ''; const stream = { columns: 64, write: (text: string) => { output += text; return true; } } as WriteStream;
  const ui = new TerminalUI(stream, true, false, false);
  const session: SessionRecord = { id: 'session-fixture', objective: 'Terminal fixture only; no live model call', state: 'paused', reason: 'Request limit', createdAt: '', workspace: '/workspace', policy: 'goal', constraints: '', permissions: [], limits: Limits.parse({}), usage: { requests: 4, toolCalls: 2, tokens: 100, dollars: 0.1, exchanges: 3 }, providerRequests: {} };
  const agent: AgentRecord = { id: 'agent-fixture', sessionId: session.id, name: 'Example participant', provider: 'fixture', model: 'mock-model', instructions: '', permissions: ['collaborate'], state: 'active', compatible: true };
  ui.banner('/a/project/with/a/long/path/'.repeat(4), '/private/runtime'); ui.session(session); ui.agents([agent]);
  ui.host({ readRoots: ['/a'], writeRoots: ['/a/project'], shell: true }); ui.status(session, [agent], 1, 2);
  ui.settings(session.limits, true, '/private/runtime', session.limits);
  ui.approval({ id: 'approval-fixture', sessionId: session.id, agentId: agent.id, state: 'pending', capability: 'host.execute', reason: 'Exact command approval', command: { text: 'echo fixture', cwd: '/a/project', fingerprint: 'fixture' } });
  assert.ok(output.includes('ROUNDTABLE')); assert.ok(output.includes('fixture  /  mock-model')); assert.ok(output.includes('Paused: Request limit'));
  assert.ok(output.includes('exact command approval')); assert.ok(output.includes('echo fixture')); assert.ok(output.includes('/approve approval-fixture'));
  assert.ok(!output.includes('\x1b'));
  for (const line of output.split('\n').filter(line => /^[╭│╰]/.test(line))) assert.equal(line.length, 64, line);
});

test('budget pause is a recovery panel and disabled token limits render without errors', () => {
  let output = ''; const ui = new TerminalUI({ columns: 88, write: (text: string) => { output += text; return true; } } as WriteStream, true, false, false, 'verbose');
  ui.paused('Token budget reached: 511,204 / 500,000', 'Use /budget tokens off, then /resume.');
  assert.ok(output.includes('PAUSED / WORK SAVED')); assert.ok(output.includes('/budget tokens off')); assert.ok(!output.includes('ERROR'));
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

test('compact mode nests tool activity, suppresses payloads/peer chatter and prints final text once', () => {
  let output = ''; const ui = new TerminalUI({ columns: 88, write: (text: string) => { output += text; return true; } } as WriteStream, true, false);
  const label = 'Lark [fixture/model]';
  for (let i = 0; i < 20; i++) { ui.tool(label, 'host_read'); ui.tool(label, 'host_read', { ok: true, data: { content: 'raw-file-payload' } }); }
  ui.message(label, 'Internal peer evidence', ['Other'], false);
  ui.message(label, 'Let me read another file', [], false, true);
  ui.stream(label, 'Final finding\n' + 'x'.repeat(200)); ui.message(label, 'Final finding', [], false);
  assert.equal(output.match(/Working/g)?.length, 1); assert.equal(output.match(/Final finding/g)?.length, 1);
  assert.match(output, /ACTIVITY · 20 done · 0 running/); assert.match(output, /│ Lark · OK · host_read/);
  assert.doesNotMatch(output, /raw-file-payload|Internal peer evidence|Let me read|RUN  |· live/);
  assert.ok(output.split('\n').length < 18, output);
});

test('compact output bounds long replies and preserves actionable errors and approval commands', () => {
  let output = ''; const ui = new TerminalUI({ columns: 64, write: (text: string) => { output += text; return true; } } as WriteStream, true, false);
  ui.tool('A [test/model]', 'host_execute'); ui.tool('A [test/model]', 'host_execute', { ok: false, data: 'Permission denied\x1b[2J' });
  ui.approval({ id: 'approval-id', sessionId: 'session', agentId: 'a', capability: 'host.execute', reason: 'Exact command', state: 'pending', command: { text: 'echo example', cwd: '/project', fingerprint: 'test' } });
  ui.message('A [test/model]', Array.from({ length: 100 }, (_, i) => `Finding line ${i}`).join('\n'), [], false);
  assert.match(output, /Permission denied/); assert.match(output, /1 failed/); assert.match(output, /echo example/); assert.match(output, /\/approve approval-id/);
  assert.match(output, /Full response saved: \/messages/); assert.doesNotMatch(output, /Finding line 99|\x1b/);
  ui.setView('verbose'); ui.message('B', 'Peer discussion visible', ['A'], false); assert.match(output, /Peer discussion visible/);
});
