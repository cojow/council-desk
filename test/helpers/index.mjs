import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const moduleURL = (file) => pathToFileURL(path.join(REPO, file)).href;

// Adapted from council-board's test helpers. Child processes get an allowlisted
// environment: no real HOME, account settings, API keys, or shell startup files.
export function sandbox(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'council-desk-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const board = path.join(root, 'board');
  const project = path.join(root, 'project');
  const tmp = path.join(root, 'tmp');
  for (const dir of [home, board, project, tmp]) fs.mkdirSync(dir);
  const env = {
    PATH: `${path.dirname(process.execPath)}${path.delimiter}/usr/bin:/bin`,
    HOME: home, BOARD_HOME: board,
    XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'),
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CODEX_HOME: path.join(home, '.codex'),
    TEST_ROOT: root, TEST_PROJECT: project,
    TMPDIR: tmp, TMP: tmp, TEMP: tmp, TZ: 'UTC', LC_ALL: 'C', SHELL: '/bin/false',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(home, 'empty-gitconfig'),
    GIT_CEILING_DIRECTORIES: root, GIT_TERMINAL_PROMPT: '0',
  };
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };
  const json = (file, value) => write(file, JSON.stringify(value));
  function node(argv, options = {}) {
    return spawnSync(process.execPath, argv, {
      encoding: 'utf8', cwd: project, timeout: 10000, maxBuffer: 2 * 1024 * 1024,
      ...options, env: { ...env, ...options.env },
    });
  }
  const run = (file, argv = [], options) => node([path.join(REPO, file), ...argv], options);
  const evaluate = (body, { stubModules = false, ...options } = {}) => node([
    ...(stubModules ? ['--no-warnings', '--experimental-loader', path.join(REPO, 'test/helpers/loader.mjs')] : []),
    '--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import path from 'node:path';
      ${body}
    `,
  ], options);
  return { root, home, board, project, tmp, env, write, json, node, run, evaluate };
}

export function succeeds(result) {
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

// Scanner-only fake: supports read-only Git queries, never modifies a repository.
export function fakeGit(s, { tracked = [] } = {}) {
  const bin = path.join(s.root, 'bin');
  const file = s.write(path.join(bin, 'git'), `#!${process.execPath}
    const args = process.argv.slice(2);
    if (args.includes('rev-parse')) console.log(process.env.FAKE_GIT_ROOT);
    else if (args.includes('ls-files')) process.stdout.write(JSON.parse(process.env.FAKE_GIT_TRACKED).join('\\0') + '\\0');
    else process.exit(2);
  `);
  fs.chmodSync(file, 0o755);
  Object.assign(s.env, {
    PATH: `${bin}${path.delimiter}${s.env.PATH}`, FAKE_GIT_ROOT: s.project,
    FAKE_GIT_TRACKED: JSON.stringify(tracked),
  });
}

export function fakeClaude(s, { stdout = '', code = 0 } = {}) {
  const file = s.write(path.join(s.root, 'bin', 'fake-claude'), `#!${process.execPath}
    require('node:fs').appendFileSync(process.env.TEST_CLAUDE_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');
    process.stdout.write(${JSON.stringify(stdout)});
    process.exitCode = ${code};
  `);
  fs.chmodSync(file, 0o755);
  Object.assign(s.env, {
    TEST_CLAUDE_BIN: file, TEST_CLAUDE_CALLS: path.join(s.root, 'claude-calls.jsonl'),
  });
  return file;
}
