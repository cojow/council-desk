import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fakeClaude, moduleURL, sandbox, succeeds } from './helpers/index.mjs';

for (const [name, value, code] of [
  ['logged-in status', { loggedIn: true, authMethod: 'api_key', apiProvider: 'anthropic', apiKeySource: 'environment' }, 0],
  ['logged-out JSON even on exit 1', { loggedIn: false, authMethod: 'none' }, 1],
]) {
  test(`account parser returns ${name} from a fake binary`, (t) => {
    const s = sandbox(t);
    fakeClaude(s, { stdout: JSON.stringify(value), code });
    succeeds(s.evaluate(`
      const { getAccountStatus } = await import(${JSON.stringify(moduleURL('src/main/account.js'))});
      assert.deepEqual(await getAccountStatus(), ${JSON.stringify(value)});
    `, { stubModules: true }));
    const calls = fs.readFileSync(s.env.TEST_CLAUDE_CALLS, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls, [['auth', 'status', '--json']]);
  });
}

test('account parser handles malformed output and a missing binary without throwing', (t) => {
  const s = sandbox(t);
  const file = fakeClaude(s, { stdout: 'not JSON', code: 1 });
  succeeds(s.evaluate(`
    const { getAccountStatus } = await import(${JSON.stringify(moduleURL('src/main/account.js'))});
    const expected = { loggedIn: false, error: "Couldn't read Claude Code's authentication status" };
    assert.deepEqual(await getAccountStatus(), expected);
    fs.rmSync(${JSON.stringify(file)});
    assert.deepEqual(await getAccountStatus(), expected);
  `, { stubModules: true }));
});
