import { mkdirSync, lstatSync, chmodSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export function browserPrivateDirectory(home: string): string {
  const directory = join(realpathSync(home), 'browser-private');
  try { mkdirSync(directory, { recursive: false, mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  secureBrowserDirectory(directory); return directory;
}
export function secureBrowserDirectory(directory: string): void {
  const st = lstatSync(directory);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Browser private directory must be a real directory');
  if (process.platform === 'win32') {
    const target = directory.replaceAll("'", "''");
    const command = `$acl = New-Object System.Security.AccessControl.DirectorySecurity; $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); foreach ($id in @($sid, (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')))) { $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule) }; [System.IO.Directory]::SetAccessControl('${target}',$acl)`;
    execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    if (st.uid !== process.getuid?.()) throw new Error('Browser private directory has another owner');
    chmodSync(directory, 0o700);
  }
}
