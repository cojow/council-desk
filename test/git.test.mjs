import test from 'node:test';
import path from 'node:path';
import { moduleURL, sandbox, succeeds } from './helpers/index.mjs';
import { seedRepo } from './helpers/git-repo.mjs';

test('Git helpers report tracked edits, deletions, Unicode paths, and bounded untracked contents', (t) => {
  const s = sandbox(t);
  seedRepo(s, { '.gitignore': 'ignored.txt\n', 'café file.txt': 'old\nkept\n', 'removed.txt': 'remove me\n' });
  s.write(path.join(s.project, 'café file.txt'), 'new\nkept\n');
  s.write(path.join(s.project, 'fresh notes.txt'), 'first\nsecond\n');
  s.write(path.join(s.project, 'binary.bin'), Buffer.from([0, 1, 2]));
  s.write(path.join(s.project, 'large.txt'), 'x'.repeat(201 * 1024));
  s.write(path.join(s.project, 'ignored.txt'), 'ignored\n');
  succeeds(s.evaluate(`
    const { createGit } = await import(${JSON.stringify(moduleURL('src/main/git.js'))});
    const tools = createGit({ worktreesDir: path.join(process.env.HOME, 'worktrees') });
    const cwd = process.env.TEST_PROJECT;
    fs.rmSync(path.join(cwd, 'removed.txt'));
    fs.mkdirSync(path.join(cwd, 'nested'));
    assert.deepEqual(await tools.info(path.join(cwd, 'nested')), { isRepo: true, root: cwd, branch: 'main', isWorktree: false, mainRoot: cwd });
    const result = await tools.changes(cwd);
    assert.equal(result.isRepo, true);
    assert.equal(result.truncated, false);
    const files = new Map(result.files.map((file) => [file.path, file]));
    assert.equal(files.size, 5);
    assert.deepEqual(files.get('café file.txt'), { path: 'café file.txt', status: 'modified', additions: 1, deletions: 1, binary: false });
    assert.equal(files.get('removed.txt').deletions, 1);
    assert.equal(files.get('fresh notes.txt').content, 'first\\nsecond\\n');
    assert.equal(files.get('fresh notes.txt').additions, 2);
    for (const name of ['binary.bin', 'large.txt']) {
      assert.equal(files.get(name).binary, true);
      assert.equal(files.get(name).content, null);
    }
    assert.equal(files.has('ignored.txt'), false);
    assert.ok(result.patch.includes('café file.txt'));
    assert.match(result.patch, /-old/);
    assert.ok(result.patch.includes('+new'));
    assert.equal(await tools.changeCount(cwd), 5);
  `));
});

test('Git helpers handle non-repositories and reject worktree removal outside their own directory', (t) => {
  const s = sandbox(t);
  succeeds(s.evaluate(`
    const { createGit, defaultWorktreesDir } = await import(${JSON.stringify(moduleURL('src/main/git.js'))});
    const root = path.join(process.env.HOME, 'worktrees');
    const tools = createGit({ worktreesDir: root });
    assert.deepEqual(await tools.info(process.env.TEST_PROJECT), { isRepo: false });
    assert.deepEqual(await tools.info(path.join(process.env.HOME, 'missing')), { isRepo: false });
    assert.deepEqual(await tools.changes(process.env.TEST_PROJECT), { isRepo: false });
    assert.equal(await tools.changeCount(process.env.TEST_PROJECT), null);
    await assert.rejects(tools.removeWorktree(root), /Not a worktree made by this app/);
    await assert.rejects(tools.removeWorktree(root + '-other/session'), /Not a worktree made by this app/);
    await assert.rejects(tools.removeWorktree(path.join(root, '..', 'outside')), /Not a worktree made by this app/);
    assert.equal(defaultWorktreesDir(), path.join(process.env.HOME, '.claude', 'worktrees'));
    assert.equal(defaultWorktreesDir(process.env.CLAUDE_CONFIG_DIR), path.join(process.env.CLAUDE_CONFIG_DIR, 'worktrees'));
  `));
});
