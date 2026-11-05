// Folder trust: Claude starts in a folder only after you've said you trust it, like the
// "Do you trust the files in this folder?" question in the terminal. A project's own
// settings (.claude/settings.json, often committed with the repo) can run commands by
// themselves (hooks) and pre-approve tools, and sessions run through the SDK never ask, so
// the app asks instead. Trusting a folder covers the folders inside it. Folders trusted in
// the terminal (Claude Code's own list in its .claude.json) count too.
import fs from 'node:fs';
import path from 'node:path';

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

// The real folder behind a path, so a link inside a trusted folder can't lead to an untrusted one.
const real = (folder) => {
  try {
    return fs.realpathSync(folder);
  } catch {
    return path.resolve(folder);
  }
};

// globalConfigFile: Claude Code's .claude.json (see env.js).
export function createTrust({ store, globalConfigFile }) {
  const cliFile = globalConfigFile;
  let cli = { mtimeMs: -1, folders: new Set() };

  // Claude Code's own trusted folders, re-read only when its file changes (it can be large).
  function cliTrusted() {
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(cliFile).mtimeMs;
    } catch {}
    if (mtimeMs !== cli.mtimeMs) {
      const projects = readJson(cliFile)?.projects || {};
      cli = { mtimeMs, folders: new Set(Object.keys(projects).filter((p) => projects[p]?.hasTrustDialogAccepted)) };
    }
    return cli.folders;
  }

  function isTrusted(cwd) {
    if (!cwd) return false;
    // Trust was given to the real folder at the time, so these stay as stored: replacing a
    // trusted folder with a link doesn't carry the trust to wherever the link leads.
    const own = new Set(store.get().trustedFolders || []);
    const terminal = cliTrusted();
    for (let dir = real(cwd); ; dir = path.dirname(dir)) {
      if (own.has(dir) || terminal.has(dir)) return true;
      if (dir === path.dirname(dir)) return false;
    }
  }

  function trust(cwd) {
    if (!cwd || !fs.existsSync(cwd)) throw new Error('Pick a folder that exists.');
    const folders = new Set(store.get().trustedFolders || []);
    folders.add(real(cwd));
    store.set({ trustedFolders: [...folders] });
    return true;
  }

  // What the folder's own settings would do once trusted, for the question.
  function details(cwd) {
    const hooks = [];
    const allowed = [];
    for (const name of ['settings.json', 'settings.local.json']) {
      const settings = readJson(path.join(cwd, '.claude', name));
      const file = `.claude/${name}`;
      for (const [event, groups] of Object.entries(settings?.hooks || {})) {
        for (const group of Array.isArray(groups) ? groups : []) {
          for (const hook of group?.hooks || []) if (hook?.command) hooks.push({ event, command: String(hook.command).slice(0, 300), file });
        }
      }
      for (const rule of settings?.permissions?.allow || []) allowed.push({ rule: String(rule), file });
    }
    const servers = Object.keys(readJson(path.join(cwd, '.mcp.json'))?.mcpServers || {});
    return { hooks, allowed, servers };
  }

  // The first time this version runs, folders you've already used start out trusted, so
  // nothing asks again about them.
  function adopt(folders) {
    if (store.get().trustedFolders) return;
    store.set({ trustedFolders: [...new Set(folders.filter(Boolean).map(real))] });
  }

  return { isTrusted, trust, details, adopt };
}
