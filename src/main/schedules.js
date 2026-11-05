// Scheduled tasks: saved prompts the app runs by itself in a project folder, hourly, daily,
// on weekdays or weekly, while it is open. A run is an ordinary session (it shows in the
// sidebar) and ends with a notification. Nobody is there to answer permission prompts, so
// a run uses only what your permission rules already allow ("dontAsk"), or may also edit
// files in the folder ("acceptEdits"). Runs missed while the app was closed run once when
// it next opens. No Electron imports, so it can be tested with plain node.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { readJsonFile, writeJsonAtomic } from './store.js';

const MAX_RUN_MS = 30 * 60 * 1000;
const NAME = /^.{1,80}$/;

// schedule: { every: 'hour' | 'day' | 'weekdays' | 'week', time: 'HH:MM', weekday: 0-6 }
// ('hour' uses the minutes of `time`). Returns the next run after `after`, as a timestamp.
export function nextRun(schedule, after = Date.now()) {
  const [hh, mm] = String(schedule.time || '09:00').split(':').map(Number);
  const start = new Date(after);
  if (schedule.every === 'hour') {
    const next = new Date(start);
    next.setSeconds(0, 0);
    next.setMinutes(mm || 0);
    if (next.getTime() <= after) next.setHours(next.getHours() + 1);
    return next.getTime();
  }
  for (let days = 0; days <= 8; days++) {
    const next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days, hh || 0, mm || 0);
    if (next.getTime() <= after) continue;
    const day = next.getDay();
    if (schedule.every === 'weekdays' && (day === 0 || day === 6)) continue;
    if (schedule.every === 'week' && day !== Number(schedule.weekday ?? 1)) continue;
    return next.getTime();
  }
  throw new Error('Invalid schedule');
}

// file: where tasks are saved. sessionOptions(cwd): extra SDK options for a run (e.g. the
// project connectors you haven't approved). onEvent({ type, ... }): 'changed' after any
// change, 'finished' with the run's result.
export function createSchedules({ file, sessionOptions, onEvent, log, env = (extra) => ({ ...process.env, ...extra }), now = () => Date.now() }) {
  const saved = readJsonFile(file, (message) => log?.(`schedules: ${message}`));
  let tasks = Array.isArray(saved) ? saved : [];
  const running = new Map(); // id -> AbortController
  let timer = null;

  function persist() {
    writeJsonAtomic(file, tasks);
    onEvent?.({ type: 'changed' });
  }

  const view = (t) => ({ ...t, running: running.has(t.id) });

  function save(input) {
    const name = String(input.name || '').trim();
    const prompt = String(input.prompt || '').trim();
    if (!NAME.test(name)) throw new Error('Give the task a name (up to 80 characters).');
    if (!prompt) throw new Error('Write the prompt Claude should run.');
    if (!input.cwd || !fs.existsSync(input.cwd)) throw new Error('Pick a project folder that exists.');
    if (!['hour', 'day', 'weekdays', 'week'].includes(input.schedule?.every)) throw new Error('Pick how often it runs.');
    if (!/^\d{1,2}:\d{2}$/.test(input.schedule.time || '')) throw new Error('Pick a time.');
    const existing = tasks.find((t) => t.id === input.id);
    const task = {
      ...(existing || { id: randomUUID(), createdAt: now(), last: null }),
      name,
      prompt,
      cwd: input.cwd,
      model: input.model || '',
      edits: Boolean(input.edits),
      schedule: { every: input.schedule.every, time: input.schedule.time, weekday: Number(input.schedule.weekday ?? 1) },
      enabled: input.enabled !== false,
    };
    task.nextAt = nextRun(task.schedule, now());
    if (existing) Object.assign(existing, task);
    else tasks.push(task);
    persist();
    return view(task);
  }

  function setEnabled(id, enabled) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    task.enabled = Boolean(enabled);
    if (task.enabled) task.nextAt = nextRun(task.schedule, now());
    persist();
  }

  function remove(id) {
    running.get(id)?.abort();
    tasks = tasks.filter((t) => t.id !== id);
    persist();
  }

  async function run(id, { manual = false } = {}) {
    const task = tasks.find((t) => t.id === id);
    if (!task || running.has(id)) return;
    const abort = new AbortController();
    running.set(id, abort);
    const started = now();
    const timeout = setTimeout(() => abort.abort(), MAX_RUN_MS);
    // The next run is counted from now, so runs missed while the app was closed happen once.
    task.nextAt = nextRun(task.schedule, started);
    persist();
    let sessionId = null;
    let result = null;
    try {
      const extra = (await sessionOptions?.(task.cwd)) || {};
      const q = query({
        prompt: task.prompt,
        options: {
          ...extra,
          cwd: task.cwd,
          model: task.model || undefined,
          title: `Scheduled: ${task.name}`,
          permissionMode: task.edits ? 'acceptEdits' : 'dontAsk',
          // Anything that would still ask is refused: nobody is there to answer.
          canUseTool: async () => ({ behavior: 'deny', message: 'This is a scheduled run, so nobody can approve this. Skip it and mention it in your summary.' }),
          systemPrompt: { type: 'preset', preset: 'claude_code', append: 'This is a scheduled task running unattended in Council Desk. Nobody can answer questions or approve actions during the run; finish with a short summary of what you did and found.' },
          tools: { type: 'preset', preset: 'claude_code' },
          settingSources: ['user', 'project', 'local'],
          abortController: abort,
          env: env({ CLAUDE_CODE_HOST_SCHEDULED_RUN: '1' }),
          stderr: (data) => log?.(`[schedule ${task.name}] ${data}`),
        },
      });
      for await (const msg of q) {
        if (msg.type === 'system' && msg.subtype === 'init') sessionId = msg.session_id;
        if (msg.type === 'result') result = msg;
      }
    } catch (error) {
      result = { is_error: true, result: abort.signal.aborted ? 'Stopped (it ran longer than 30 minutes or was stopped).' : String(error?.message || error) };
    } finally {
      clearTimeout(timeout);
      running.delete(id);
    }
    const ok = Boolean(result) && !result.is_error && result.subtype !== 'error_during_execution';
    const summary = String(result?.result || result?.errors?.join('\n') || (ok ? 'Done.' : 'No result.')).trim();
    task.last = { at: started, durationMs: now() - started, ok, summary: summary.slice(0, 2000), sessionId, manual };
    if (tasks.includes(task)) persist();
    onEvent?.({ type: 'finished', task: view(task) });
    log?.(`schedule "${task.name}" finished: ${ok ? 'ok' : 'failed'}`);
  }

  function tick() {
    const t = now();
    for (const task of tasks) if (task.enabled && task.nextAt <= t && !running.has(task.id)) run(task.id);
  }

  return {
    list: () => tasks.map(view),
    save,
    remove,
    setEnabled,
    runNow: (id) => run(id, { manual: true }),
    stop: (id) => running.get(id)?.abort(),
    start() {
      if (timer) return;
      tick();
      timer = setInterval(tick, 30000);
    },
    stopAll() {
      clearInterval(timer);
      timer = null;
      for (const abort of running.values()) abort.abort();
    },
  };
}
