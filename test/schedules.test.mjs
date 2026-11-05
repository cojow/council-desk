import test from 'node:test';
import { moduleURL, sandbox, succeeds } from './helpers/index.mjs';

const setup = `
  const { nextRun, createSchedules } = await import(${JSON.stringify(moduleURL('src/main/schedules.js'))});
  const file = path.join(process.env.HOME, 'schedules.json');
`;

test('nextRun computes strictly future hourly, daily, weekday, and weekly due times', (t) => {
  const s = sandbox(t);
  succeeds(s.evaluate(`${setup}
    const cases = [
      [{ every: 'hour', time: '09:15' }, '2026-11-06T10:14:59Z', '2026-11-06T10:15:00Z'],
      [{ every: 'hour', time: '09:15' }, '2026-11-06T10:15:00Z', '2026-11-06T11:15:00Z'],
      [{ every: 'hour', time: '00:00' }, '2026-11-06T23:59:59Z', '2026-11-07T00:00:00Z'],
      [{ every: 'day', time: '09:00' }, '2026-11-06T08:00:00Z', '2026-11-06T09:00:00Z'],
      [{ every: 'day', time: '09:00' }, '2026-11-06T09:00:00Z', '2026-11-07T09:00:00Z'],
      [{ every: 'weekdays', time: '09:00' }, '2026-11-06T09:00:00Z', '2026-11-09T09:00:00Z'],
      [{ every: 'weekdays', time: '09:00' }, '2026-11-08T08:00:00Z', '2026-11-09T09:00:00Z'],
      [{ every: 'week', time: '09:00', weekday: 0 }, '2026-11-08T09:00:00Z', '2026-11-15T09:00:00Z'],
      [{ every: 'week', time: '09:00' }, '2026-11-06T12:00:00Z', '2026-11-09T09:00:00Z'],
    ];
    for (const [schedule, after, expected] of cases) {
      assert.equal(new Date(nextRun(schedule, Date.parse(after))).toISOString(), new Date(expected).toISOString(), JSON.stringify({ schedule, after }));
    }
  `, { stubModules: true }));
});

test('schedules catch up once after downtime, skip disabled/future tasks, and persist the result', (t) => {
  const s = sandbox(t);
  succeeds(s.evaluate(`${setup}
    const now = Date.parse('2026-11-09T12:00:00Z');
    const base = { name: 'Review', prompt: 'Summarize only', cwd: process.env.TEST_PROJECT, schedule: { every: 'day', time: '09:00' }, enabled: true };
    fs.writeFileSync(file, JSON.stringify([
      { ...base, id: 'overdue', nextAt: now - 5 * 86400000 },
      { ...base, id: 'disabled', enabled: false, nextAt: now - 1 },
      { ...base, id: 'future', nextAt: now + 1 },
    ]));
    globalThis.sdkMessages = [
      { type: 'system', subtype: 'init', session_id: 'fake-session' },
      { type: 'result', subtype: 'success', result: '  Finished review.  ', is_error: false },
    ];
    let tick, finished;
    globalThis.setInterval = (fn) => { tick = fn; return 1; };
    globalThis.clearInterval = () => {};
    const done = new Promise((resolve) => { finished = resolve; });
    const tasks = createSchedules({ file, now: () => now,
      sessionOptions: () => ({ settings: { disabledMcpjsonServers: ['unapproved'] } }),
      onEvent: (event) => { if (event.type === 'finished') finished(event); },
    });
    tasks.start();
    const event = await done;
    tick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(globalThis.sdkCalls.length, 1);
    const call = globalThis.sdkCalls[0];
    assert.equal(call.prompt, base.prompt);
    assert.equal(call.options.permissionMode, 'dontAsk');
    assert.equal((await call.options.canUseTool()).behavior, 'deny');
    assert.deepEqual(call.options.settings.disabledMcpjsonServers, ['unapproved']);
    assert.equal(call.options.env.CLAUDE_CODE_HOST_SCHEDULED_RUN, '1');
    assert.equal(call.options.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(event.task.running, false);
    const saved = JSON.parse(fs.readFileSync(file));
    assert.equal(saved[0].nextAt, Date.parse('2026-11-10T09:00:00Z'));
    assert.deepEqual(saved[0].last, { at: now, durationMs: 0, ok: true, summary: 'Finished review.', sessionId: 'fake-session', manual: false });
    assert.equal(saved[1].last, undefined);
    assert.equal(saved[2].last, undefined);
    tasks.stopAll();
  `, { stubModules: true }));
});

test('schedules save, reload, disable, and manually run without overlapping a task', (t) => {
  const s = sandbox(t);
  succeeds(s.evaluate(`${setup}
    const now = Date.parse('2026-11-09T12:00:00Z');
    const tasks = createSchedules({ file, now: () => now });
    const input = { name: ' Review ', prompt: ' Inspect ', cwd: process.env.TEST_PROJECT, edits: true, schedule: { every: 'hour', time: '00:30' } };
    assert.throws(() => tasks.save({ ...input, name: '' }), /name/);
    assert.throws(() => tasks.save({ ...input, prompt: '' }), /prompt/);
    assert.throws(() => tasks.save({ ...input, cwd: path.join(process.env.HOME, 'missing') }), /folder/);
    const task = tasks.save(input);
    assert.equal(task.name, 'Review');
    assert.equal(task.prompt, 'Inspect');
    assert.equal(createSchedules({ file }).list()[0].id, task.id);
    tasks.setEnabled(task.id, false);
    assert.equal(tasks.list()[0].enabled, false);
    let release;
    globalThis.sdkWait = new Promise((resolve) => { release = resolve; });
    globalThis.sdkMessages = [{ type: 'result', subtype: 'success', result: 'done' }];
    const running = tasks.runNow(task.id);
    await tasks.runNow(task.id);
    assert.equal(tasks.list()[0].running, true);
    assert.equal(globalThis.sdkCalls.length, 1);
    assert.equal(globalThis.sdkCalls[0].options.permissionMode, 'acceptEdits');
    release();
    await running;
    assert.equal(tasks.list()[0].last.manual, true);
    tasks.setEnabled(task.id, true);
    assert.ok(tasks.list()[0].nextAt > now);
    tasks.remove(task.id);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), []);
    tasks.stopAll();
  `, { stubModules: true }));
});

test('schedule failures become saved summaries without calling Claude when folder trust rejects a run', (t) => {
  const s = sandbox(t);
  succeeds(s.evaluate(`${setup}
    const tasks = createSchedules({ file, sessionOptions: () => { throw new Error('Folder is not trusted'); } });
    const task = tasks.save({ name: 'Review', prompt: 'Inspect', cwd: process.env.TEST_PROJECT, schedule: { every: 'day', time: '09:00' } });
    await tasks.runNow(task.id);
    assert.equal(globalThis.sdkCalls, undefined);
    assert.equal(tasks.list()[0].last.ok, false);
    assert.equal(tasks.list()[0].last.summary, 'Folder is not trusted');
    assert.equal(tasks.list()[0].running, false);
    tasks.stopAll();
  `, { stubModules: true }));
});
