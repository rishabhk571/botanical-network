// Fetch the macOS share folder that GitHub built (.github/workflows/build-macos.yml)
// into dist/macos/. Works on any OS: the build is the only commit on the
// `mac-build` branch, so plain git with its saved GitHub login is all it needs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 30 });

try { git('fetch', '--quiet', 'origin', 'mac-build'); }
catch { fail('No Mac build to fetch yet. Check the "Build macOS app" run on the repository\'s Actions tab.'); }
console.log(`Fetched: ${git('log', '-1', '--format=%s, %cr', 'FETCH_HEAD').toString().trim()}`);

const out = join(ROOT, 'dist', 'macos');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const tar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
execFileSync(tar, ['-x', '-f', '-', '-C', out], { input: git('archive', '--format=tar', 'FETCH_HEAD') });

console.log('dist/macos/');
for (const f of readdirSync(out)) console.log(`  ${f}`);

function fail(msg) { console.error(msg); process.exit(1); }
