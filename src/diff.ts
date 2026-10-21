/** Bounded unified change block; preserves exact changed lines, with common context. */
export function unifiedDiff(path: string, before: string, after: string, limit = 160): string[] {
  const lines = (text: string): string[] => {
    if (text === '') return [];
    const result = text.split('\n');
    if (text.endsWith('\n')) result.pop();
    return result;
  };
  const a = lines(before), b = lines(after);
  const lastA = a.length > 0 && !before.endsWith('\n');
  const lastB = b.length > 0 && !after.endsWith('\n');
  // EOF-aware equality: lines match only when text and trailing-newline status agree,
  // so a final line without a newline is never mistaken for a terminated twin.
  const eq = (i: number, j: number): boolean => {
    if (a[i] !== b[j]) return false;
    return (lastA && i === a.length - 1) === (lastB && j === b.length - 1);
  };
  let start = 0, end = 0;
  while (start < a.length && start < b.length && eq(start, start)) start++;
  if (start === a.length && start === b.length) return [path + ': unchanged'];
  while (end < a.length - start && end < b.length - start &&
    eq(a.length - 1 - end, b.length - 1 - end)) end++;
  const from = Math.max(0, start - 3); const tail = Math.min(3, end);
  const oldRows = a.slice(start, a.length - end).flatMap((s, i) =>
    start + i === a.length - 1 && lastA ? ['-' + s, '\\ No newline at end of file'] : ['-' + s]);
  const newRows = b.slice(start, b.length - end).flatMap((s, i) =>
    start + i === b.length - 1 && lastB ? ['+' + s, '\\ No newline at end of file'] : ['+' + s]);
  const rows = [...a.slice(from, start).map(s => ' ' + s), ...oldRows, ...newRows,
    ...a.slice(a.length - end, a.length - end + tail).map(s => ' ' + s)];
  // The shared unterminated final line needs the marker only when it is actually
  // emitted as suffix context; with tail === min(3, end) that means tail === end.
  if (tail > 0 && lastA && tail === end) rows.push('\\ No newline at end of file');
  const oldCount = a.length - end + tail - from, newCount = b.length - end + tail - from;
  const oldStart = oldCount === 0 ? from : from + 1, newStart = newCount === 0 ? from : from + 1;
  return ['--- ' + path, '+++ ' + path, `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    ...rows.slice(0, limit), ...(rows.length > limit ? ['[Preview truncated; export the full proposal to inspect remaining content]'] : [])];
}
