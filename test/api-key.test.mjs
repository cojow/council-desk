import test from 'node:test';
import { moduleURL, sandbox, succeeds } from './helpers/index.mjs';

const setup = `
  const { createApiKey } = await import(${JSON.stringify(moduleURL('src/main/api-key.js'))});
  const dir = path.join(process.env.HOME, 'desk');
  delete process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB;
`;

test('a saved key goes to the engine only, and leaves when removed', (t) => {
  const s = sandbox(t);
  succeeds(s.evaluate(`${setup}
    delete process.env.ANTHROPIC_API_KEY;
    const key = createApiKey({ dir });
    assert.equal(key.status().source, null);
    assert.equal(key.engineEnv().ANTHROPIC_API_KEY, undefined);

    key.save('test-key-value');
    assert.equal(key.status().source, 'saved');
    assert.equal(process.env.ANTHROPIC_API_KEY, undefined, 'not in the app environment that terminals and git inherit');
    assert.equal(key.engineEnv().ANTHROPIC_API_KEY, 'test-key-value');
    // This setting would force every session to the default permission mode, so it stays yours.
    assert.equal(key.engineEnv().CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, undefined);
    assert.equal(key.engineEnv({ EXTRA: '1' }).EXTRA, '1');
    assert.equal(key.redact('oops test-key-value here'), 'oops [API key] here');
    key.save('second-key-value');
    key.engineEnv();
    assert.equal(key.redact('old test-key-value new second-key-value'), 'old [API key] new [API key]');
    key.save('test-key-value');
    assert.ok(!fs.readFileSync(path.join(dir, 'anthropic-api-key.bin')).equals(Buffer.from('test-key-value')));

    // A new run reads it back, still without touching the app environment.
    const reopened = createApiKey({ dir });
    reopened.load();
    assert.equal(reopened.status().source, 'saved');
    assert.equal(reopened.engineEnv().ANTHROPIC_API_KEY, 'test-key-value');
    assert.equal(process.env.ANTHROPIC_API_KEY, undefined);

    reopened.clear();
    assert.equal(reopened.status().source, null);
    assert.equal(reopened.engineEnv().ANTHROPIC_API_KEY, undefined);
    assert.equal(fs.existsSync(path.join(dir, 'anthropic-api-key.bin')), false);
    assert.throws(() => reopened.save('has a space'), /look like an API key/);
  `, { stubModules: true }));
});

test('a key from your environment wins and is left as you set it up', (t) => {
  const s = sandbox(t);
  succeeds(s.evaluate(`${setup}
    process.env.ANTHROPIC_API_KEY = 'from-shell';
    const key = createApiKey({ dir });
    assert.equal(key.status().source, 'environment');
    assert.throws(() => key.save('other'), /set in your environment/);
    assert.equal(key.engineEnv().ANTHROPIC_API_KEY, 'from-shell');
    assert.equal(key.engineEnv().CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, undefined);
    key.clear();
    assert.equal(process.env.ANTHROPIC_API_KEY, 'from-shell');
  `, { stubModules: true }));
});
