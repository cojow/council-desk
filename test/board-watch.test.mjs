import test from 'node:test';
import path from 'node:path';
import { moduleURL, sandbox, succeeds } from './helpers/index.mjs';

function boardSandbox(t) {
  const s = sandbox(t);
  s.json(path.join(s.board, 'agents.json'), { agents: [
    { id: 'desk', name: 'Desk Claude', kind: 'claude-code', configDir: '~/.claude' },
    { id: 'other', name: 'Other Claude', kind: 'claude-code', configDir: '~/.claude-other' },
    { id: 'codex', name: 'Council Codex', kind: 'codex' },
  ] });
  s.write(path.join(s.board, 'events.jsonl'), '');
  return s;
}

const setup = String.raw`
  const { boardDirs, readAgents, createBoardWatch } = await import(${JSON.stringify(moduleURL('src/main/board-watch.js'))});
  const configDir = path.join(process.env.HOME, '.claude');
  const file = path.join(process.env.BOARD_HOME, 'events.jsonl');
  const requests = [], logs = [];
  let poll, starts = 0;
  globalThis.setInterval = (fn) => { poll = fn; starts++; return 1; };
  globalThis.clearInterval = () => { poll = undefined; };
  const watcher = createBoardWatch({ configDir, onRequest: (brief) => requests.push(brief), log: (line) => logs.push(line) });
  const append = (...events) => fs.appendFileSync(file, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
  const flush = () => new Promise((resolve) => setImmediate(resolve));
`;

test('board paths honor BOARD_HOME and agent identity comes from agents.json', (t) => {
  const s = boardSandbox(t);
  succeeds(s.evaluate(String.raw`${setup}
    assert.deepEqual(boardDirs(), { config: process.env.BOARD_HOME, data: process.env.BOARD_HOME });
    assert.deepEqual(boardDirs({ BOARD_HOME: '~/custom-board' }), {
      config: path.join(process.env.HOME, 'custom-board'), data: path.join(process.env.HOME, 'custom-board'),
    });
    const defaults = boardDirs({});
    assert.ok(defaults.config.startsWith(process.env.HOME + path.sep));
    assert.ok(defaults.data.startsWith(process.env.HOME + path.sep));
    assert.deepEqual(readAgents({ configDir }), { me: 'Desk Claude', codex: ['Council Codex'] });
    assert.equal(readAgents({ configDir, env: { ...process.env, BOARD_AGENT: 'other' } }).me, 'Other Claude');
    assert.equal(readAgents({ configDir, env: { ...process.env, BOARD_AGENT: 'Other Claude' } }).me, 'Other Claude');
    assert.equal(readAgents({ configDir, env: { ...process.env, BOARD_AGENT: 'missing' } }).me, null);
    fs.mkdirSync(configDir);
    const alias = path.join(process.env.HOME, 'config-link');
    fs.symlinkSync(configDir, alias);
    assert.equal(readAgents({ configDir: alias }).me, 'Desk Claude');
    fs.writeFileSync(path.join(process.env.BOARD_HOME, 'agents.json'), '{broken');
    assert.deepEqual(readAgents({ configDir }), { me: null, codex: [] });
  `));
});

test('board watcher is idle until started, ignores history, and routes only eligible wake briefs', (t) => {
  const s = boardSandbox(t);
  succeeds(s.evaluate(String.raw`${setup}
    const base = { kind: 'brief', wake: true, from: 'Other Claude', project: process.env.TEST_PROJECT };
    append({ ...base, id: 'history' });
    assert.equal(starts, 0);
    assert.equal(requests.length, 0);
    watcher.start();
    watcher.start();
    assert.equal(starts, 1, 'start is idempotent');
    append(
      { ...base, id: 'unaddressed' },
      { ...base, id: 'mine', to: 'Desk Claude' },
      { ...base, id: 'to-codex', to: 'Council Codex' },
      { ...base, id: 'to-other', to: 'Other Claude' },
      { ...base, id: 'from-codex', from: 'Council Codex' },
      { ...base, id: 'from-me', from: 'Desk Claude' },
      { ...base, id: 'no-wake', wake: false },
      { ...base, id: 'message', kind: 'message' },
      { ...base, id: 'no-project', project: '' },
    );
    poll();
    await flush();
    assert.deepEqual(requests.map((brief) => brief.id), ['unaddressed', 'mine']);
    assert.ok(requests.every((brief) => brief.to === 'Desk Claude'));
    poll();
    await flush();
    assert.equal(requests.length, 2, 'records are consumed once');
    watcher.stop();
    assert.equal(poll, undefined);
  `));
});

test('board watcher handles partial records and agent edits, and writes notices to BOARD_HOME', (t) => {
  const s = boardSandbox(t);
  succeeds(s.evaluate(String.raw`${setup}
    watcher.start();
    const brief = { id: 'split', kind: 'brief', wake: true, from: 'Other Claude', project: process.env.TEST_PROJECT };
    const line = JSON.stringify(brief);
    fs.appendFileSync(file, 'invalid json\n' + line.slice(0, 20));
    poll();
    await flush();
    assert.equal(requests.length, 0);
    fs.appendFileSync(file, line.slice(20) + '\n');
    poll();
    await flush();
    assert.equal(requests[0].id, 'split');
    const agentsFile = path.join(process.env.BOARD_HOME, 'agents.json');
    const agents = JSON.parse(fs.readFileSync(agentsFile));
    agents.agents[0].name = 'Renamed Claude';
    fs.writeFileSync(agentsFile, JSON.stringify(agents));
    append({ ...brief, id: 'renamed', to: 'Renamed Claude' });
    poll();
    await flush();
    assert.equal(requests[1].to, 'Renamed Claude');
    watcher.announce(brief);
    watcher.decline(brief);
    const notices = fs.readFileSync(file, 'utf8').trim().split('\n').slice(-2).map(JSON.parse);
    assert.deepEqual(notices.map((event) => event.kind), ['helper-started', 'message']);
    assert.ok(notices.every((event) => event.from === 'Renamed Claude' && event.project === brief.project));
    assert.equal(notices[0].brief, brief.id);
    assert.match(notices[1].text, /split/);
    watcher.stop();
  `));
});

test('board watcher ignores requests without a matching agent and logs async callback failures', (t) => {
  const s = boardSandbox(t);
  succeeds(s.evaluate(String.raw`${setup}
    process.env.BOARD_AGENT = 'missing';
    watcher.start();
    const brief = { id: 'request', kind: 'brief', wake: true, from: 'Other Claude', project: process.env.TEST_PROJECT };
    append(brief);
    poll();
    await flush();
    assert.equal(requests.length, 0);
    assert.match(logs[0], /no agent/);
    watcher.stop();
    delete process.env.BOARD_AGENT;
    const failing = createBoardWatch({ configDir, onRequest: async () => { throw new Error('synthetic failure'); }, log: (line) => logs.push(line) });
    failing.start();
    append({ ...brief, id: 'failure' });
    poll();
    await flush();
    assert.match(logs.at(-1), /board helper: synthetic failure/);
    failing.stop();
  `));
});
