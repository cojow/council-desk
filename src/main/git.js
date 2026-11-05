// Git for the diff review pane and per-session branches (worktrees). Only reads, plus
// creating and removing the worktrees the app made; it never commits, merges or pushes.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_PATCH_BYTES = 3 * 1024 * 1024;
const MAX_UNTRACKED_BYTES = 200 * 1024;

// core.quotePath=false: file names with accents or other non-ASCII letters come out as
// they are, not as quoted octal escapes ("caf\303\251.txt") that don't match the real file.
const git = (cwd, args, options = {}) =>
  new Promise((resolve, reject) =>
    execFile('git', ['-c', 'core.quotePath=false', ...args], { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 20000, ...options }, (error, stdout, stderr) =>
      error ? reject(new Error((stderr || error.message).trim())) : resolve(stdout),
    ),
  );

export function createGit({ worktreesDir }) {
  async function info(cwd) {
    if (!cwd || !fs.existsSync(cwd)) return { isRepo: false };
    try {
      const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
      const branch = (await git(cwd, ['branch', '--show-current']).catch(() => '')).trim() || null;
      const common = path.resolve(cwd, (await git(cwd, ['rev-parse', '--git-common-dir'])).trim());
      const mainRoot = path.dirname(common);
      return { isRepo: true, root, branch, isWorktree: path.resolve(root) !== path.resolve(mainRoot), mainRoot };
    } catch {
      return { isRepo: false };
    }
  }

  // Everything that differs from the last commit: changed tracked files as a patch,
  // plus new untracked files shown as fully added.
  async function changes(cwd) {
    const repo = await info(cwd);
    if (!repo.isRepo) return { isRepo: false };
    const root = repo.root;
    const hasHead = await git(root, ['rev-parse', '--verify', 'HEAD']).then(() => true, () => false);
    const base = hasHead ? ['HEAD'] : [];
    const numstat = await git(root, ['diff', '--numstat', ...base]);
    let patch = await git(root, ['diff', '--no-color', '--no-ext-diff', ...base]);
    const truncated = patch.length > MAX_PATCH_BYTES;
    if (truncated) patch = patch.slice(0, MAX_PATCH_BYTES);
    const files = numstat
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [added, removed, file] = line.split('\t');
        return { path: file, status: 'modified', additions: Number(added) || 0, deletions: Number(removed) || 0, binary: added === '-' };
      });
    const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean);
    for (const file of untracked.slice(0, 200)) {
      const full = path.join(root, file);
      let content = null;
      try {
        const stat = fs.statSync(full);
        if (stat.size <= MAX_UNTRACKED_BYTES) {
          const buffer = fs.readFileSync(full);
          if (!buffer.subarray(0, 8000).includes(0)) content = buffer.toString('utf8');
        }
      } catch {}
      const additions = content ? content.replace(/\n$/, '').split('\n').length : 0;
      files.push({ path: file, status: 'added', additions, deletions: 0, binary: content == null, content });
    }
    return { isRepo: true, root, branch: repo.branch, files, patch, truncated };
  }

  // Just the number of changed files, for the badge on the Changes button.
  async function changeCount(cwd) {
    const repo = await info(cwd);
    if (!repo.isRepo) return null;
    const out = await git(repo.root, ['status', '--porcelain']).catch(() => '');
    return out.split('\n').filter(Boolean).length;
  }

  const slugify = (text) =>
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .split('-')
      .slice(0, 5)
      .join('-')
      .slice(0, 40) || 'session';

  // A new branch claude/<slug> checked out in its own folder under Claude Code's config, so a
  // session's changes stay apart from the main checkout until you merge them.
  async function createWorktree(cwd, title) {
    const repo = await info(cwd);
    if (!repo.isRepo) throw new Error('Not a git repository');
    const stamp = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '');
    // The stamp is per minute, so two sessions with the same title in the same minute
    // would collide; add -2, -3 … until neither the branch nor the folder exists.
    const taken = async (name) =>
      fs.existsSync(path.join(worktreesDir, path.basename(repo.mainRoot), name)) ||
      (await git(repo.root, ['rev-parse', '--verify', '--quiet', `refs/heads/claude/${name}`]).then(() => true, () => false));
    let slug = `${slugify(title)}-${stamp}`;
    for (let n = 2; await taken(slug); n++) slug = `${slugify(title)}-${stamp}-${n}`;
    const branch = `claude/${slug}`;
    const dir = path.join(worktreesDir, path.basename(repo.mainRoot), slug);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await git(repo.root, ['worktree', 'add', '-b', branch, dir]);
    // Keep the same relative folder if the session was started in a subfolder of the repo.
    const sub = path.relative(repo.root, cwd);
    return { cwd: sub && !sub.startsWith('..') ? path.join(dir, sub) : dir, dir, branch, base: repo.branch };
  }

  // Removes a worktree folder the app created; the branch itself is kept.
  async function removeWorktree(dir, force = false) {
    const resolved = path.resolve(dir);
    if (!resolved.startsWith(path.resolve(worktreesDir) + path.sep)) throw new Error('Not a worktree made by this app');
    const repo = await info(resolved);
    await git(repo.mainRoot || resolved, ['worktree', 'remove', ...(force ? ['--force'] : []), resolved]);
    return true;
  }

  return { info, changes, changeCount, createWorktree, removeWorktree };
}

export const defaultWorktreesDir = (configDir) => path.join(configDir || path.join(os.homedir(), '.claude'), 'worktrees');
