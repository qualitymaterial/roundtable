/** Bounded unified change block; preserves exact changed lines, with common context. */
export function unifiedDiff(path: string, before: string, after: string, limit = 160): string[] {
  const a = before.split('\n'), b = after.split('\n'); let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  if (start === a.length && start === b.length) return [path + ': unchanged'];
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const from = Math.max(0, start - 3); const tail = Math.min(3, end);
  const rows = [...a.slice(from, start).map(s => ' ' + s), ...a.slice(start, a.length - end).map(s => '-' + s), ...b.slice(start, b.length - end).map(s => '+' + s), ...a.slice(a.length - end, a.length - end + tail).map(s => ' ' + s)];
  return ['--- ' + path, '+++ ' + path, `@@ -${from + 1},${a.length - end + tail - from} +${from + 1},${b.length - end + tail - from} @@`, ...rows.slice(0, limit), ...(rows.length > limit ? ['[Preview truncated; export the full proposal to inspect remaining content]'] : [])];
}
