import test from 'node:test';import assert from 'node:assert/strict';import{unifiedDiff}from'../src/diff.js';
test('bounded preview remains available',()=>{assert.ok(unifiedDiff('f.txt','a','b').length>=4);});

// Regression: shared unterminated suffix context needs the no-newline marker.
// Baseline failure: unifiedDiff('f.txt','old\nz','new\nz') produced rows
// ['-old','+new',' z'] with no '\ No newline at end of file' after ' z'.
test('shared unterminated suffix context emits no-newline marker',()=>{
  const d=unifiedDiff('f.txt','old\nz','new\nz').join('\n');
  assert.match(d,/ z\n\\ No newline at end of file/);
  assert.match(d,/-old\n\+new/);
});

// Regression: prepend before shared unterminated final line.
// Baseline failure: marker missing after suffix context ' z'.
test('prepend before unterminated final line emits marker after context',()=>{
  const d=unifiedDiff('f.txt','a\nz','b\na\nz').join('\n');
  assert.match(d,/ z\n\\ No newline at end of file/);
  assert.match(d,/\+b/);
});

// Regression: shared unterminated suffix longer than the 3-line context window.
// The final line 'e' is NOT among the emitted context rows, so no marker may
// appear (a marker after ' c' would mis-mark a terminated line and git apply
// would fail). Baseline failure: marker was emitted whenever tail>0 && lastA,
// regardless of whether the final line was actually shown.
test('long shared unterminated suffix omits marker when final line not shown',()=>{
  const d=unifiedDiff('f.txt','a\nb\nc\nd\ne','x\na\nb\nc\nd\ne');
  assert.match(d[2]!,/@@ -1,3 \+1,4 @@/);
  assert.deepEqual(d.slice(3),['+x',' a',' b',' c']);
  assert.equal(d[d.length-1],' c');
  assert.doesNotMatch(d.join('\n'),/No newline at end of file/);
});

// Regression: append after unterminated final line must not treat it as context.
// Baseline failure: 'b' was emitted as context ' b' but old 'b' has no newline
// while new 'b' does, making the patch unapplyable.
test('append after unterminated final line emits removal and addition',()=>{
  const d=unifiedDiff('f.txt','a\nb','a\nb\nc').join('\n');
  assert.match(d,/-b\n\\ No newline at end of file\n\+b\n\+c\n\\ No newline at end of file/);
  assert.doesNotMatch(d,/ b\n/);
});

// Regression: remove causing final line to lose newline must not treat it as context.
// Baseline failure: 'b' was emitted as context ' b' but new 'b' has no newline
// while old 'b' does, making the patch unapplyable.
// Note: before='a\nb\nc' has NO trailing newline, so '-c' also needs the marker.
test('remove causing final line to lose newline emits removal and addition',()=>{
  const d=unifiedDiff('f.txt','a\nb\nc','a\nb').join('\n');
  assert.match(d,/-b\n-c\n\\ No newline at end of file\n\+b\n\\ No newline at end of file/);
  assert.doesNotMatch(d,/ b\n/);
});

// Regression: both final lines changed without newline.
test('both final lines changed without newline emit markers',()=>{
  const d=unifiedDiff('f.txt','a\nb','c\nd').join('\n');
  assert.match(d,/-b\n\\ No newline at end of file/);
  assert.match(d,/\+d\n\\ No newline at end of file/);
});

// Preserve: empty file to content.
test('empty file to content',()=>{
  const d=unifiedDiff('f.txt','','a\nb').join('\n');
  assert.match(d,/@@ -0,0 \+1,2 @@/);
  assert.match(d,/\+a\n\+b/);
});

// Preserve: content to empty file.
test('content to empty file',()=>{
  const d=unifiedDiff('f.txt','a\nb','').join('\n');
  assert.match(d,/@@ -1,2 \+0,0 @@/);
  assert.match(d,/-a\n-b/);
});

// Preserve: unchanged files.
test('unchanged files',()=>{
  assert.deepEqual(unifiedDiff('f.txt','a\nb','a\nb'),['f.txt: unchanged']);
  assert.deepEqual(unifiedDiff('f.txt','',''),['f.txt: unchanged']);
});

// Preserve: EOF-only flip (gain newline).
test('EOF-only flip gain newline',()=>{
  const d=unifiedDiff('f.txt','a\nb','a\nb\n').join('\n');
  assert.match(d,/-b\n\\ No newline at end of file\n\+b/);
});

// Preserve: EOF-only flip (lose newline).
test('EOF-only flip lose newline',()=>{
  const d=unifiedDiff('f.txt','a\nb\n','a\nb').join('\n');
  assert.match(d,/-b\n\+b\n\\ No newline at end of file/);
});

// Preserve: hunk header counts for small complete previews.
test('hunk header counts are correct',()=>{
  const d=unifiedDiff('f.txt','a\nb\nc','a\nx\nc').join('\n');
  assert.match(d,/@@ -1,3 \+1,3 @@/);
});

// Preserve: bounded preview truncation with sentinel.
// Total lines = 3 headers + up to limit rows + 1 sentinel = limit + 4.
test('bounded preview truncation',()=>{
  const before=Array.from({length:20},(_,i)=>'line'+i).join('\n');
  const after=Array.from({length:20},(_,i)=>'LINE'+i).join('\n');
  const d=unifiedDiff('f.txt',before,after,10);
  assert.ok(d.length<=14);
  assert.match(d[d.length-1]!,/\[Preview truncated/);
});
