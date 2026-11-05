// The environment Claude Code runs in. Imported first by main.js and the smoke test so
// every SDK call and every spawned Claude process sees it. Your own settings are left as
// they are: CLAUDE_CONFIG_DIR, ANTHROPIC_API_KEY and the rest pass through unchanged.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

// Claude Code's config folder: CLAUDE_CONFIG_DIR if you set one, otherwise its default.
export const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
// Claude Code's global state file (trusted folders, connectors): inside a custom config
// folder, or next to the default one in your home folder.
export const GLOBAL_CONFIG_FILE = process.env.CLAUDE_CONFIG_DIR ? path.join(CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json');

// Apps opened from the Dock get a bare PATH (/usr/bin:/bin:...). Borrow the login
// shell's PATH so Claude's commands can find Homebrew, node, python, git, etc.
function loginShellPath() {
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    const out = execFileSync(shell, ['-ilc', 'printf "__PATH__%s__END__" "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = out.match(/__PATH__(.*)__END__/s);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

const shellPath = loginShellPath();
if (shellPath) process.env.PATH = shellPath;

// The Claude Code binary that ships with the Agent SDK.
const require = createRequire(import.meta.url);
export const CLAUDE_BIN = path.join(
  path.dirname(require.resolve('@anthropic-ai/claude-agent-sdk-darwin-arm64/package.json')),
  'claude',
);
