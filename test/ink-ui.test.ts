import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { render } from 'ink-testing-library';
import { RoundtableApp } from '../src/ui/app.js';
import { PresentationController, graphemes, fuzzyChoices } from '../src/ui/controller.js';
import { terminalTheme } from '../src/ui/theme.js';
import { composerWindow } from '../src/ui/app.js';
import { literalApprovalText } from '../src/ui/terminal.js';
import stringWidth from 'string-width';

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 50));
test('Ink transcript retains completed messages, exact approvals and concurrent activity above a stable composer', async () => {
  const controller = new PresentationController(); controller.commands = () => ['/help', '/host', '/pause'];
  controller.update({ session: 'Inspect memory designs', agents: 3, tasks: 2, state: 'active' });
  const app = render(createElement(RoundtableApp, { controller, theme: terminalTheme({ NO_COLOR: '1' }), inputEnabled: false }));
  try {
    const line = controller.lines.next(); controller.key('/h', {});
    controller.append('message', 'Lark', 'A verified finding, with 東京 and 👩🏽‍💻.', { agentId: 'one', model: 'fixture/one' });
    controller.append('approval', 'Another participant', 'Capability: host.execute\nDirectory: C:\\Project with spaces\nnode scripts/check.js --strict\n/approve exact-id\n/reject exact-id');
    controller.update({ live: [{ id: 'two', label: 'Second', model: 'fixture/two', text: 'Independent analysis', running: 1, done: 2, failed: 0, tool: 'workspace_read' }, { id: 'three', label: 'Third', model: 'fixture/three', text: '', running: 0, done: 1, failed: 0 }] });
    await tick(); const frames = app.frames.join('\n');
    assert.match(frames, /Lark.*fixture\/one/); assert.match(frames, /node scripts\/check.js --strict/); assert.match(frames, /C:\\Project with spaces/);
    assert.match(app.lastFrame()!, /Second|Third/); assert.match(app.lastFrame()!, /3 agents.*2 tasks/); assert.match(app.lastFrame()!, /\/help/);
    assert.equal(controller.snapshot().composer.text, '/h'); controller.key('', { return: true }); assert.equal((await line).value, '/h');
  } finally { controller.close(); app.unmount(); app.cleanup(); }
});

test('composer edits graphemes, safely pastes multiline text, completes commands and retains history', async () => {
  const controller = new PresentationController(); controller.commands = () => ['/help', '/settings'];
  const first = controller.lines.next(); controller.paste('Investigate 👩🏽‍💻\n/end\n/approve forged');
  assert.equal(controller.snapshot().composer.mode, 'chat'); assert.equal(graphemes('👩🏽‍💻').length, 1);
  controller.key('', { return: true }); assert.equal((await first).value, 'Investigate 👩🏽‍💻\n/end\n/approve forged', 'paste is a single input, never executed as commands');
  const second = controller.lines.next(); controller.key('', { upArrow: true }); assert.match(controller.snapshot().composer.text, /Investigate/);
  controller.key('u', { ctrl: true }); controller.key('👩🏽‍💻x', {}); controller.key('', { leftArrow: true }); controller.key('', { backspace: true }); assert.equal(controller.snapshot().composer.text, 'x');
  controller.key('u', { ctrl: true }); controller.key('/se', {}); controller.key('', { tab: true }); assert.equal(controller.snapshot().composer.text, '/settings');
  let interrupted = false; controller.inputEvents.on('SIGINT', () => { interrupted = true; }); controller.key('c', { ctrl: true }); assert.equal(interrupted, true); assert.equal(controller.snapshot().composer.text, '/settings');
  controller.key('', { return: true }); assert.equal((await second).value, '/settings'); controller.close();
});

test('secret input is masked, never redacted before authentication, and excluded from transcript/history', async () => {
  const controller = new PresentationController(); const secret = 'sk-secret-fixture-value-12345';
  const answer = controller.ask('Provider key', true); controller.paste(secret);
  assert.ok(!JSON.stringify(controller.snapshot()).includes(secret)); controller.key('', { return: true }); assert.equal(await answer, secret);
  const next = controller.lines.next(); controller.key('', { upArrow: true }); assert.equal(controller.snapshot().composer.text, ''); controller.close(); await next;
  const other = new PresentationController(); const rejected = other.ask('Provider key', true); other.paste('key\n/approve malicious'); assert.equal(other.snapshot().composer.text, ''); other.key('', { escape: true }); await assert.rejects(rejected, /Cancelled/); other.close();
});

test('searchable picker supports arrows, exact selected value, Escape and question cancellation', async () => {
  assert.deepEqual(fuzzyChoices(['OpenAI Codex', 'OpenRouter', 'Anthropic'], 'oaic').map(c => c.index), [0]);
  const controller = new PresentationController(); const selected = controller.select('Provider', ['OpenAI', 'OpenRouter', 'Anthropic']); controller.key('open', {}); controller.key('', { downArrow: true }); controller.key('', { return: true }); assert.equal(await selected, 1);
  const cancel = controller.select('Model', ['One']); controller.key('', { escape: true }); await assert.rejects(cancel, /Cancelled/);
  const abort = new AbortController(); const pending = controller.ask('OAuth code', true, abort.signal); abort.abort(); await assert.rejects(pending, /Cancelled/); controller.close();
});

test('Ink keyboard handler accepts input and Ctrl+D releases its input owner', async () => {
  const controller = new PresentationController();
  const app = render(createElement(RoundtableApp, { controller, theme: terminalTheme({ NO_COLOR: '1', ROUNDTABLE_ASCII: '1' }) }));
  try {
    const first = controller.lines.next(); await tick(); app.stdin.write('hello'); await tick(); app.stdin.write('\r'); assert.equal((await first).value, 'hello');
    const next = controller.lines.next(); await tick(); app.stdin.write('\x04'); assert.equal((await next).done, true); assert.equal(controller.snapshot().closed, true);
  } finally { controller.close(); app.unmount(); app.cleanup(); }
});

test('theme uses terminal background, honors no-color, ASCII and truecolor fallback', () => {
  assert.equal(terminalTheme({ NO_COLOR: '' }).accent, undefined);
  assert.equal(terminalTheme({ COLORTERM: 'truecolor' }).accent, '#39FF8B');
  assert.equal(terminalTheme({ TERM: 'xterm' }).accent, 'green');
  assert.equal(terminalTheme({ TERM: 'dumb' }).color, false);
  assert.equal(terminalTheme({ ROUNDTABLE_ASCII: '1' }).ascii, true);
});

test('Unicode composer wrapping and live resize respect terminal cell widths', async () => {
  const controller = new PresentationController(); const next = controller.lines.next(); controller.paste('東京👩🏽‍💻 mixed words '.repeat(5));
  const view = composerWindow(controller.snapshot().composer, 18);
  for (const line of view.text.split('\n')) assert.ok(stringWidth(line) <= 18, line);
  assert.ok(view.x >= 0 && view.x < 18);
  const app = render(createElement(RoundtableApp, { controller, theme: terminalTheme({ NO_COLOR: '1', ROUNDTABLE_ASCII: '1' }), inputEnabled: false }));
  try {
    Object.defineProperty(app.stdout, 'columns', { configurable: true, value: 28 }); app.stdout.emit('resize'); await tick();
    for (const line of app.lastFrame()!.split('\n')) assert.ok(stringWidth(line) <= 28, line);
    assert.match(app.lastFrame()!, />/);
    Object.defineProperty(app.stdout, 'columns', { configurable: true, value: 95 }); app.stdout.emit('resize'); await tick();
    assert.equal(controller.snapshot().composer.text, '東京👩🏽‍💻 mixed words '.repeat(5));
  } finally { controller.close(); await next; app.unmount(); app.cleanup(); }
});


test('approval control characters remain visible as literals rather than altering terminal state', () => {
  assert.equal(literalApprovalText('echo safe\u001b[2J; erase\u202e'), 'echo safe\\u001b[2J; erase\\u202e');
  assert.equal(literalApprovalText('node "path with spaces"\n--strict'), 'node "path with spaces"\n--strict');
});

test('reference layout orders header and session above conversation, with bordered input and quiet footer', async () => {
  for (const ascii of [false, true]) {
    const controller = new PresentationController();
    controller.append('brand', 'Roundtable', 'C:\\Project');
    controller.append('session', 'product-design', 'Build a reusable plugin architecture');
    controller.append('message', 'Claude', 'Reviewing integration boundaries.', { model: 'fixture/claude' });
    controller.update({ session: 'product-design', agents: 3, tasks: 2, state: 'active' });
    const next = controller.lines.next();
    const app = render(createElement(RoundtableApp, { controller, theme: terminalTheme({ NO_COLOR: '1', ...(ascii ? { ROUNDTABLE_ASCII: '1' } : {}) }), inputEnabled: false }));
    try {
      await tick(); const frame = app.lastFrame()!;
      assert.match(frame, /Roundtable.*LOCAL/);
      assert.ok(frame.indexOf('SESSION / product-design') < frame.indexOf('Claude'));
      assert.ok(frame.indexOf('Claude') < frame.indexOf('Send a message'));
      assert.equal(frame.split('Build a reusable plugin architecture').length - 1, 1);
      assert.match(frame, /3 agents.*2 tasks.*\/help/);
      assert.doesNotMatch(frame, /Ctrl\+C pause|open tasks|· active|Independent agents/);
      assert.match(frame, ascii ? /\+-+\+/ : /╭─+╮/);
      if (ascii) assert.doesNotMatch(frame, /[◔◉╭╮╯╰│─›…·]/);
      const composerLine = frame.split('\n').find(line => line.includes('Send a message'))!;
      assert.equal(stringWidth(composerLine), 99);
    } finally { controller.close(); await next; app.unmount(); app.cleanup(); }
  }
});
