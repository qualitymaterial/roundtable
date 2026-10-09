import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { id, redact } from './domain.js';
import { sensitiveHostPath } from './host-tools.js';

function projectPath(root: string, path: string): string {
  const base = realpathSync(root); const target = realpathSync(resolve(base, path)); const rel = relative(base, target);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel) || sensitiveHostPath(path) || sensitiveHostPath(target)) throw new Error('File mentions must stay inside the project and exclude private credential paths. Use /attach for an explicitly selected external file.');
  return target;
}
/** Complete only the directory explicitly typed by the human; never crawl the machine. */
export function completeFileMention(line: string, root: string): [string[], string] {
  const match = /(?:^|\s)@(?:"([^"\r\n]*)|([^\s"]*))$/.exec(line);
  if (!match) return [[], line];
  const typed = (match[1] ?? match[2] ?? '').replace(/\\/g, '/'); const slash = typed.lastIndexOf('/');
  const directory = slash < 0 ? '' : typed.slice(0, slash + 1); const prefix = typed.slice(slash + 1);
  const start = match.index + match[0].indexOf('@');
  try {
    const folder = projectPath(root, directory || '.');
    const matches = readdirSync(folder, { withFileTypes: true }).filter(e => !e.isSymbolicLink() && !e.name.startsWith('.') && !sensitiveHostPath(e.name) && e.name.toLowerCase().startsWith(prefix.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100).map(entry => {
      const path = `${directory}${entry.name}${entry.isDirectory() ? '/' : ''}`;
      return line.slice(0, start) + `@${path.includes(' ') || match[1] !== undefined ? `"${path}${entry.isDirectory() ? '' : '"'}` : path}`;
    });
    return [matches, line];
  } catch { return [[], line]; }
}
export function mentionedFiles(body: string, root: string): string[] {
  const paths = [...body.matchAll(/(?:^|\s)@(?:"([^"\r\n]+)"|([^\s"]+))/g)].map(m => projectPath(root, m[1] ?? m[2]!));
  const unique = [...new Set(paths)]; if (unique.length > 16) throw new Error('Attach at most 16 files per message');
  return unique;
}
export type Editor = { executable: string; args: string[] };
/** Human-configured editor only. No shell, project hooks or environment command parsing. */
export async function editDraft(home: string, body: string, editor: Editor, inherit = true): Promise<{ body: string; exitCode: number | null; recoveryPath?: string }> {
  const directory = join(home, 'drafts'); mkdirSync(directory, { recursive: true });
  const file = join(directory, `${id()}.txt`); writeFileSync(file, body, { flag: 'wx', mode: 0o600 });
  try {
    const exitCode = await new Promise<number | null>((done, reject) => {
      const child = spawn(editor.executable, [...editor.args, file], { shell: false, stdio: inherit ? 'inherit' : 'ignore', windowsHide: !inherit });
      child.once('error', reject); child.once('exit', code => done(code));
    });
    const info = lstatSync(file); if (!info.isFile() || info.isSymbolicLink() || info.size > 96000) throw new Error('Editor draft must remain a regular UTF-8 file up to 24,000 characters');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file));
    if (text.length > 24000 || text.includes('\0')) throw new Error('Draft exceeds 24,000 characters or contains binary data');
    // GUI launchers may return before their editor window closes. Preserve unchanged files
    // and failed-editor output so a late save cannot be silently deleted.
    if (text === body || exitCode !== 0) return { body: redact(text), exitCode, recoveryPath: file };
    unlinkSync(file); return { body: redact(text), exitCode };
  } catch (error) { throw new Error(`Editor failed: ${String(error)}. Original saved draft is retained. Recovery file: ${file}`); }
}
