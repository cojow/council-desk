import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, moduleURL, sandbox, succeeds } from './helpers/index.mjs';

test('tracked source preserves authentication and browser boundaries', (t) => {
  const s = sandbox(t);
  const files = execFileSync('git', ['ls-files', '-z', '--', 'src'], { cwd: REPO, env: s.env, encoding: 'utf8' })
    .split('\0').filter((file) => /\.(?:[cm]?js|html|css)$/.test(file));
  assert.ok(files.includes('src/main/main.js'), 'guard must inspect the tracked application source');
  for (const file of files) {
    const source = fs.readFileSync(path.join(REPO, file), 'utf8');
    assert.doesNotMatch(source, /\bsetUserAgent\s*\(/, file);
    assert.doesNotMatch(source, /\bauth(?:\s+|['"`]\s*,\s*['"`])login\b/, file);
    assert.doesNotMatch(source, /https?:\/\/(?:[\w-]+\.)*claude\.ai\b/i, file);
    assert.doesNotMatch(source, /(?:\bdelete\b|\bdeleteProperty\s*\()[^;\n]*ANTHROPIC_(?:API_KEY|AUTH_TOKEN)/, file);
    // A saved key is handed to the engine only, never put in the app's own environment.
    assert.doesNotMatch(source, /process\.env\.ANTHROPIC_API_KEY\s*=[^=]/, file);
  }
});

test('board helpers default off and every app start path checks the setting', (t) => {
  const s = sandbox(t);
  succeeds(s.evaluate(`
    const { createStore } = await import(${JSON.stringify(moduleURL('src/main/store.js'))});
    assert.equal(Boolean(createStore(path.join(process.env.HOME, 'desk')).get().boardHelpers), false);
  `));
  const source = fs.readFileSync(path.join(REPO, 'src/main/main.js'), 'utf8');
  const starts = source.split('\n').filter((line) => line.includes('boardWatch.start()'));
  assert.equal(starts.length, 2, 'startup and settings change are the only start paths');
  for (const line of starts) assert.match(line, /boardHelpers/, line);
});

test('board helpers without auto-edits ask explicitly, whatever the folder last used', () => {
  const source = fs.readFileSync(path.join(REPO, 'src/main/main.js'), 'utf8');
  assert.match(source, /mode: edits \? 'acceptEdits' : 'default'/);
});

test('the Browser pane holds back sensitive field values from Claude', () => {
  const source = fs.readFileSync(path.join(REPO, 'src/main/browser.js'), 'utf8');
  assert.match(source, /sensitive\(el\) \? '' : el\.value/);
  assert.match(source, /sensitive\(el\) \? ' \(filled in\)'/);
  assert.match(source, /el\.type === 'password' \|\| [^\n]*return String\(el\.value\)/);
});

test('page security: forms and base URLs are refused, and Markdown uses an allowlist', () => {
  const html = fs.readFileSync(path.join(REPO, 'src/renderer/index.html'), 'utf8');
  for (const rule of ["form-action 'none'", "base-uri 'none'", "object-src 'none'"]) assert.ok(html.includes(rule), rule);
  const markdown = fs.readFileSync(path.join(REPO, 'src/renderer/markdown.js'), 'utf8');
  assert.match(markdown, /ALLOWED_TAGS/);
  const tags = /ALLOWED_TAGS: \[([^\]]*)\]/.exec(markdown)[1];
  for (const tag of ['form', 'button', 'style', 'textarea', 'select', 'iframe']) assert.ok(!tags.includes(`'${tag}'`), tag);
});
