import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeHostPolicy } from '../src/host-tools.js';
import { fixture } from './helpers.js';
import { proposeChanges, applyChanges, reviewChanges, settleChanges, createWorktree, reviewWorktree, mergeWorktree } from '../src/change-groups.js';

test('grouped changes preflight every file, capture checkpoints, and undo without clobbering later edits', async () => {
  const f = fixture(); try {
    const s = f.engine.session(); s.hostAccess = await normalizeHostPolicy({ readRoots: [s.workspace], writeRoots: [s.workspace], shell: false }); f.repo.put('session', s); await f.engine.pause();
    writeFileSync(join(s.workspace, 'one.txt'), 'before');
    const group = proposeChanges(f.engine, 'Two related edits', s.workspace, [{ path: 'one.txt', beforeHash: createHash('sha256').update('before').digest('hex'), content: 'after' }, { path: 'nested/two.txt', beforeHash: 'new', content: 'new content' }]);
    assert.match((await reviewChanges(f.engine, group.id)).join('\n'), /one.txt/);
    writeFileSync(join(s.workspace, 'one.txt'), 'intervening'); await assert.rejects(applyChanges(f.engine, group.id), /changed/); assert.equal(existsSync(join(s.workspace, 'nested/two.txt')), false);
    writeFileSync(join(s.workspace, 'one.txt'), 'before'); await applyChanges(f.engine, group.id); await settleChanges(f.engine, group.id, 'accept');
    writeFileSync(join(s.workspace, 'one.txt'), 'later'); await assert.rejects(settleChanges(f.engine, group.id, 'undo'), /changed/); assert.equal(readFileSync(join(s.workspace, 'nested/two.txt'), 'utf8'), 'new content');
    writeFileSync(join(s.workspace, 'one.txt'), 'after'); await settleChanges(f.engine, group.id, 'undo'); assert.equal(readFileSync(join(s.workspace, 'one.txt'), 'utf8'), 'before'); assert.equal(existsSync(join(s.workspace, 'nested/two.txt')), false);
  } finally { await f.close(); }
});
test('worktree merges bind the reviewed commits and leave the result uncommitted', async () => {
  const f = fixture(); try {
    const s = f.engine.session(); s.hostAccess = await normalizeHostPolicy({ readRoots: [s.workspace], writeRoots: [s.workspace], shell: false }); f.repo.put('session', s); await f.engine.pause();
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', `safe.directory=${cwd.replaceAll('\\', '/')}`, ...args], { cwd, encoding: 'utf8', windowsHide: true });
    git(s.workspace, 'init'); git(s.workspace, 'config', 'user.email', 'fixture@example.invalid'); git(s.workspace, 'config', 'user.name', 'Fixture'); writeFileSync(join(s.workspace, 'base.txt'), 'base'); git(s.workspace, 'add', '.'); git(s.workspace, 'commit', '-m', 'base');
    const worktree = await createWorktree(f.engine, 'sprint-fixture'); writeFileSync(join(worktree.path, 'result.txt'), 'verified'); git(worktree.path, 'add', '.'); git(worktree.path, 'commit', '-m', 'result');
    assert.match(await reviewWorktree(f.engine, worktree.id), /verified/); const before = git(s.workspace, 'rev-parse', 'HEAD'); await mergeWorktree(f.engine, worktree.id);
    assert.equal(git(s.workspace, 'rev-parse', 'HEAD'), before); assert.equal(readFileSync(join(s.workspace, 'result.txt'), 'utf8'), 'verified');
    git(s.workspace, 'merge', '--abort');
  } finally { await f.close(); }
});
