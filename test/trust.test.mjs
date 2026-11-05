import test from 'node:test';
import { moduleURL, sandbox, succeeds } from './helpers/index.mjs';

const setup = `
  const { createTrust } = await import(${JSON.stringify(moduleURL('src/main/trust.js'))});
  const { createStore } = await import(${JSON.stringify(moduleURL('src/main/store.js'))});
  const store = createStore(path.join(process.env.HOME, 'desk'));
  const globalConfigFile = path.join(process.env.HOME, '.claude.json');
  const trust = createTrust({ store, globalConfigFile });
  const project = process.env.TEST_PROJECT;
`;

test('folder trust covers descendants, excludes similarly named siblings, and persists', (t) => {
  const s = sandbox(t);
  succeeds(s.evaluate(`${setup}
    assert.equal(trust.isTrusted(project), false);
    assert.equal(trust.isTrusted(''), false);
    assert.throws(() => trust.trust(path.join(project, 'missing')), /exists/);
    trust.trust(project);
    trust.trust(project);
    assert.equal(trust.isTrusted(path.join(project, 'nested', 'child')), true);
    assert.equal(trust.isTrusted(project + '-other'), false);
    assert.equal(trust.isTrusted(path.dirname(project)), false);
    assert.deepEqual(store.get().trustedFolders, [project]);
    const reloaded = createTrust({ store: createStore(path.join(process.env.HOME, 'desk')), globalConfigFile });
    assert.equal(reloaded.isTrusted(project), true);
  `));
});

test('terminal trust reads only accepted projects and refreshes changed or malformed config', (t) => {
  const s = sandbox(t);
  succeeds(s.evaluate(`${setup}
    fs.writeFileSync(globalConfigFile, JSON.stringify({ projects: {
      [project]: { hasTrustDialogAccepted: true },
      [project + '-other']: { hasTrustDialogAccepted: false },
    } }));
    assert.equal(trust.isTrusted(path.join(project, 'child')), true);
    assert.equal(trust.isTrusted(project + '-other'), false);
    fs.writeFileSync(globalConfigFile, '{broken');
    const later = new Date(Date.now() + 2000);
    fs.utimesSync(globalConfigFile, later, later);
    assert.equal(trust.isTrusted(project), false);
    fs.rmSync(globalConfigFile);
    assert.equal(trust.isTrusted(project), false);
  `));
});

test('trust details describe both settings files and MCP servers; adoption happens only once', (t) => {
  const s = sandbox(t);
  succeeds(s.evaluate(`${setup}
    fs.mkdirSync(path.join(project, '.claude'));
    fs.writeFileSync(path.join(project, '.claude/settings.json'), JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ command: 'echo inspect' }, { command: 'x'.repeat(400) }] }] },
      permissions: { allow: ['Read(*)'] },
    }));
    fs.writeFileSync(path.join(project, '.claude/settings.local.json'), JSON.stringify({ permissions: { allow: ['Edit(*)'] } }));
    fs.writeFileSync(path.join(project, '.mcp.json'), JSON.stringify({ mcpServers: { local: {} } }));
    const details = trust.details(project);
    assert.equal(details.hooks[0].command, 'echo inspect');
    assert.equal(details.hooks[0].file, '.claude/settings.json');
    assert.equal(details.hooks[1].command.length, 300);
    assert.deepEqual(details.allowed, [
      { rule: 'Read(*)', file: '.claude/settings.json' },
      { rule: 'Edit(*)', file: '.claude/settings.local.json' },
    ]);
    assert.deepEqual(details.servers, ['local']);
    trust.adopt([project, project, null]);
    trust.adopt([project + '-other']);
    assert.deepEqual(store.get().trustedFolders, [project]);
    assert.equal(trust.isTrusted(project + '-other'), false);
  `));
});

test('a link inside a trusted folder does not trust where it leads', (t) => {
  const s = sandbox(t);
  succeeds(s.evaluate(`
    const { createTrust } = await import(${JSON.stringify(moduleURL('src/main/trust.js'))});
    let data = {};
    const store = { get: () => data, set: (patch) => { data = { ...data, ...patch }; } };
    const trust = createTrust({ store, globalConfigFile: path.join(process.env.HOME, '.claude.json') });
    const trusted = path.join(process.env.HOME, 'trusted');
    const elsewhere = path.join(process.env.HOME, 'elsewhere');
    fs.mkdirSync(trusted);
    fs.mkdirSync(elsewhere);
    trust.trust(trusted);
    fs.symlinkSync(elsewhere, path.join(trusted, 'link'));
    assert.equal(trust.isTrusted(path.join(trusted, 'link')), false);
    // A link to a trusted folder leads somewhere trusted, so it counts.
    fs.symlinkSync(trusted, path.join(elsewhere, 'back'));
    assert.equal(trust.isTrusted(path.join(elsewhere, 'back')), true);
    // Swapping the trusted folder for a link doesn't move the trust.
    fs.rmSync(trusted, { recursive: true });
    fs.symlinkSync(elsewhere, trusted);
    assert.equal(trust.isTrusted(trusted), false);
  `));
});
