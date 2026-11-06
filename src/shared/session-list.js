// What goes where in the sessions sidebar: projects, date headings, filters, sections and
// cleanup. No DOM or Electron here, so the rules can be tested on their own.

const DAY = 86400000;

const baseName = (p) => String(p || '').replace(/\/+$/, '').split('/').pop() || '';
const parentName = (p) => baseName(String(p || '').replace(/\/+$/, '').split('/').slice(0, -1).join('/'));

// Where a branch folder (git worktree) really belongs. The app keeps them at
// <worktreesRoot><repo name>/<branch>/…, which only names the repo; Claude Code keeps them
// at <repo>/.claude/worktrees/<branch>, which gives the whole path.
function worktreeOwner(cwd, worktreesRoot) {
  if (worktreesRoot && cwd.startsWith(worktreesRoot)) return { repoName: cwd.slice(worktreesRoot.length).split('/')[0] };
  const inside = cwd.indexOf('/.claude/worktrees/');
  if (inside > 0) return { repoPath: cwd.slice(0, inside) };
  return null;
}

// Returns a function from a session's folder to its project: { key, name }. A branch folder
// joins the folder it came from when that can be told for certain; two folders with the
// same name that could both own it leave it in a section of its own.
export function projectIndex(sessions, worktreesRoot) {
  const folders = new Set();
  for (const s of sessions) {
    if (s.cwd && !worktreeOwner(s.cwd, worktreesRoot)) folders.add(s.cwd);
  }
  const byName = new Map();
  const remember = (folder) => {
    const list = byName.get(baseName(folder)) || [];
    if (!list.includes(folder)) list.push(folder);
    byName.set(baseName(folder), list);
  };
  folders.forEach(remember);
  // A Claude Code branch folder names its repo outright, even if no session ran there.
  for (const s of sessions) {
    const repoPath = s.cwd && worktreeOwner(s.cwd, worktreesRoot)?.repoPath;
    if (repoPath) remember(repoPath);
  }

  const keyFor = (cwd) => {
    if (!cwd) return '';
    const owner = worktreeOwner(cwd, worktreesRoot);
    if (!owner) return cwd;
    if (owner.repoPath) return owner.repoPath;
    const candidates = byName.get(owner.repoName) || [];
    return candidates.length === 1 ? candidates[0] : `worktrees:${owner.repoName}`;
  };

  const nameOf = (key) => {
    if (!key) return 'No folder';
    if (key.startsWith('worktrees:')) return key.slice('worktrees:'.length);
    const name = baseName(key);
    return (byName.get(name) || []).length > 1 ? `${name} (${parentName(key)})` : name;
  };

  return (cwd) => {
    const key = keyFor(cwd);
    return { key, name: nameOf(key) };
  };
}

// The time a session is sorted and dated by.
export const sessionTime = (s, sort = 'active') => (sort === 'created' ? s.createdAt || s.lastModified : s.lastModified) || 0;

export function sortSessions(sessions, sort = 'active') {
  return [...sessions].sort((a, b) => sessionTime(b, sort) - sessionTime(a, sort));
}

// Sections for each project, newest first. Each keeps its sessions in the order given.
export function groupByProject(sessions, projectFor, sort = 'active') {
  const groups = new Map();
  for (const s of sessions) {
    const { key, name } = projectFor(s.cwd);
    if (!groups.has(key)) groups.set(key, { key, name, sessions: [], latest: 0 });
    const group = groups.get(key);
    group.sessions.push(s);
    group.latest = Math.max(group.latest, sessionTime(s, sort));
  }
  return [...groups.values()].sort((a, b) => b.latest - a.latest);
}

// Today, Yesterday, This week (the seven days before today) or Older, by the local calendar.
export function dateBucket(ms, now = Date.now()) {
  const today = new Date(now);
  const startOf = (daysAgo) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo).getTime();
  if (ms >= startOf(0)) return 'Today';
  if (ms >= startOf(1)) return 'Yesterday';
  if (ms >= startOf(7)) return 'This week';
  return 'Older';
}

// Splits an already sorted list under date headings, in the order they come up.
export function groupByDate(sessions, sort = 'active', now = Date.now()) {
  const groups = [];
  for (const s of sessions) {
    const label = dateBucket(sessionTime(s, sort), now);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.sessions.push(s);
    else groups.push({ label, sessions: [s] });
  }
  return groups;
}

// filters: { project, branch, running }; any left empty lets everything through.
export function filterSessions(sessions, filters, { projectFor, isRunning }) {
  return sessions.filter(
    (s) =>
      (!filters.project || projectFor(s.cwd).key === filters.project) &&
      (!filters.branch || s.gitBranch === filters.branch) &&
      (!filters.running || isRunning(s)),
  );
}

export const hasFilters = (filters) => Boolean(filters.project || filters.branch || filters.running);

// The choices a filter offers, drawn from all sessions so a choice can't hide the others.
export function filterChoices(sessions, projectFor) {
  const projects = new Map();
  const branches = new Set();
  for (const s of sessions) {
    const { key, name } = projectFor(s.cwd);
    projects.set(key, name);
    if (s.gitBranch) branches.add(s.gitBranch);
  }
  const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  return {
    projects: [...projects].map(([key, name]) => ({ key, name })).sort((a, b) => byName(a.name, b.name)),
    branches: [...branches].sort(byName),
  };
}

// Puts each session in exactly one section. Most urgent or most deliberate choice wins:
// needs you > archived > pinned > your folder > helper group > everything else.
export function sortIntoSections(sessions, { needsYou, archived, pinned, folderOf, isHelper }) {
  const sections = { needs: [], archived: [], pinned: [], folders: new Map(), helpers: [], rest: [] };
  for (const s of sessions) {
    const id = s.sessionId;
    const folder = folderOf(id);
    if (needsYou(s)) sections.needs.push(s);
    else if (archived.has(id)) sections.archived.push(s);
    else if (pinned.has(id)) sections.pinned.push(s);
    else if (folder) {
      if (!sections.folders.has(folder)) sections.folders.set(folder, []);
      sections.folders.get(folder).push(s);
    } else if (isHelper(s)) sections.helpers.push(s);
    else sections.rest.push(s);
  }
  return sections;
}

// Sessions "archive older than N days" would take. Leaves alone anything you've kept on
// purpose (pinned, in a folder) or that still wants attention, and anything already archived.
export function archiveCandidates(sessions, { days, keep, now = Date.now() }) {
  const cutoff = now - days * DAY;
  return sessions.filter((s) => (s.lastModified || 0) < cutoff && !keep(s));
}

// The sessions from anchor to target in the order shown, for shift-click.
export function selectRange(order, anchor, target) {
  const from = order.indexOf(anchor);
  const to = order.indexOf(target);
  if (to < 0) return [];
  if (from < 0) return [target];
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
}

// Puts the sessions in a folder, or takes them out of any folder when folderId is null.
export function assignFolder(folderOf, sessionIds, folderId) {
  const next = { ...folderOf };
  for (const id of sessionIds) {
    if (folderId) next[id] = folderId;
    else delete next[id];
  }
  return next;
}

export function withoutFolder(folderOf, folderId) {
  return Object.fromEntries(Object.entries(folderOf).filter(([, id]) => id !== folderId));
}

// Archives or unarchives sessions. `undo` takes the lists as they are by then and reverses
// only what this change did, so anything you've done since stays.
export function applyArchive({ archived, pinned }, ids, archive) {
  const changed = ids.filter((id) => archived.includes(id) !== archive);
  const unpinned = archive ? ids.filter((id) => pinned.includes(id)) : [];
  const without = (list, gone) => list.filter((id) => !gone.includes(id));
  const adding = (list, added) => [...new Set([...list, ...added])];
  return {
    archived: archive ? adding(archived, changed) : without(archived, changed),
    pinned: without(pinned, unpinned),
    undo: (now) => ({
      archived: archive ? without(now.archived, changed) : adding(now.archived, changed),
      pinned: adding(now.pinned, unpinned),
    }),
  };
}

// Deletes a folder (its sessions go back to their projects). `undo` brings it back, with
// the sessions you haven't since put somewhere else.
export function removeFolder({ folders, folderOf }, folder) {
  return {
    folders: folders.filter((f) => f.id !== folder.id),
    folderOf: withoutFolder(folderOf, folder.id),
    undo: (now) => ({
      folders: now.folders.some((f) => f.id === folder.id) ? now.folders : [...now.folders, folder],
      folderOf: { ...Object.fromEntries(Object.entries(folderOf).filter(([, id]) => id === folder.id)), ...now.folderOf },
    }),
  };
}
