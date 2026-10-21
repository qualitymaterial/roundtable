import test from 'node:test';import assert from 'node:assert/strict';import {unifiedDiff} from '../src/diff.js';
test('empty insertion counts zero old lines',()=>{const d=unifiedDiff('x','','hello\n');assert.equal(d[2],'@@ -0,0 +1,1 @@');assert.deepEqual(d.slice(3),['+hello']);});
test('full deletion counts zero new lines',()=>{const d=unifiedDiff('x','hello\n','');assert.equal(d[2],'@@ -1,1 +0,0 @@');assert.deepEqual(d.slice(3),['-hello']);});
test('terminal newline is not a phantom line',()=>{const d=unifiedDiff('x','one\n','two\n');assert.equal(d[2],'@@ -1,1 +1,1 @@');assert.deepEqual(d.slice(3),['-one','+two']);});
test('identical inputs stay unchanged',()=>assert.deepEqual(unifiedDiff('x','same\n','same\n'),['x: unchanged']));
test('bounded preview remains bounded',()=>assert.ok(unifiedDiff('x','',Array.from({length:300},(_,i)=>String(i)).join('\n'),4).at(-1)!.includes('truncated')));

test('EOF-only changes remain visible',()=>{for(const [before,after] of [['same','same\n'],['same\n','same']] as const){const d=unifiedDiff('x',before,after);assert.equal(d[2],'@@ -1,1 +1,1 @@');assert.ok(d.includes('-same'));assert.ok(d.includes('+same'));assert.ok(d.includes('\\ No newline at end of file'));}});
