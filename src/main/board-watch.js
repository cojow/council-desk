// Optional link to council-board (a message board shared by AI agents on this computer):
// watches it for new help requests addressed to this app's agent, so the app can start a
// helper session for them. Off unless turned on in Settings. Only requests posted while it
// runs count. It reads only what was added since the last look, and writes one notice back
// when a helper starts or you decline.
//
// Where the board lives follows council-board itself: BOARD_HOME if set, otherwise
// ~/Library/Application Support/Council Board on macOS (XDG folders elsewhere). Which agent
// this app is comes from the board's agents.json: BOARD_AGENT (an id or name) if set,
// otherwise the Claude Code agent whose configDir is the config folder this app uses.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const POLL_MS = 3000;

const expandHome = (p) => String(p).replace(/^~(?=\/|$)/, os.homedir());

export function boardDirs(env = process.env) {
  if (env.BOARD_HOME) {
    const dir = path.resolve(expandHome(env.BOARD_HOME));
    return { config: dir, data: dir };
  }
  const home = os.homedir();
  if (process.platform === 'darwin') {
    const dir = path.join(home, 'Library', 'Application Support', 'Council Board');
    return { config: dir, data: dir };
  }
  return {
    config: path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'council-board'),
    data: path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'council-board'),
  };
}

const realDir = (dir) => {
  const p = path.resolve(expandHome(dir));
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

// { me, codex } from agents.json: this app's agent name (null if none matches) and the
// names of Codex agents (they never ask for helper sessions).
export function readAgents({ configDir, env = process.env }) {
  let agents = [];
  try {
    agents = JSON.parse(fs.readFileSync(path.join(boardDirs(env).config, 'agents.json'), 'utf8')).agents || [];
  } catch {}
  const mine = env.BOARD_AGENT
    ? agents.find((a) => a.id === env.BOARD_AGENT || a.name === env.BOARD_AGENT)
    : agents.find((a) => a.kind === 'claude-code' && a.configDir && realDir(a.configDir) === realDir(configDir));
  return { me: mine?.name || null, codex: agents.filter((a) => a.kind === 'codex').map((a) => a.name) };
}

// onRequest(brief): a new, open help request from another agent that asks for a helper.
// configDir: Claude Code's config folder, to find this app's agent in agents.json.
export function createBoardWatch({ configDir, onRequest, log }) {
  const logFile = () => path.join(boardDirs().data, 'events.jsonl');
  let offset = null;
  let partial = '';
  let timer = null;
  let me = null;

  function post(fields) {
    const event = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now(), from: me, ...fields };
    fs.appendFileSync(logFile(), JSON.stringify(event) + '\n');
  }

  function look() {
    const file = logFile();
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      offset = 0;
      return;
    }
    // First look, or the log was trimmed: start from the end.
    if (offset === null || size < offset) {
      offset = size;
      partial = '';
      return;
    }
    if (size === offset) return;
    const fd = fs.openSync(file, 'r');
    const chunk = Buffer.alloc(size - offset);
    try {
      fs.readSync(fd, chunk, 0, chunk.length, offset);
    } finally {
      fs.closeSync(fd);
    }
    offset = size;
    const lines = (partial + chunk.toString('utf8')).split('\n');
    partial = lines.pop();
    // Re-read each time, so edits to agents.json apply without a restart.
    const agents = readAgents({ configDir });
    me = agents.me;
    if (!me) return;
    for (const line of lines) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      // Only requests for this agent: unaddressed or addressed to it. Ones for another
      // agent aren't ours, and Codex never asks for a helper session.
      const forMe = !event.to || event.to === me;
      if (event.kind === 'brief' && event.wake && forMe && event.from !== me && !agents.codex.includes(event.from) && event.project) {
        // onRequest may be async (it asks you first); its errors are logged either way.
        Promise.resolve()
          .then(() => onRequest({ ...event, to: me }))
          .catch((error) => log?.(`board helper: ${error.message}`));
      }
    }
  }

  return {
    start() {
      if (timer) return;
      me = readAgents({ configDir }).me;
      if (!me) log?.(`board: no agent in agents.json uses ${configDir}; helper requests are ignored until one does`);
      offset = null;
      look();
      timer = setInterval(look, POLL_MS);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    // Tells the requester on the board that a helper is on its way.
    announce(brief) {
      post({ project: brief.project, kind: 'helper-started', brief: brief.id });
    },
    // Tells the requester that you chose not to start one, so it doesn't wait for it.
    decline(brief) {
      post({ project: brief.project, kind: 'message', text: `The user chose not to start a helper session for help request ${brief.id}. Carry on yourself, or ask the user to run /help-out in Council Desk.` });
    },
  };
}
