// Assemble a share-ready folder in dist/<target>/, plus a zip of it:
//   npm run package        this OS's app; run after `npm run build` (Windows)
//                          or `npm run build:mac` (macOS)
//   npm run package:web    the browser version (src/ as-is), on any OS, no build
// Each folder also gets every file in platforms/<target>/ except README.md
// (the recipient's READ ME FIRST.txt, the web launcher) and every place list.
// dist/<target>/ is rebuilt from scratch.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'src-tauri', 'target');
const { productName: name, version } = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const binName = readFileSync(join(ROOT, 'src-tauri', 'Cargo.toml'), 'utf8').match(/^name\s*=\s*"([^"]+)"/m)[1];

const TARGETS = {
  windows: { label: 'Windows', build: 'npm run build' },
  macos: { label: 'macOS', build: 'npm run build:mac' },
  web: { label: 'Web' },
};
const HOST = { win32: 'windows', darwin: 'macos' }[process.platform];
const id = process.argv[2] || HOST;
if (!TARGETS[id]) fail(`Nothing to package for "${id || process.platform}". Targets: ${Object.keys(TARGETS).join(', ')}.`);
if (id !== 'web' && id !== HOST) fail(`The ${TARGETS[id].label} app can only be built and packaged on ${TARGETS[id].label}.`);
const target = TARGETS[id];

// [source file or folder, name in the share folder]
function artifacts() {
  if (id === 'web') return [[join(ROOT, 'src'), 'app']];
  if (id === 'windows') {
    const setup = `${name}_${version}_x64-setup.exe`;
    return [
      [join(TARGET, 'release', 'bundle', 'nsis', setup), setup],
      [join(TARGET, 'release', `${binName}.exe`), `${name} ${version} portable.exe`],
    ];
  }
  // Prefer the universal build (Apple Silicon + Intel); a plain `npm run build` only makes this Mac's architecture.
  const universal = join(TARGET, 'universal-apple-darwin', 'release', 'bundle', 'dmg', `${name}_${version}_universal.dmg`);
  const native = join(TARGET, 'release', 'bundle', 'dmg', `${name}_${version}_${process.arch === 'arm64' ? 'aarch64' : 'x64'}.dmg`);
  if (!existsSync(universal) && existsSync(native)) {
    console.warn(`No universal build found, packaging ${basename(native)} (this architecture only). Run ${target.build} for both.`);
    return [[native, basename(native)]];
  }
  return [[universal, basename(universal)]];
}

// bsdtar ships with Windows 10+ and macOS; -a picks zip from the extension and
// writes forward-slash paths, so the archive unpacks correctly on either OS.
const tar = { win32: join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), darwin: '/usr/bin/tar' }[process.platform];
if (!tar) fail(`No zip tool configured for ${process.platform}.`);

const files = artifacts();
const missing = files.filter(([src]) => !existsSync(src)).map(([src]) => src);
if (missing.length) fail(`Build first with \`${target.build}\`. Missing:\n  ${missing.join('\n  ')}`);

const out = join(ROOT, 'dist', id);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'places'), { recursive: true });
for (const [src, dest] of files) cpSync(src, join(out, dest), { recursive: true });
const extras = join(ROOT, 'platforms', id);
for (const f of readdirSync(extras).filter(f => f !== 'README.md')) cpSync(join(extras, f), join(out, f), { recursive: true });
// Every importable list, flattened into places/ (the recipient's readme points there).
for (const dir of ['places', join('places', 'samples')]) {
  for (const f of readdirSync(join(ROOT, dir)).filter(f => f.endsWith('.json'))) cpSync(join(ROOT, dir, f), join(out, 'places', f));
}

const zip = `${name} ${version} ${target.label} (share).zip`;
execFileSync(tar, ['-a', '-c', '-f', zip, ...readdirSync(out)], { cwd: out, stdio: 'inherit' });

console.log(`dist/${id}/`);
for (const f of readdirSync(out)) console.log(`  ${f}`);

function fail(msg) { console.error(msg); process.exit(1); }
