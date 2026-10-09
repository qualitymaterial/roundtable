import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupRuntime, restoreRuntime, cleanupRuntimeStage } from '../src/runtime-backup.js';
import { spawn } from 'node:child_process';
import { Repository } from '../src/storage.js';
import { Engine } from '../src/engine.js';
import type { SessionRecord } from '../src/domain.js';

test('encrypted runtime backup restores all sessions/private config while disabling execution and replay', () => {
  const root = mkdtempSync(join(tmpdir(), 'roundtable-runtime-')); const home = join(root, 'home'); mkdirSync(home);
  const repo = new Repository(join(home, 'roundtable.db')); const session = Engine.create(repo, join(home, 'workspaces'), 'Recover');
  repo.insertMessage({ id: 'message', sessionId: session.id, sender: 'human', recipients: ['agent'], type: 'human', body: 'pending', threadId: 'main', artifacts: [], timestamp: new Date().toISOString() });
  writeFileSync(join(home, 'auth.json'), '{"test":"PRIVATE_BACKUP_FIXTURE"}');
  writeFileSync(join(session.workspace, 'large.txt'), 'x'.repeat(8 * 1024 * 1024));
  const canonicalWorkspace = realpathSync.native(session.workspace);
  const checkpoint = { id: 'fixture-checkpoint', sessionId: session.id, scope: 'workspace', path: join(canonicalWorkspace, 'large.txt'), state: 'applied' }; repo.put('checkpoint', checkpoint);
  const group = { id: 'fixture-group', sessionId: session.id, root: canonicalWorkspace, state: 'applied' }; repo.put('changegroup', group);
  mkdirSync(join(home, 'sessions'));
  writeFileSync(join(home, 'sessions', 'fixture.jsonl'), JSON.stringify({ type: 'session', cwd: canonicalWorkspace, parentSession: 'old-parent' }) + '\n' + JSON.stringify({ type: 'message', content: 'preserved' }) + '\n');
  const archive = join(root, 'backup.rtb'); const password = 'local-test-passphrase';
  try {
    assert.throws(() => backupRuntime(home, archive, password), /Close every harness/);
    repo.close(); const backup = backupRuntime(home, archive, password); assert.ok(backup.bytes > 8 * 1024 * 1024);
    assert.ok(!readFileSync(archive, 'utf8').includes('PRIVATE_BACKUP_FIXTURE'));
    assert.throws(() => restoreRuntime(archive, join(root, 'wrong'), 'incorrect-passphrase'));
    assert.equal(existsSync(join(root, 'wrong')), false);
    assert.throws(() => restoreRuntime(archive, join(root, 'interrupted'), password, () => { throw new Error('interrupted staging'); }), /interrupted/);
    assert.equal(existsSync(join(root, 'interrupted')), false); assert.ok(!readdirSync(root).some(n => n.startsWith('.roundtable-restore-')));
    rmSync(home, { recursive: true, force: true }); // Aliases must survive loss of the original runtime.
    const target = join(root, 'restored'); restoreRuntime(archive, target, password);
    const restored = new Repository(join(target, 'roundtable.db'));
    try {
      const s = restored.get<SessionRecord>('session', session.id)!; assert.equal(s.state, 'paused'); assert.equal(s.workspace, join(target, 'workspaces', session.id)); assert.deepEqual(s.hostAccess?.writeRoots, []);
      assert.equal(restored.get<{ path: string }>('checkpoint', 'fixture-checkpoint')!.path, join(s.workspace, 'large.txt'));
      assert.equal(restored.get<{ root: string }>('changegroup', 'fixture-group')!.root, s.workspace);
      const history = readFileSync(join(target, 'sessions', 'fixture.jsonl'), 'utf8').trim().split('\n');
      assert.equal(JSON.parse(history[0]!).cwd, s.workspace); assert.equal(JSON.parse(history[0]!).parentSession, undefined); assert.equal(JSON.parse(history[1]!).content, 'preserved');
      assert.equal(restored.deliveries(session.id, ['failed']).length, 1); assert.equal(restored.deliveries(session.id).length, 0);
      assert.match(readFileSync(join(target, 'auth.json'), 'utf8'), /PRIVATE_BACKUP_FIXTURE/); assert.equal(readFileSync(join(s.workspace, 'large.txt')).length, 8 * 1024 * 1024);
    } finally { restored.close(); }
    assert.throws(() => restoreRuntime(archive, target, password), /new destination/);
  } finally { try { repo.close(); } catch { /* closed above */ } rmSync(root, { recursive: true, force: true }); }
});

test('real process interruption during restore cannot activate partial data and leaves an identifiable cleanable stage', { timeout: 20000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'roundtable-crash-')); const home = join(root, 'home'); mkdirSync(home);
  const repo = new Repository(join(home, 'roundtable.db')); Engine.create(repo, join(home, 'workspaces'), 'Crash recovery'); repo.close();
  const archive = join(root, 'backup.rtb'); const target = join(root, 'restored'); backupRuntime(home, archive, 'fixture-passphrase');
  const source = `import {restoreRuntime} from ${JSON.stringify(new URL('../src/runtime-backup.ts', import.meta.url).href)}; restoreRuntime(process.argv[1],process.argv[2],'fixture-passphrase',()=>{process.stdout.write('STAGING\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15000);});`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source, archive, target], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Restore did not reach staging')), 10000); child.stdout.once('data', () => { clearTimeout(timer); resolve(); }); child.once('error', reject); });
    child.kill(); await closed; assert.equal(existsSync(target), false);
    const stages = readdirSync(root).filter(n => n.startsWith('.roundtable-restore-')); assert.equal(stages.length, 1); cleanupRuntimeStage(join(root, stages[0]!));
    assert.ok(!readdirSync(root).some(n => n.startsWith('.roundtable-restore-'))); restoreRuntime(archive, target, 'fixture-passphrase'); assert.equal(existsSync(join(target, 'roundtable.db')), true);
  } finally { child.kill(); await closed; rmSync(root, { recursive: true, force: true }); }
});
