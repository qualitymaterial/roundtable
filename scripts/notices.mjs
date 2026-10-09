import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const inventory = [];
const notices = [];
function readNotices(root, subpath = '', depth = 0) {
  const found = [];
  for (const entry of readdirSync(join(root, subpath), { withFileTypes: true })) {
    if (depth === 0 && !/^(licen[sc]e|copying|notice|copyright|authors)([._-]|s$|$)/i.test(entry.name)) continue;
    const path = join(subpath, entry.name);
    if (entry.isDirectory() && depth < 3) found.push(...readNotices(root, path, depth + 1));
    else if (entry.isFile()) found.push({ path, text: readFileSync(join(root, path), 'utf8') });
  }
  return found;
}
for (const [path, metadata] of Object.entries(lock.packages)) {
  if (!path || !existsSync(join(path, 'package.json'))) continue;
  const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  const files = readNotices(path);
  inventory.push({ name: pkg.name, version: pkg.version, license: pkg.license ?? metadata.license ?? 'UNKNOWN', development: Boolean(metadata.dev), path, notices: files.map(f => f.path) });
  if (files.length) notices.push(`## ${pkg.name}@${pkg.version}\n\nLicense: ${pkg.license ?? metadata.license ?? 'UNKNOWN'}\n\n${files.map(f => `### ${f.path}\n\n\`\`\`text\n${f.text.replaceAll('```', "'''")}\n\`\`\``).join('\n\n')}`);
}
inventory.sort((a, b) => a.name.localeCompare(b.name));
mkdirSync('docs', { recursive: true });
writeFileSync('docs/DEPENDENCIES.json', JSON.stringify(inventory, null, 2) + '\n');
const piLicense = readFileSync('LICENSE', 'utf8').replace('Copyright (c) 2026 Roundtable contributors', 'Copyright (c) 2025 Mario Zechner');
writeFileSync('THIRD_PARTY_NOTICES.md', `# Third-party notices\n\nGenerated from the installed package-lock.json tree by scripts/notices.mjs. See docs/DEPENDENCIES.json for package versions, licenses, development classification and source notice paths. This inventory is platform-specific; regenerate on each distribution target. Dependencies remain separately licensed. Keep their original license/notice files when distributing them. Bundled inline notices remain in the dependency files. This report is not legal advice or proof of complete licensing compliance.\n\nPi packages are MIT licensed. Some npm Pi packages omit their top-level LICENSE; the pinned upstream [Pi v1.1.0 license](https://github.com/earendil-works/pi/blob/v1.1.0/LICENSE) is preserved here:\n\n\`\`\`text\n${piLicense}\`\`\`\n\n${notices.join('\n\n')}\n`);
console.log(`Preserved notices for ${inventory.length} installed packages; license identifiers: ${[...new Set(inventory.map(p => p.license))].join(', ')}`);
if (inventory.some(p => p.license === 'UNKNOWN')) process.exitCode = 1;
