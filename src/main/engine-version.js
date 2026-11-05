// The Claude Code engine (the Agent SDK) bundled with this build, and an on-request check
// for a newer one on npm. Nothing is installed from here: updating means rebuilding from
// source (see the README).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PACKAGE = '@anthropic-ai/claude-agent-sdk';

const newer = (a, b) => {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
};

// appRoot: the app's own folder (the source folder when run from source).
export function createEngineVersion({ appRoot }) {
  let current = 'unknown';
  try {
    current = JSON.parse(fs.readFileSync(path.join(appRoot, 'node_modules', PACKAGE, 'package.json'), 'utf8')).version;
  } catch {}

  return {
    current: () => current,
    async check() {
      const latest = await new Promise((resolve) =>
        execFile('npm', ['view', PACKAGE, 'version'], { timeout: 20000 }, (error, stdout) => resolve(error ? null : stdout.trim())),
      );
      return { current, latest, available: Boolean(latest && newer(latest, current)) };
    },
  };
}
