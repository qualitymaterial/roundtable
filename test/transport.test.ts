import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { z } from 'zod';
import type { Context, AssistantMessage } from '@earendil-works/pi-ai';
import { Engine } from '../src/engine.js';
import { Repository } from '../src/storage.js';
import { ProviderRegistry } from '../src/providers.js';
import { PiAdapter } from '../src/pi-adapter.js';
import { demoObjective, mockStream } from '../src/demo.js';
import { verifyCollaboration } from '../src/acceptance.js';
import type { Task } from '../src/domain.js';

// A scripted HTTP server, not an inference server. Pi's production transport,
// authentication header, SSE decoder and tool-result serialization remain real.
test('three configured HTTP providers pass admission and collaborate through Pi production transport', async () => {
  const home = mkdtempSync(join(tmpdir(), 'roundtable-http-models-'));
  const counts = new Map<string, number>(); const errors: string[] = [];
  let registry: ProviderRegistry;
  const server = createServer(async (request, response) => {
    try {
      let body = ''; for await (const chunk of request) { body += String(chunk); if (body.length > 1000000) throw new Error('Oversize fixture request'); }
      const input = z.object({ model: z.enum(['alpha', 'beta', 'gamma']), messages: z.array(z.object({ role: z.string(), content: z.unknown().optional(), tool_call_id: z.string().optional() })) }).parse(JSON.parse(body));
      assert.equal(request.url, '/v1/chat/completions'); assert.equal(request.headers.authorization, 'Bearer fixture-http-not-a-secret');
      counts.set(input.model, (counts.get(input.model) ?? 0) + 1);
      const textContent = (value: unknown) => typeof value === 'string' ? value : z.array(z.object({ type: z.literal('text'), text: z.string() })).parse(value).map(block => block.text).join('');
      const context: Context = { messages: input.messages.flatMap((message): Context['messages'] => {
        if (message.role === 'user') return [{ role: 'user', content: textContent(message.content), timestamp: Date.now() }];
        if (message.role === 'tool') return [{ role: 'toolResult', toolCallId: message.tool_call_id!, toolName: 'fixture', content: [{ type: 'text', text: textContent(message.content) }], isError: false, timestamp: Date.now() }];
        return [];
      }) };
      const latestUser = context.messages.findLastIndex(m => m.role === 'user');
      const user = context.messages[latestUser]; const text = user?.role === 'user' ? String(user.content) : '';
      let content: AssistantMessage['content'];
      if (text.startsWith('Compatibility test.')) {
        const result = context.messages.slice(latestUser + 1).find(m => m.role === 'toolResult');
        content = result?.role === 'toolResult' ? result.content.filter(c => c.type === 'text') : [{ type: 'toolCall', id: 'probe-call', name: 'roundtable_probe', arguments: { nonce: text.match(/nonce ([a-f0-9-]{36})/)?.[1] ?? '' } }];
      } else if (text.includes('CLI greeting: hello')) {
        content = [{ type: 'text', text: 'CLI provider received hello' }];
      } else {
        const model = registry.model(`http-${input.model}`, input.model);
        const scripted = await mockStream(model, context).result();
        if (scripted.stopReason === 'error') throw new Error(scripted.errorMessage);
        content = scripted.content;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const chunk = (delta: unknown, finishReason: string | null = null) => response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: input.model, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
      chunk({ role: 'assistant' });
      let index = 0;
      for (const block of content) {
        if (block.type === 'text') chunk({ content: block.text });
        if (block.type === 'toolCall') chunk({ tool_calls: [{ index: index++, id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.arguments) } }] });
      }
      chunk({}, index ? 'tool_calls' : 'stop');
      response.write(`data: ${JSON.stringify({ id: 'fixture', choices: [], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`);
      response.end('data: [DONE]\n\n');
    } catch (error) { errors.push(String(error)); response.writeHead(500); response.end(JSON.stringify({ error: { message: String(error) } })); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const previous = process.env.ROUNDTABLE_HTTP_FIXTURE_KEY; process.env.ROUNDTABLE_HTTP_FIXTURE_KEY = 'fixture-http-not-a-secret';
  const repo = new Repository(join(home, 'test.db')); let engine: Engine | undefined;
  try {
    writeFileSync(join(home, 'endpoints.json'), JSON.stringify(['alpha', 'beta', 'gamma'].map(model => ({ provider: `http-${model}`, baseUrl: `http://127.0.0.1:${address.port}/v1`, model, apiKeyEnv: 'ROUNDTABLE_HTTP_FIXTURE_KEY', contextWindow: 100000 }))));
    registry = await ProviderRegistry.create(home);
    const configs = ['alpha', 'beta', 'gamma'].map(model => ({ name: model, provider: `http-${model}`, model }));
    assert.equal(registry.preflight(configs).ready, true);
    const configPath = join(home, 'agents.json'); writeFileSync(configPath, JSON.stringify(configs));
    const preflight = spawnSync(process.execPath, [resolve('dist/cli.js'), 'demo', '--live', configPath, '--check'], { encoding: 'utf8', env: { ...process.env, ROUNDTABLE_HOME: home }, timeout: 60000 });
    assert.equal(preflight.status, 0, preflight.stdout + preflight.stderr);
    assert.equal(JSON.parse(preflight.stdout).ready, true); assert.equal(counts.size, 0);
    const preflightRepo = new Repository(join(home, 'roundtable.db'));
    try { assert.equal(preflightRepo.list('session').length, 0); } finally { preflightRepo.close(); }
    const session = Engine.create(repo, join(home, 'workspaces'), demoObjective);
    engine = new Engine(repo, session.id, PiAdapter.factory(registry));
    const alpha = await engine.addAgent(configs[0]!); await engine.addAgent(configs[1]!); const gamma = await engine.addAgent(configs[2]!);
    engine.send({ sessionId: session.id, sender: 'human', recipients: [alpha.id], type: 'human', body: demoObjective }); await engine.idle();
    const task = repo.list<Task>('task', session.id)[0]; assert.ok(task, JSON.stringify({ errors, deliveries: repo.deliveries(session.id, ['failed']) }));
    engine.send({ sessionId: session.id, sender: 'human', recipients: [gamma.id], type: 'human', body: 'Contribute an independent artifact using the shared findings.', taskId: task.id, correlationId: alpha.id }); await engine.idle();
    const report = verifyCollaboration(repo, session.id, home); assert.equal(report.passed, true, JSON.stringify(report));
    assert.equal(report.distinctProviders, 3); assert.equal(report.successfulToolUsers, 3);
    assert.deepEqual(errors, []);
    for (const model of ['alpha', 'beta', 'gamma']) assert.ok((counts.get(model) ?? 0) >= 4);
    // Exercise npm start's no-argument entrypoint, including queued input across
    // objective entry and admission. Keep stdin open until the model responds.
    writeFileSync(join(home, 'agents.json'), JSON.stringify([configs[0]]));
    const child = spawn(process.execPath, [resolve('dist/cli.js')], { env: { ...process.env, ROUNDTABLE_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let errorsOutput = ''; let replied = false;
    child.stderr.on('data', data => { errorsOutput += String(data); });
    child.stdout.on('data', data => {
      output += String(data);
      if (!replied && output.includes('CLI provider received hello')) { replied = true; child.stdin.end('/save-agents\n/exit\n'); }
    });
    child.stdin.write('CLI startup objective\nCLI greeting: hello\n');
    const timer = setTimeout(() => child.kill(), 60000);
    const code = await new Promise<number | null>((resolveExit, reject) => { child.once('error', reject); child.once('close', resolveExit); }).finally(() => clearTimeout(timer));
    assert.equal(code, 0, output + errorsOutput); assert.equal(replied, true, output + errorsOutput);
    assert.ok(output.includes('[connected] alpha [http-alpha/alpha]')); assert.ok(output.includes('1 agents ready'));
    const cliRepo = new Repository(join(home, 'roundtable.db'));
    try {
      const session = cliRepo.list<{ id: string; objective: string }>('session').find(s => s.objective === 'CLI startup objective'); assert.ok(session);
      assert.equal(cliRepo.list('agent', session.id).length, 1);
      assert.equal(cliRepo.deliveries(session.id, ['acknowledged']).length, 1);
      assert.ok(cliRepo.messages(session.id).some(m => m.body === 'CLI provider received hello' && m.sender !== 'human'));
    } finally { cliRepo.close(); }
  } finally {
    await engine?.close(); repo.close();
    if (previous === undefined) delete process.env.ROUNDTABLE_HTTP_FIXTURE_KEY; else process.env.ROUNDTABLE_HTTP_FIXTURE_KEY = previous;
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  }
});
