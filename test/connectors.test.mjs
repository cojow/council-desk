import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fakeClaude, moduleURL, sandbox, succeeds } from './helpers/index.mjs';

test('connectors skip claude.ai entries and parse scope, status, and approved project entries', (t) => {
  const s = sandbox(t);
  const output = [
    'Checking MCP server health...',
    'claude.ai Calendar: https://example.com/calendar - ✓ Connected',
    'user-tool: local-command - ✔ Connected',
    'local-tool: https://example.com/mcp - ✗ Failed',
    'shared-tool: local-shared - ⏸ Pending approval',
    'disabled-tool: local-disabled - ! Disabled by user',
    'auth-tool: local-auth - ! <b>Needs</b> authentication',
  ].join('\n');
  const bin = fakeClaude(s, { stdout: output });
  s.json(path.join(s.home, '.claude.json'), {
    mcpServers: { 'user-tool': {} }, projects: { [s.project]: { mcpServers: { 'local-tool': {} } } },
  });
  s.json(path.join(s.project, '.mcp.json'), { mcpServers: { 'shared-tool': {} } });
  succeeds(s.evaluate(`
    const { createConnectors } = await import(${JSON.stringify(moduleURL('src/main/connectors.js'))});
    let stored = {};
    const connectors = createConnectors({ approvals: () => stored, saveApprovals: (next) => { stored = next; }, claudeBin: ${JSON.stringify(bin)}, configDir: process.env.CLAUDE_CONFIG_DIR, globalConfigFile: path.join(process.env.HOME, '.claude.json') });
    connectors.approve('shared-tool', process.env.TEST_PROJECT);
    const result = await connectors.list(process.env.TEST_PROJECT);
    assert.deepEqual(result.map((item) => item.name), ['user-tool', 'local-tool', 'shared-tool', 'disabled-tool', 'auth-tool']);
    assert.deepEqual(result.map((item) => item.state), ['connected', 'failed', 'approved', 'disabled', 'needs-auth']);
    assert.deepEqual(result.map((item) => item.scope), ['user', 'local', 'project', 'user', 'user']);
    assert.equal(result[1].remote, true);
    assert.equal(result[0].remote, false);
    assert.equal(result[2].statusText, 'Approved; connects when a session starts');
    assert.equal(result[4].statusText, ' Needs authentication');
  `));
  assert.deepEqual(fs.readFileSync(s.env.TEST_CLAUDE_CALLS, 'utf8').trim().split('\n').map(JSON.parse), [['mcp', 'list']]);
});

test('project connectors cannot approve themselves, and a changed connector asks again', (t) => {
  const s = sandbox(t);
  succeeds(s.evaluate(`
    const { createConnectors, unapprovedProjectServers } = await import(${JSON.stringify(moduleURL('src/main/connectors.js'))});
    const cwd = process.env.TEST_PROJECT, configDir = process.env.CLAUDE_CONFIG_DIR;
    fs.mkdirSync(path.join(cwd, '.claude'));
    const servers = (shared) => fs.writeFileSync(path.join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { shared, second: { command: 'two' } } }));
    servers({ command: 'one' });
    // Nothing a repository can ship counts: neither of its settings files.
    const grant = JSON.stringify({ enableAllProjectMcpServers: true, enabledMcpjsonServers: ['shared', 'second'] });
    fs.writeFileSync(path.join(cwd, '.claude/settings.json'), grant);
    fs.writeFileSync(path.join(cwd, '.claude/settings.local.json'), grant);
    assert.deepEqual(unapprovedProjectServers(cwd, configDir), ['shared', 'second']);

    let stored = {};
    const connectors = createConnectors({ claudeBin: '/never-run', configDir, globalConfigFile: path.join(process.env.HOME, '.claude.json'), approvals: () => stored, saveApprovals: (next) => { stored = next; } });
    connectors.approve('shared', cwd);
    connectors.approve('shared', cwd);
    assert.deepEqual(unapprovedProjectServers(cwd, configDir, stored), ['second']);
    assert.throws(() => connectors.approve('missing', cwd), /No shared connector/);

    // The approval is for that exact configuration.
    servers({ command: 'something-else' });
    assert.deepEqual(unapprovedProjectServers(cwd, configDir, stored), ['shared', 'second']);
    servers({ command: 'one' });
    assert.deepEqual(unapprovedProjectServers(cwd, configDir, stored), ['second']);

    // A link to the same folder shares the approval; another folder doesn't.
    const link = cwd + '-link';
    fs.symlinkSync(cwd, link);
    assert.deepEqual(unapprovedProjectServers(link, configDir, stored), ['second']);

    // Your own user settings still count.
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({ enabledMcpjsonServers: ['second'] }));
    assert.deepEqual(unapprovedProjectServers(cwd, configDir, stored), []);
  `));
});

test('listing never checks connectors from a project you have not approved or trusted', (t) => {
  const s = sandbox(t);
  const where = path.join(s.tmp, 'where.txt');
  const bin = path.join(s.tmp, 'fake-claude-cwd');
  fs.writeFileSync(bin, `#!/bin/sh\npwd -P >> ${JSON.stringify(where)}\n`, { mode: 0o755 });
  s.json(path.join(s.project, '.mcp.json'), { mcpServers: { shared: { command: 'one' } } });
  succeeds(s.evaluate(`
    const { createConnectors } = await import(${JSON.stringify(moduleURL('src/main/connectors.js'))});
    const cwd = process.env.TEST_PROJECT;
    let stored = {};
    let trusted = true;
    const connectors = createConnectors({ claudeBin: ${JSON.stringify(bin)}, configDir: process.env.CLAUDE_CONFIG_DIR, globalConfigFile: path.join(process.env.HOME, '.claude.json'), approvals: () => stored, saveApprovals: (next) => { stored = next; }, isTrusted: () => trusted });
    const ranIn = () => fs.readFileSync(${JSON.stringify(where)}, 'utf8').trim().split('\\n').at(-1);
    const real = fs.realpathSync;

    const waiting = await connectors.list(cwd);
    assert.equal(ranIn(), real(process.env.HOME), 'not approved: checked from elsewhere');
    assert.deepEqual(waiting.map((c) => [c.name, c.scope, c.state]), [['shared', 'project', 'pending']]);

    connectors.approve('shared', cwd);
    trusted = false;
    await connectors.list(cwd);
    assert.equal(ranIn(), real(process.env.HOME), 'not trusted: checked from elsewhere');

    trusted = true;
    await connectors.list(cwd);
    assert.equal(ranIn(), real(cwd), 'trusted and approved: checked in the project');
  `));
});
