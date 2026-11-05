// The project files the app reads and writes for you:
// - memory: CLAUDE.md in a project (and the one for all projects in Claude Code's config),
//   which Claude Code reads at the start of every session;
// - saved prompts: Claude Code custom commands, <config>/commands/<name>.md, used as /name;
// - permission rules: the allow / ask / deny lists in Claude Code's settings files;
// - read-only file access for the file viewer and @ suggestions.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PROMPT_NAME = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const MAX_VIEW_BYTES = 2 * 1024 * 1024;
const MAX_LISTED_FILES = 8000;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', '.cache', '.mypy_cache', '.pytest_cache', '.tox', '.idea', '.DS_Store']);
const RULE_KINDS = ['allow', 'ask', 'deny'];

const isDir = (p) => {
  try {
    return path.isAbsolute(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
// For a file about to be rewritten: {} when it doesn't exist yet, but an error when it
// exists and isn't valid JSON, so a typo never gets the rest of the file thrown away.
export const readJsonToUpdate = (file) => {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} isn't valid JSON (${error.message}), so it was left unchanged. Fix or remove it, then try again.`);
  }
};

export function createWorkspace({ configDir }) {
  const commandsDir = path.join(configDir, 'commands');
  const fileLists = new Map(); // cwd -> { at, files }

  // ---------- memory ----------

  function memoryPath(scope, cwd) {
    if (scope === 'user') return path.join(configDir, 'CLAUDE.md');
    if (scope === 'project' && isDir(cwd)) return path.join(cwd, 'CLAUDE.md');
    throw new Error('Unknown memory location');
  }

  function readMemory(cwd) {
    const result = {};
    for (const scope of ['project', 'user']) {
      try {
        const file = memoryPath(scope, cwd);
        const content = readText(file);
        result[scope] = { path: file, exists: content != null, content: content || '' };
      } catch {
        result[scope] = null;
      }
    }
    return result;
  }

  function writeMemory(scope, cwd, content) {
    const file = memoryPath(scope, cwd);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(content));
    return file;
  }

  // ---------- saved prompts ----------

  function parsePrompt(name, text) {
    const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
    const meta = {};
    if (match) {
      for (const line of match[1].split('\n')) {
        const m = /^([\w-]+):\s*(.*)$/.exec(line);
        if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
    return { name, description: meta.description || '', argumentHint: meta['argument-hint'] || '', body: (match ? text.slice(match[0].length) : text).trim() };
  }

  function listPrompts() {
    if (!fs.existsSync(commandsDir)) return [];
    return fs
      .readdirSync(commandsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => parsePrompt(f.slice(0, -3), readText(path.join(commandsDir, f)) || ''))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function savePrompt({ name, description = '', body = '', previousName }) {
    if (!PROMPT_NAME.test(name)) throw new Error('Use lowercase letters, numbers, - or _ for the name.');
    if (!String(body).trim()) throw new Error('The prompt is empty.');
    fs.mkdirSync(commandsDir, { recursive: true });
    const clean = (v) => String(v).replace(/\n/g, ' ').trim();
    const hint = /\$ARGUMENTS/.test(body) ? 'argument-hint: <details>\n' : '';
    fs.writeFileSync(path.join(commandsDir, `${name}.md`), `---\ndescription: ${clean(description)}\n${hint}---\n\n${String(body).trim()}\n`);
    if (previousName && previousName !== name && PROMPT_NAME.test(previousName)) {
      fs.rmSync(path.join(commandsDir, `${previousName}.md`), { force: true });
    }
    return true;
  }

  function deletePrompt(name) {
    if (!PROMPT_NAME.test(name)) return false;
    fs.rmSync(path.join(commandsDir, `${name}.md`), { force: true });
    return true;
  }

  // ---------- files ----------

  const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

  function readFile(file) {
    if (!path.isAbsolute(file)) throw new Error('Not a full path');
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('Not a file');
    const imageType = IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (imageType && stat.size <= 10 * 1024 * 1024) {
      return { path: file, size: stat.size, image: `data:${imageType};base64,${fs.readFileSync(file).toString('base64')}` };
    }
    if (stat.size > MAX_VIEW_BYTES) return { path: file, size: stat.size, tooLarge: true };
    const buffer = fs.readFileSync(file);
    if (buffer.subarray(0, 8000).includes(0)) return { path: file, size: stat.size, binary: true };
    return { path: file, size: stat.size, content: buffer.toString('utf8') };
  }

  function walk(root) {
    const files = [];
    const stack = [''];
    while (stack.length && files.length < MAX_LISTED_FILES) {
      const rel = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
      } catch {}
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const child = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) stack.push(child);
        else if (entry.isFile()) files.push(child);
      }
    }
    return files;
  }

  // Project files relative to cwd: git's list (tracked plus new, minus ignored) when it is a
  // repository, otherwise a walk that skips the usual build and environment folders.
  function listFiles(cwd) {
    if (!isDir(cwd)) return Promise.resolve([]);
    const cached = fileLists.get(cwd);
    if (cached && Date.now() - cached.at < 30000) return Promise.resolve(cached.files);
    return new Promise((resolve) => {
      // -z: names exactly as on disk (no quoting of accented letters, spaces or newlines).
      execFile('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 10000 }, (error, stdout) => {
        const files = error ? walk(cwd) : stdout.split('\0').filter(Boolean).slice(0, MAX_LISTED_FILES);
        fileLists.set(cwd, { at: Date.now(), files });
        resolve(files);
      });
    });
  }

  // ---------- permission rules ----------

  function permissionFiles(cwd) {
    const files = [{ scope: 'user', label: 'All projects', path: path.join(configDir, 'settings.json') }];
    if (isDir(cwd)) {
      files.push(
        { scope: 'local', label: 'This project, just you', path: path.join(cwd, '.claude', 'settings.local.json') },
        { scope: 'project', label: 'This project, shared with the repo', path: path.join(cwd, '.claude', 'settings.json') },
      );
    }
    return files;
  }

  function readPermissions(cwd) {
    return permissionFiles(cwd).map((f) => {
      const json = readJson(f.path);
      const rules = Object.fromEntries(RULE_KINDS.map((k) => [k, [...(json?.permissions?.[k] || [])]]));
      return { ...f, exists: fs.existsSync(f.path), invalid: json == null && fs.existsSync(f.path), rules };
    });
  }

  function writePermissions(scope, cwd, rules) {
    const target = permissionFiles(cwd).find((f) => f.scope === scope);
    if (!target) throw new Error('Unknown settings file');
    const json = readJsonToUpdate(target.path);
    json.permissions = { ...(json.permissions || {}) };
    for (const kind of RULE_KINDS) {
      const list = (rules[kind] || []).map((r) => String(r).trim()).filter(Boolean);
      if (list.length) json.permissions[kind] = [...new Set(list)];
      else delete json.permissions[kind];
    }
    if (!Object.keys(json.permissions).length) delete json.permissions;
    fs.mkdirSync(path.dirname(target.path), { recursive: true });
    fs.writeFileSync(target.path, `${JSON.stringify(json, null, 2)}\n`);
    return target.path;
  }

  return { readMemory, writeMemory, listPrompts, savePrompt, deletePrompt, readFile, listFiles, readPermissions, writePermissions };
}
