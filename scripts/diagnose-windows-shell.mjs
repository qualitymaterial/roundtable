// Temporary CI diagnostic: print only fixed fixture output, timings and allowlisted OS paths.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const root = process.env.SystemRoot ?? 'C:\\Windows';
const shell = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|LANG|LC_ALL)$/i.test(key)));
const os = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(ProgramFiles|ProgramFiles\(x86\)|ProgramW6432|CommonProgramFiles|CommonProgramFiles\(x86\)|CommonProgramW6432|SystemDrive|COMPUTERNAME|USERNAME|USERDOMAIN|HOMEDRIVE|HOMEPATH)$/i.test(key)));
for (const [name, env] of [
  ['baseline', base],
  ['os-paths', {...base, ...os}],
  ['builtin-modules', {...base, PSModulePath: join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules')}],
  ['os-paths-and-builtin-modules', {...base, ...os, PSModulePath: join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules')}],
]) {
  const start = Date.now();
  const r = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "[Console]::WriteLine('process-ready'); Write-Output 'cmdlet-ready'; [Console]::WriteLine($env:PSModulePath)"], {env, windowsHide:true, encoding:'utf8', timeout:15000, stdio:['ignore','pipe','pipe']});
  console.log(JSON.stringify({name, elapsedMs:Date.now()-start, status:r.status, error:r.error?.message, stdout:r.stdout, stderr:r.stderr}));
}
