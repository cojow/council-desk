import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyArchive,
  archiveCandidates,
  assignFolder,
  dateBucket,
  filterChoices,
  filterSessions,
  groupByDate,
  groupByProject,
  hasFilters,
  projectIndex,
  removeFolder,
  selectRange,
  sortIntoSections,
  sortSessions,
  withoutFolder,
} from '../src/shared/session-list.js';

const ROOT = '/config/worktrees/';
const at = (y, m, d, hh = 12) => new Date(y, m - 1, d, hh).getTime();
const ids = (list) => list.map((s) => s.sessionId);
const session = (sessionId, cwd, lastModified = 0, extra = {}) => ({ sessionId, cwd, lastModified, ...extra });

test('branch folders join the project they came from', () => {
  const projectFor = projectIndex([session('a', '/code/app'), session('b', `${ROOT}app/fix-thing`), session('c', '/code/lib/.claude/worktrees/x')], ROOT);
  assert.deepEqual(projectFor(`${ROOT}app/fix-thing`), { key: '/code/app', name: 'app' });
  assert.deepEqual(projectFor(`${ROOT}app/fix-thing/sub/dir`), { key: '/code/app', name: 'app' });
  assert.deepEqual(projectFor('/code/lib/.claude/worktrees/x'), { key: '/code/lib', name: 'lib' });
});

test('a branch folder whose project can\'t be told for certain stays apart', () => {
  const twoApps = projectIndex([session('a', '/work/app'), session('b', '/play/app'), session('c', `${ROOT}app/x`)], ROOT);
  assert.deepEqual(twoApps(`${ROOT}app/x`), { key: 'worktrees:app', name: 'app' });
  const noParent = projectIndex([session('c', `${ROOT}gone/x`)], ROOT);
  assert.deepEqual(noParent(`${ROOT}gone/x`), { key: 'worktrees:gone', name: 'gone' });
});

test('project names only say more when two folders share a name', () => {
  const projectFor = projectIndex([session('a', '/work/app'), session('b', '/play/app'), session('c', '/code/site')], ROOT);
  assert.equal(projectFor('/work/app').name, 'app (work)');
  assert.equal(projectFor('/play/app').name, 'app (play)');
  assert.equal(projectFor('/code/site').name, 'site');
  assert.deepEqual(projectFor(undefined), { key: '', name: 'No folder' });
});

test('projects sort by their newest session and keep the order inside', () => {
  const sessions = [session('new', '/b', 30), session('mid', '/a', 20), session('old', '/b', 10)];
  const groups = groupByProject(sessions, projectIndex(sessions, ROOT));
  assert.deepEqual(groups.map((g) => [g.name, ids(g.sessions)]), [['b', ['new', 'old']], ['a', ['mid']]]);
});

test('sorting uses last active or created, falling back when created is missing', () => {
  const sessions = [session('a', '/x', 10, { createdAt: 5 }), session('b', '/x', 20, { createdAt: 1 }), session('c', '/x', 3)];
  assert.deepEqual(ids(sortSessions(sessions, 'active')), ['b', 'a', 'c']);
  assert.deepEqual(ids(sortSessions(sessions, 'created')), ['a', 'c', 'b']);
});

test('date headings follow the local calendar, not 24-hour windows', () => {
  const now = at(2026, 11, 5, 0.5);
  assert.equal(dateBucket(at(2026, 11, 5, 0.25), now), 'Today');
  assert.equal(dateBucket(at(2026, 11, 4, 23), now), 'Yesterday');
  assert.equal(dateBucket(at(2026, 10, 29, 1), now), 'This week');
  assert.equal(dateBucket(at(2026, 10, 28, 23), now), 'Older');
});

test('date headings come in list order and only when used', () => {
  const now = at(2026, 11, 5);
  const sessions = [session('t', '/x', at(2026, 11, 5, 9)), session('o', '/x', at(2026, 1, 1))];
  assert.deepEqual(groupByDate(sessions, 'active', now).map((g) => [g.label, ids(g.sessions)]), [['Today', ['t']], ['Older', ['o']]]);
});

test('filters combine, and offered choices come from every session', () => {
  const sessions = [session('a', '/one', 1, { gitBranch: 'main' }), session('b', '/two', 2, { gitBranch: 'fix' }), session('c', '/one', 3, { gitBranch: 'fix' })];
  const projectFor = projectIndex(sessions, ROOT);
  const run = (filters) => ids(filterSessions(sessions, filters, { projectFor, isRunning: (s) => s.sessionId === 'c' }));
  assert.deepEqual(run({}), ['a', 'b', 'c']);
  assert.deepEqual(run({ project: '/one' }), ['a', 'c']);
  assert.deepEqual(run({ branch: 'fix' }), ['b', 'c']);
  assert.deepEqual(run({ project: '/one', branch: 'fix', running: true }), ['c']);
  assert.equal(hasFilters({}), false);
  assert.equal(hasFilters({ running: true }), true);
  const choices = filterChoices(sessions, projectFor);
  assert.deepEqual(choices.projects.map((p) => p.name), ['one', 'two']);
  assert.deepEqual(choices.branches, ['fix', 'main']);
});

test('each session lands in one section, with the most urgent first', () => {
  const sessions = ['waiting', 'gone', 'top', 'filed', 'helper', 'plain', 'filed-gone'].map((id) => session(id, '/x'));
  const folders = { filed: 'f1', top: 'f1', 'filed-gone': 'f1', helper: undefined };
  const sections = sortIntoSections(sessions, {
    needsYou: (s) => s.sessionId === 'waiting',
    archived: new Set(['waiting', 'gone', 'filed-gone']),
    pinned: new Set(['top']),
    folderOf: (id) => folders[id],
    isHelper: (s) => ['helper', 'filed'].includes(s.sessionId),
  });
  assert.deepEqual(ids(sections.needs), ['waiting']);
  assert.deepEqual(ids(sections.archived), ['gone', 'filed-gone']);
  assert.deepEqual(ids(sections.pinned), ['top']);
  assert.deepEqual(ids(sections.folders.get('f1')), ['filed']);
  assert.deepEqual(ids(sections.helpers), ['helper']);
  assert.deepEqual(ids(sections.rest), ['plain']);
});

test('archive cleanup takes only old sessions nothing is holding on to', () => {
  const now = at(2026, 11, 5);
  const day = 86400000;
  const sessions = [session('old', '/x', now - 40 * day), session('kept', '/x', now - 40 * day), session('recent', '/x', now - 10 * day), session('edge', '/x', now - 30 * day)];
  const found = archiveCandidates(sessions, { days: 30, now, keep: (s) => s.sessionId === 'kept' });
  assert.deepEqual(ids(found), ['old']);
});

test('shift-select takes the range either way and copes with a missing anchor', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(selectRange(order, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(selectRange(order, 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(selectRange(order, 'gone', 'c'), ['c']);
  assert.deepEqual(selectRange(order, 'a', 'gone'), []);
});

test('folder assignments change without touching the original', () => {
  const start = { a: 'f1', b: 'f2' };
  assert.deepEqual(assignFolder(start, ['a', 'c'], 'f2'), { a: 'f2', b: 'f2', c: 'f2' });
  assert.deepEqual(assignFolder(start, ['a'], null), { b: 'f2' });
  assert.deepEqual(withoutFolder(start, 'f1'), { b: 'f2' });
  assert.deepEqual(start, { a: 'f1', b: 'f2' });
});

test('undoing an archive reverses only that change', () => {
  const change = applyArchive({ archived: ['old'], pinned: ['a', 'b'] }, ['a', 'old', 'c'], true);
  assert.deepEqual(change.archived, ['old', 'a', 'c']);
  assert.deepEqual(change.pinned, ['b']);
  // Later: d gets archived and e gets pinned. Both stay after the undo; old was archived already.
  const undone = change.undo({ archived: [...change.archived, 'd'], pinned: [...change.pinned, 'e'] });
  assert.deepEqual(undone.archived, ['old', 'd']);
  assert.deepEqual(undone.pinned, ['b', 'e', 'a']);
});

test('undoing an unarchive puts back only what it took out', () => {
  const change = applyArchive({ archived: ['a', 'b'], pinned: [] }, ['a', 'not-archived'], false);
  assert.deepEqual(change.archived, ['b']);
  assert.deepEqual(change.undo({ archived: ['b', 'later'], pinned: ['p'] }), { archived: ['b', 'later', 'a'], pinned: ['p'] });
});

test('undoing a folder delete keeps folders and moves made since', () => {
  const f1 = { id: 'f1', name: 'One' };
  const f2 = { id: 'f2', name: 'Two' };
  const change = removeFolder({ folders: [f1], folderOf: { a: 'f1', b: 'f1' } }, f1);
  assert.deepEqual(change.folders, []);
  assert.deepEqual(change.folderOf, {});
  // Later: a new folder holds b and c. The undo returns a to f1 and leaves b and c alone.
  const undone = change.undo({ folders: [f2], folderOf: { b: 'f2', c: 'f2' } });
  assert.deepEqual(undone.folders, [f2, f1]);
  assert.deepEqual(undone.folderOf, { a: 'f1', b: 'f2', c: 'f2' });
});
