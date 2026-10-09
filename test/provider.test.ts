import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { ProviderRegistry } from '../src/providers.js';
import { PiAdapter } from '../src/pi-adapter.js';
import { fixture } from './helpers.js';
import { id } from '../src/domain.js';
test('two independent provider adapters pass live admission protocol and execute a Pi tool loop', async () => {
  let registry: ProviderRegistry;
  let rejectProbe = false;
  const f = fixture(async (a, engine) => PiAdapter.create(registry, a, engine));
  try {
    registry = await ProviderRegistry.create(f.home);
    for (const provider of ['fixture-provider-one', 'fixture-provider-two']) registry.runtime.registerProvider(provider, {
      baseUrl: 'http://127.0.0.1:1', api: 'openai-completions', apiKey: 'nonsecret-test-fixture',
      models: [{ id: 'tool-model', name: 'Fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      streamSimple: (model, context) => {
        const stream = createAssistantMessageEventStream();
        const lastUser = context.messages.findLastIndex(m => m.role === 'user'); const user = context.messages[lastUser];
        const text = user?.role === 'user' && typeof user.content === 'string' ? user.content : JSON.stringify(user);
        const result = context.messages.slice(lastUser + 1).find(m => m.role === 'toolResult');
        const response: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content: [], stopReason: 'toolUse', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        if (result?.role === 'toolResult') { response.stopReason = 'stop'; response.content = [{ type: 'text', text: result.content.filter(c => c.type === 'text').map(c => c.text).join('') }]; }
        else if (text.includes('Compatibility test.') && rejectProbe) { response.stopReason = 'stop'; response.content = [{ type: 'text', text: 'No tools' }]; }
        else if (text.includes('Compatibility test.')) response.content = [{ type: 'toolCall', id: id(), name: 'roundtable_probe', arguments: { nonce: text.match(/nonce ([a-f0-9-]{36})/)?.[1] ?? '' } }];
        else response.content = [{ type: 'toolCall', id: id(), name: 'roundtable_memory_write', arguments: { text: `Independent tool finding from ${provider}` } }];
        stream.push({ type: 'start', partial: response }); stream.push({ type: 'done', reason: response.stopReason === 'toolUse' ? 'toolUse' : 'stop', message: response }); return stream;
      },
    });
    const one = await f.engine.addAgent({ name: 'One', provider: 'fixture-provider-one', model: 'tool-model' });
    const two = await f.engine.addAgent({ name: 'Two', provider: 'fixture-provider-two', model: 'tool-model' });
    assert.equal(one.compatible, true); assert.equal(two.compatible, true);
    f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: ['*'], type: 'human', body: 'Record an independent finding using your own tools' });
    await f.engine.idle(); assert.equal(f.repo.list('note', f.session.id).length, 2);
    assert.equal(f.engine.session().providerRequests['fixture-provider-one'], 4);
    assert.equal(f.engine.session().providerRequests['fixture-provider-two'], 4);
    assert.equal(f.repo.deliveries(f.session.id, ['failed']).length, 0);
    rejectProbe = true;
    const beforeFailure = f.engine.session().usage.tokens;
    await assert.rejects(f.engine.addAgent({ name: 'Incompatible', provider: 'fixture-provider-one', model: 'tool-model' }), /Tool compatibility failed/);
    assert.equal(f.engine.session().usage.tokens, beforeFailure + 2, 'failed admission still records provider-reported usage');
    rejectProbe = false;
    const bounded = f.engine.session(); bounded.limits.tokens = bounded.usage.tokens + 1; f.repo.put('session', bounded);
    const beforeRequests = bounded.usage.requests;
    await assert.rejects(f.engine.addAgent({ name: 'Budgeted', provider: 'fixture-provider-one', model: 'tool-model' }), /Token budget reached/);
    assert.equal(f.engine.session().usage.requests, beforeRequests + 1, 'second probe must not run after the first reaches the token budget');
    assert.equal(f.engine.session().state, 'paused');
  } finally { await f.close(); }
});
