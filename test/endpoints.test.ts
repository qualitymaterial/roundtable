import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { ProviderRegistry } from '../src/providers.js';
import { endpointMenu } from '../src/connection-ui.js';

test('custom endpoints support multiple models, edits and removal across restart without touching built-ins', async () => {
  const f = fixture();
  try {
    const registry = await ProviderRegistry.create(f.home);
    registry.addEndpoint({ provider: 'multi-local', baseUrl: 'http://127.0.0.1:1234/v1', model: 'first', models: [{ id: 'second', images: true, contextWindow: 8192, maxTokens: 2048 }] });
    assert.deepEqual(registry.models('multi-local').map(m => m.id).sort(), ['first', 'second']);
    assert.deepEqual(registry.model('multi-local', 'second').input, ['text', 'image']);
    assert.throws(() => registry.replaceEndpoint('multi-local', { ...registry.endpoints()[0], models: [{ id: 'first' }] }), /unique/);
    assert.throws(() => registry.removeEndpoint('anthropic'), /custom/);
    registry.replaceEndpoint('multi-local', { ...registry.endpoints()[0], baseUrl: 'http://127.0.0.1:4321/v1', models: [] });
    assert.equal(registry.model('multi-local', 'first').baseUrl, 'http://127.0.0.1:4321/v1');
    assert.throws(() => registry.model('multi-local', 'second'), /Unknown/);
    const reopened = await ProviderRegistry.create(f.home); assert.equal(reopened.models('multi-local').length, 1);
    reopened.removeEndpoint('multi-local'); assert.equal(reopened.models('multi-local').length, 0);
    const final = await ProviderRegistry.create(f.home); assert.equal(final.endpoints().length, 0); assert.ok(final.models('anthropic').length > 0);
  } finally { await f.close(); }
});

test('endpoint menu previews readable changes, declines safely, and disconnects before applying', async () => {
  const f = fixture();
  try {
    const registry = await ProviderRegistry.create(f.home); registry.addEndpoint({ provider: 'menu-local', baseUrl: 'http://127.0.0.1:1234/v1', model: 'original' });
    const output: string[] = []; let answers = ['2', '2', 'additional', '8192', '2048', 'y', 'n']; let disconnected = 0;
    const io = { print: (value: unknown) => output.push(String(value)), ask: async (label: string) => { assert.ok(answers.length, label); return answers.shift()!; } };
    const disconnect = async () => { disconnected++; assert.equal(registry.models('menu-local').length, 1); };
    await endpointMenu(registry, io, disconnect); assert.equal(disconnected, 0); assert.equal(registry.models('menu-local').length, 1);
    answers = ['2', '2', 'additional', '8192', '2048', 'y', 'y']; await endpointMenu(registry, io, disconnect);
    assert.equal(disconnected, 1); assert.equal(registry.models('menu-local').length, 2);
    assert.match(output.join('\n'), /context 8192/); assert.doesNotMatch(output.join('\n'), /"baseUrl"|"contextWindow"/);
    answers = ['2', '4', '1', 'y']; await endpointMenu(registry, io);
    assert.deepEqual(registry.models('menu-local').map(m => m.id), ['additional']);
  } finally { await f.close(); }
});
