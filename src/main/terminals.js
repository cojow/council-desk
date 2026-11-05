// Shells for the built-in terminal panel: one login shell per project folder, running as
// you with your usual PATH. `claude` inside it runs the bundled Claude Code (via a small
// wrapper) with the same environment as the rest of the app.
import fs from 'node:fs';
import path from 'node:path';
import pty from 'node-pty';

export function createTerminals({ emit, claudeBin, binDir, log }) {
  const terms = new Map(); // id -> pty

  // A `claude` command on the terminal's PATH that runs the bundled binary.
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'claude'), `#!/bin/sh\nexec ${JSON.stringify(claudeBin)} "$@"\n`, { mode: 0o755 });

  function open(id, cwd, cols, rows) {
    if (terms.has(id)) return { existing: true };
    const folder = cwd && fs.existsSync(cwd) ? cwd : process.env.HOME;
    const term = pty.spawn(process.env.SHELL || '/bin/zsh', ['-l'], {
      name: 'xterm-256color',
      cols: Math.max(20, cols || 80),
      rows: Math.max(5, rows || 24),
      cwd: folder,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, TERM_PROGRAM: 'CouncilDesk', COLORTERM: 'truecolor' },
    });
    term.onData((data) => emit({ id, data }));
    // Only a process that ended on its own reports (a killed or replaced one is already gone).
    term.onExit(({ exitCode }) => {
      if (terms.get(id) !== term) return;
      terms.delete(id);
      emit({ id, exit: exitCode });
    });
    terms.set(id, term);
    log?.(`terminal opened in ${folder}`);
    return { existing: false };
  }

  return {
    open,
    write: (id, data) => terms.get(id)?.write(data),
    resize: (id, cols, rows) => {
      try {
        terms.get(id)?.resize(Math.max(20, cols), Math.max(5, rows));
      } catch {}
    },
    kill: (id) => {
      terms.get(id)?.kill();
      terms.delete(id);
    },
    killAll: () => {
      for (const term of terms.values()) term.kill();
      terms.clear();
    },
  };
}
