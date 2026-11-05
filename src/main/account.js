// How Claude Code is authenticated, as reported by the bundled binary. The app reads this
// only; it doesn't sign in or out, and every method Claude Code supports keeps working.
import { execFile } from 'node:child_process';
import { CLAUDE_BIN } from './env.js';

// { loggedIn, authMethod, apiProvider, apiKeySource, configDirectory, ... } from
// `claude auth status` (JSON). It exits 1 when there's no way to authenticate, so the
// output is read either way.
export function getAccountStatus(env = process.env) {
  return new Promise((resolve) => {
    execFile(CLAUDE_BIN, ['auth', 'status', '--json'], { env, timeout: 15000 }, (_err, stdout) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ loggedIn: false, error: "Couldn't read Claude Code's authentication status" });
      }
    });
  });
}
