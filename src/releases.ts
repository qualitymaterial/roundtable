import { readFileSync, readdirSync, realpathSync, writeFileSync, renameSync, mkdtempSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/** Switch only among already-installed local releases. No network download or data migration. */
export class WindowsReleases {
  private root: string;
  constructor(private current = dirname(dirname(fileURLToPath(import.meta.url)))) {
    if (basename(dirname(current)) !== 'releases') throw new Error('Use the standalone Windows installation for release management. From source, run install.cmd to install/update.');
    this.root = dirname(dirname(current));
  }
  list() {
    return readdirSync(join(this.root, 'releases'), { withFileTypes: true }).filter(e => e.isDirectory() && !e.isSymbolicLink()).flatMap(e => {
      try { const pkg = JSON.parse(readFileSync(join(this.root, 'releases', e.name, 'package.json'), 'utf8')); return [{ id: e.name, version: String(pkg.version), running: join(this.root, 'releases', e.name) === this.current }]; } catch { return []; }
    });
  }
  activate(releaseId: string): string {
    if (process.platform !== 'win32') throw new Error('Standalone release switching currently supports Windows.');
    if (!this.list().some(r => r.id === releaseId) || !/^[a-zA-Z0-9-]+$/.test(releaseId)) throw new Error('Unknown installed release; run roundtable releases.');
    const release = realpathSync(join(this.root, 'releases', releaseId));
    if (dirname(release) !== realpathSync(join(this.root, 'releases'))) throw new Error('Release must remain inside this installation.');
    const cli = realpathSync(join(release, 'dist', 'cli.js'));
    if (dirname(dirname(cli)) !== release) throw new Error('Release CLI escapes installation.');
    const checkHome = mkdtempSync(join(tmpdir(), 'roundtable-release-check-'));
    const check = spawnSync(process.execPath, [cli, 'doctor'], { encoding: 'utf8', timeout: 60000, windowsHide: true, env: { ...process.env, ROUNDTABLE_HOME: checkHome } });
    if (check.status !== 0) throw new Error(`Release validation failed; launcher was not changed. Diagnostics retained at ${checkHome}.`);
    const doctor = JSON.parse(check.stdout); if (doctor.sqlite !== 'connected') throw new Error('Release doctor did not confirm storage; launcher unchanged.');
    const launcher = join(this.root, 'bin', 'roundtable.cmd');
    const text = `@echo off\r\n"${process.execPath.replaceAll('%', '%%')}" "${cli.replaceAll('%', '%%')}" %*\r\nexit /b %errorlevel%\r\n`;
    writeFileSync(launcher + '.new', text, 'utf8'); renameSync(launcher + '.new', launcher);
    writeFileSync(join(this.root, 'installation.json'), JSON.stringify({ release, node: process.execPath, installedAt: new Date().toISOString(), launcher }, null, 2), 'utf8');
    return `Selected ${releaseId}. New invocations use this release; running sessions, credentials and project data were not changed. Older releases may not support newer data; keep a backup before downgrade.`;
  }
}
