// Drives the session engine without the window: checks that Claude Code can authenticate,
// runs two short Haiku turns (one needing a file-write permission), and prints what came
// back. Exits 1 if anything didn't work. Each run makes a few small API calls, billed to
// whatever account Claude Code authenticates with (normally your ANTHROPIC_API_KEY).
// A key saved in the app's Settings isn't visible here; set ANTHROPIC_API_KEY instead.
import { CONFIG_DIR } from '../src/main/env.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAccountStatus } from '../src/main/account.js';
import { SessionManager } from '../src/main/sessions.js';

const account = await getAccountStatus();
if (!account.loggedIn) {
  console.error(
    'smoke test: Claude Code has no way to authenticate, so nothing was run.\n' +
      'Set ANTHROPIC_API_KEY (an Anthropic API key; usage is billed to your Console account) and try again:\n' +
      '  ANTHROPIC_API_KEY=... npm run smoke',
  );
  process.exit(1);
}
// How it authenticates, never the key itself.
console.log('auth:', account.authMethod, '|', account.apiKeySource || account.apiProvider || '', '| config:', CONFIG_DIR);

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'council-desk-smoke-'));
const key = 'smoke';
const seen = { text: '', tools: [], permissions: [], results: 0, errors: 0 };
let resolveTurn;
const timeout = setTimeout(() => {
  console.log('smoke test FAILED: no answer within 3 minutes');
  process.exit(1);
}, 3 * 60 * 1000);

// Not saved, so test runs don't fill the sidebar.
const manager = new SessionManager({
  persistSessions: false,
  emit(event) {
    if (event.type === 'session') console.log('session:', event.sessionId, '| model:', event.model, '| mode:', event.mode);
    if (event.type === 'permission') {
      seen.permissions.push(event.toolName);
      console.log('permission asked:', event.title || event.toolName, '→ allowing');
      manager.respond(key, event.id, { kind: 'allow' });
    }
    if (event.type === 'error') {
      seen.errors++;
      console.log('error:', event.message);
      resolveTurn?.();
    }
    if (event.type !== 'sdk') return;
    const msg = event.msg;
    if (msg.type === 'assistant') {
      for (const block of msg.message.content) {
        if (block.type === 'text') seen.text += block.text;
        if (block.type === 'tool_use') seen.tools.push(block.name);
      }
    }
    if (msg.type === 'result') {
      seen.results++;
      console.log(`turn ${seen.results}:`, msg.subtype, '| text so far:', JSON.stringify(seen.text.trim().slice(0, 120)));
      resolveTurn();
    }
  },
});

const turn = (text) =>
  new Promise((resolve) => {
    resolveTurn = resolve;
    manager.send({ key, cwd, model: 'haiku', text });
  });

await turn('Reply with exactly the word OK and nothing else.');
await turn('Use the Write tool to create notes.txt containing the line smoke-test-ran, then reply with just DONE.');
const written = fs.existsSync(path.join(cwd, 'notes.txt'));
console.log('file written:', written);

console.log('tools used:', seen.tools.join(', ') || 'none', '| permissions asked:', seen.permissions.join(', ') || 'none');
clearTimeout(timeout);
manager.closeAll();
fs.rmSync(cwd, { recursive: true, force: true });
// Claude Code also makes a project folder (with an empty memory folder) for the test's
// folder; remove it if it holds no files.
try {
  const projects = path.join(CONFIG_DIR, 'projects');
  for (const name of fs.readdirSync(projects).filter((n) => n.endsWith(`-${path.basename(cwd)}`))) {
    const dir = path.join(projects, name);
    if (!fs.readdirSync(dir, { recursive: true }).some((f) => fs.statSync(path.join(dir, f)).isFile())) fs.rmSync(dir, { recursive: true });
  }
} catch {}
const ok = seen.results === 2 && !seen.errors && written;
console.log(ok ? 'smoke test passed' : 'smoke test FAILED');
setTimeout(() => process.exit(ok ? 0 : 1), 500);
