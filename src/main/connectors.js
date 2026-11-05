// Connectors (MCP servers): extra tools Claude can use. Everything goes through Claude
// Code's own `claude mcp` commands, so the app writes exactly what the terminal would.
// They can be for all projects, one project, or shared in .mcp.json.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const STATES = { '✔': 'connected', '✓': 'connected', '✗': 'failed', '✘': 'failed', '×': 'failed', '!': 'needs-auth', '⏸': 'pending' };
const shorten = (text) => (text.length > 140 ? `${text.slice(0, 139)}…` : text);
const SCOPES = ['user', 'local', 'project'];

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

// Shared connectors from a project's .mcp.json (in the folder or a parent) that you haven't
// approved. Claude Code's terminal asks before using these, but sessions run through the
// SDK would start them without asking, so the app passes these to each session as disabled.
// Approvals count only from outside the repo: Claude Code's user settings.json, and the
// app's own record (Approve), which is tied to the real folder and to the server's exact
// configuration, so changing a server's command asks again. Anything inside the project,
// settings.local.json included, could have come with the repo.
const fingerprint = (config) => createHash('sha256').update(JSON.stringify(config ?? null)).digest('hex');
const realFolder = (folder) => {
  try {
    return fs.realpathSync(folder);
  } catch {
    return path.resolve(folder);
  }
};

function projectServers(cwd) {
  const servers = new Map(); // the nearest .mcp.json wins
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    for (const [name, config] of Object.entries(readJson(path.join(dir, '.mcp.json'))?.mcpServers || {})) if (!servers.has(name)) servers.set(name, config);
    if (dir === path.dirname(dir)) return servers;
  }
}

// approvals: { folder: { serverName: fingerprint } }, from the app's settings.
export function unapprovedProjectServers(cwd, configDir, approvals = {}) {
  if (!cwd) return [];
  const servers = projectServers(cwd);
  if (!servers.size) return [];
  const settings = readJson(path.join(configDir, 'settings.json'));
  if (settings?.enableAllProjectMcpServers === true) return [];
  const approved = new Set(settings?.enabledMcpjsonServers || []);
  const here = approvals[realFolder(cwd)] || {};
  return [...servers].filter(([name, config]) => !approved.has(name) && here[name] !== fingerprint(config)).map(([name]) => name);
}

// globalConfigFile: Claude Code's .claude.json (see env.js), where its user and local
// connectors are kept.
// approvals, saveApprovals: read and write the app's record of approved shared connectors.
export function createConnectors({ claudeBin, configDir, globalConfigFile, approvals = () => ({}), saveApprovals = () => {}, isTrusted = () => true }) {
  const run = (args, cwd, timeout = 90000) =>
    new Promise((resolve, reject) =>
      execFile(claudeBin, args, { cwd: cwd && fs.existsSync(cwd) ? cwd : process.env.HOME, timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) =>
        error ? reject(new Error((stderr || stdout || error.message).trim().split('\n').slice(-3).join(' '))) : resolve(stdout),
      ),
    );

  // Which of your config files defines each server name.
  function scopesFor(cwd) {
    const scopes = new Map();
    const global = readJson(globalConfigFile) || {};
    for (const name of Object.keys(global.mcpServers || {})) scopes.set(name, 'user');
    for (const name of Object.keys(global.projects?.[cwd]?.mcpServers || {})) scopes.set(name, 'local');
    if (cwd) for (const name of projectServers(cwd).keys()) scopes.set(name, 'project');
    return scopes;
  }

  // Every connector with its live status (Claude Code checks each one; takes a few seconds).
  async function list(cwd) {
    // `claude mcp list` starts connectors to check them, using its own approvals, which a repo
    // can supply. So unless this folder is trusted and everything shared in it is approved
    // here, the check runs elsewhere and this project's connectors are listed unchecked.
    const scopes = scopesFor(cwd);
    const blocked = cwd ? unapprovedProjectServers(cwd, configDir, approvals()) : [];
    const safe = !cwd || (isTrusted(cwd) && !blocked.length);
    const out = await run(['mcp', 'list'], safe ? cwd : undefined);
    const connectors = [];
    for (const line of out.split('\n')) {
      const m = /^(.+?): (.+) - (\S)\s*(.+)$/.exec(line.trim());
      if (!m) continue;
      const [, name, target, icon, statusText] = m;
      // Connectors that come from a claude.ai account aren't managed in this app.
      if (name.startsWith('claude.ai ')) continue;
      const scope = scopes.get(name) || 'user';
      // The terminal keeps its own approval list; the app keeps its own (see approve).
      const approvedHere = scope === 'project' && !unapprovedProjectServers(cwd, configDir, approvals()).includes(name);
      connectors.push({
        name,
        label: name,
        target,
        state: approvedHere && STATES[icon] === 'pending' ? 'approved' : /disabled/i.test(statusText) ? 'disabled' : STATES[icon] || 'unknown',
        statusText: approvedHere && STATES[icon] === 'pending' ? 'Approved; connects when a session starts' : shorten(statusText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')),
        scope,
        remote: /^https?:\/\//.test(target),
      });
    }
    if (!safe) {
      const listed = new Set(connectors.map((c) => c.name));
      for (const [name, scope] of scopes) {
        if (listed.has(name) || scope === 'user') continue;
        const waiting = blocked.includes(name);
        connectors.push({
          name,
          label: name,
          target: '',
          state: waiting ? 'pending' : 'unknown',
          statusText: waiting ? 'Shared by this project. Stays off until you approve it.' : 'Not checked until this folder is trusted and its shared connectors are approved',
          scope,
          remote: false,
        });
      }
    }
    return connectors;
  }

  // spec: { name, transport: 'http' | 'sse' | 'stdio', target (URL or command), args[], env[], headers[], scope }
  async function add(spec, cwd) {
    const name = String(spec.name || '').trim();
    if (!/^[\w.-]{1,60}$/.test(name)) throw new Error('Use letters, numbers, dots, dashes or underscores for the name.');
    if (!SCOPES.includes(spec.scope)) throw new Error('Unknown place to save it.');
    const target = String(spec.target || '').trim();
    if (!target) throw new Error(spec.transport === 'stdio' ? 'Enter the command to run.' : 'Enter the URL.');
    const args = ['mcp', 'add', '-s', spec.scope];
    if (spec.transport === 'stdio') {
      for (const e of spec.env || []) args.push('-e', e);
      args.push(name, '--', target, ...(spec.args || []));
    } else {
      if (!/^https?:\/\//.test(target)) throw new Error('The URL should start with https://');
      args.push('-t', spec.transport === 'sse' ? 'sse' : 'http');
      for (const header of spec.headers || []) args.push('-H', header);
      args.push(name, target);
    }
    await run(args, cwd, 30000);
    return true;
  }

  async function remove(name, scope, cwd) {
    if (!SCOPES.includes(scope)) throw new Error('Unknown place to remove it from.');
    await run(['mcp', 'remove', name, '-s', scope], cwd, 30000);
    return true;
  }

  // Opens the browser to sign in; resolves when Claude Code reports the result.
  function login(name, cwd) {
    return new Promise((resolve) => {
      const child = spawn(claudeBin, ['mcp', 'login', name], { cwd: cwd && fs.existsSync(cwd) ? cwd : process.env.HOME, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (d) => (output += d));
      child.stderr.on('data', (d) => (output += d));
      const timer = setTimeout(() => child.kill(), 5 * 60 * 1000);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, message: output.trim().split('\n').slice(-2).join(' ') });
      });
    });
  }

  const logout = (name, cwd) => run(['mcp', 'logout', name], cwd, 30000).then(() => true);

  // Shared connectors from a project's .mcp.json only run once you approve them.
  function approve(name, cwd) {
    const servers = cwd ? projectServers(cwd) : new Map();
    if (!servers.has(name)) throw new Error('No shared connector with that name in this project.');
    const all = approvals();
    const folder = realFolder(cwd);
    saveApprovals({ ...all, [folder]: { ...all[folder], [name]: fingerprint(servers.get(name)) } });
    return true;
  }

  return { list, add, remove, login, logout, approve };
}
