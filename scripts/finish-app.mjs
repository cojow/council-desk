// After electron-builder: sign the app locally (ad-hoc; Apple Silicon won't run
// unsigned code) and install it to ~/Applications/Council Desk.app. Run by `npm run dist`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = path.join(root, 'dist', 'mac-arm64', 'Council Desk.app');
const target = path.join(os.homedir(), 'Applications', 'Council Desk.app');

// Replacing the bundle under a running copy can crash it mid-session.
try {
  execFileSync('pgrep', ['-f', `${target}/Contents/MacOS/Council Desk$`], { stdio: 'ignore' });
  console.error('Council Desk is open. Quit it, then run: node scripts/finish-app.mjs');
  process.exit(1);
} catch {}

execFileSync('codesign', ['--force', '--deep', '--sign', '-', built], { stdio: 'inherit' });
execFileSync('codesign', ['--verify', '--deep', built], { stdio: 'inherit' });

// Copy next to the installed app first, then swap, so a failed copy never leaves you
// without one; if the swap fails, the old app is put back.
const staged = `${target}.new`;
const previous = `${target}.old`;
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.rmSync(staged, { recursive: true, force: true });
fs.rmSync(previous, { recursive: true, force: true });
execFileSync('ditto', [built, staged], { stdio: 'inherit' });
const hadPrevious = fs.existsSync(target);
if (hadPrevious) fs.renameSync(target, previous);
try {
  fs.renameSync(staged, target);
} catch (error) {
  if (hadPrevious) fs.renameSync(previous, target);
  throw error;
}
fs.rmSync(previous, { recursive: true, force: true });
console.log(`installed ${target}`);
