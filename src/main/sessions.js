// Runs Claude Code sessions through the Agent SDK. No Electron imports, so the
// smoke test can drive it directly. Every event goes out through `emit(event)`,
// where event.key identifies the window-side conversation.
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import {
  deleteSession,
  getSessionMessages,
  listSessions,
  query,
  renameSession,
  tagSession,
} from '@anthropic-ai/claude-agent-sdk';

// Async iterable the SDK reads user messages from, so one Claude process serves
// the whole conversation (needed for interrupt, mode changes and permission prompts).
class InputQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.closed = false;
  }
  push(item) {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
  }
  close() {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

class LiveSession {
  constructor(manager, { key, cwd, resume, resumeAt, mode, model, effort, fast }) {
    const blocked = manager.blockedConnectors?.(cwd) || [];
    const extraServers = manager.extraServers?.() || {};
    const voice = manager.voice?.() || '';
    this.manager = manager;
    this.key = key;
    this.cwd = cwd;
    this.sessionId = resume || null;
    this.busy = false;
    this.pending = new Map();
    this.queue = new InputQueue();
    this.query = query({
      prompt: this.queue,
      options: {
        cwd,
        resume: resume || undefined,
        // After a rewind: continue from this earlier message instead of the end.
        resumeSessionAt: (resume && resumeAt) || undefined,
        // Backs up files before Claude edits them, so Rewind can restore them.
        enableFileCheckpointing: true,
        permissionMode: mode || 'default',
        model: model || undefined,
        effort: effort || undefined,
        // Shared project connectors you haven't approved stay off (see connectors.js).
        settings: blocked.length ? { disabledMcpjsonServers: blocked } : undefined,
        // Tools the app provides itself (the Browser pane).
        mcpServers: Object.keys(extraServers).length ? extraServers : undefined,
        includePartialMessages: true,
        // Off only for test runs, which shouldn't show up in the sidebar.
        persistSession: manager.persistSessions === false ? false : undefined,
        // The voice you chose in Settings, if any, is added to Claude Code's own instructions.
        systemPrompt: voice ? { type: 'preset', preset: 'claude_code', append: voice } : { type: 'preset', preset: 'claude_code' },
        tools: { type: 'preset', preset: 'claude_code' },
        settingSources: ['user', 'project', 'local'],
        env: manager.env?.(),
        canUseTool: (toolName, input, options) => this.askPermission(toolName, input, options),
        stderr: (data) => manager.log?.(`[claude ${key}] ${data}`),
      },
    });
    if (fast) this.query.applyFlagSettings({ fastMode: true }).catch(() => {});
    this.pump();
  }

  emit(event) {
    this.manager.emit({ key: this.key, ...event });
  }

  setBusy(busy) {
    if (this.busy === busy) return;
    this.busy = busy;
    this.emit({ type: 'busy', busy });
  }

  async pump() {
    try {
      for await (const msg of this.query) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          this.sessionId = msg.session_id;
          this.emit({ type: 'session', sessionId: msg.session_id, cwd: msg.cwd, model: msg.model, mode: msg.permissionMode });
        }
        if (msg.type === 'result') {
          this.setBusy(false);
          if (msg.fast_mode_state) this.emit({ type: 'fast', state: msg.fast_mode_state, reason: msg.fast_mode_disabled_reason || null });
        }
        this.emit({ type: 'sdk', msg });
      }
    } catch (error) {
      this.emit({ type: 'error', message: String(error?.message || error) });
    } finally {
      this.setBusy(false);
      for (const entry of this.pending.values()) entry.finish({ behavior: 'deny', message: 'Session closed.' });
      if (this.manager.live.get(this.key) === this) this.manager.live.delete(this.key);
      this.emit({ type: 'closed' });
    }
  }

  // content: a string, or Messages API content blocks (text plus images).
  // uuid: the window's id for this message; the transcript keeps it, and Rewind uses it.
  send(content, uuid) {
    this.setBusy(true);
    this.queue.push({
      type: 'user',
      uuid: uuid || undefined,
      message: { role: 'user', content },
      parent_tool_use_id: null,
    });
  }

  askPermission(toolName, input, options) {
    if (this.manager.autoAllow?.has(toolName)) return Promise.resolve({ behavior: 'allow', updatedInput: input });
    return new Promise((resolve) => {
      const id = randomUUID();
      const finish = (result) => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        resolve(result);
        this.emit({ type: 'permission_resolved', id });
      };
      this.pending.set(id, { toolName, input, suggestions: options.suggestions, finish });
      options.signal?.addEventListener('abort', () => finish({ behavior: 'deny', message: 'Cancelled.' }));
      this.emit({
        type: 'permission',
        id,
        toolName,
        input,
        toolUseID: options.toolUseID,
        title: options.title,
        displayName: options.displayName,
        description: options.description,
        decisionReason: options.decisionReason,
        canAlwaysAllow: Boolean(options.suggestions?.length) && !options.suppressAlwaysAllowRule,
      });
    });
  }

  // decision: { kind: 'allow' | 'always' | 'deny', answers?, message?, setMode? }
  async respond(id, decision) {
    const entry = this.pending.get(id);
    if (!entry) return;
    if (decision.setMode) await this.setMode(decision.setMode);
    if (decision.kind === 'deny') {
      entry.finish({ behavior: 'deny', message: decision.message || 'The user declined this action.' });
      return;
    }
    const updatedInput = decision.answers ? { ...entry.input, answers: decision.answers } : entry.input;
    const result = { behavior: 'allow', updatedInput };
    if (decision.kind === 'always' && entry.suggestions?.length) result.updatedPermissions = entry.suggestions;
    entry.finish(result);
  }

  async setMode(mode) {
    await this.query.setPermissionMode(mode);
    this.emit({ type: 'mode', mode });
  }

  close() {
    this.queue.close();
    this.query.close();
  }
}

export class SessionManager {
  // extraServers(): in-app MCP servers for each new session; autoAllow: tool names that
  // never need a permission prompt; persistSessions: false keeps conversations off disk.
  // voice(): text added to each new session's instructions ('' for none).
  // env(): the environment for each Claude Code process (default: this process's).
  constructor({ emit, log, blockedConnectors, extraServers, autoAllow, voice, env, persistSessions = true }) {
    this.emit = emit;
    this.env = env;
    this.persistSessions = persistSessions;
    this.log = log;
    this.blockedConnectors = blockedConnectors;
    this.extraServers = extraServers;
    this.autoAllow = autoAllow;
    this.voice = voice;
    this.live = new Map();
    this.resumeAt = new Map(); // key -> message id to continue from after a rewind
  }

  list() {
    return listSessions({ limit: 300 });
  }

  history(sessionId, cwd) {
    return getSessionMessages(sessionId, cwd ? { dir: cwd } : undefined);
  }

  rename(sessionId, title, cwd) {
    return renameSession(sessionId, title, cwd ? { dir: cwd } : undefined);
  }

  // A label kept in the session's transcript (listed as `tag`), e.g. 'helper'; null clears it.
  tag(sessionId, tag, cwd) {
    return tagSession(sessionId, tag ?? null, cwd ? { dir: cwd } : undefined);
  }

  // True while Claude is working in this session or waiting on an answer.
  isActive(sessionId) {
    for (const session of this.live.values()) {
      if (session.sessionId === sessionId && (session.busy || session.pending.size)) return true;
    }
    return false;
  }

  async remove(sessionId, cwd) {
    for (const session of this.live.values()) if (session.sessionId === sessionId) session.close();
    return deleteSession(sessionId, cwd ? { dir: cwd } : undefined);
  }

  // Starts the Claude process for a conversation if it is not running yet.
  ensure({ key, cwd, resume, mode, model, effort, fast }) {
    let session = this.live.get(key);
    if (!session) {
      const resumeAt = this.resumeAt.get(key);
      this.resumeAt.delete(key);
      session = new LiveSession(this, { key, cwd, resume, resumeAt, mode, model, effort, fast });
      this.live.set(key, session);
    }
    return session;
  }

  send({ text, content, uuid, ...options }) {
    this.ensure(options).send(content ?? text, uuid);
  }

  // ---------- rewind ----------

  // Runs fn(query) on the conversation's Claude process, or on a short-lived one that
  // reopens a closed session (file backups are on disk, so it can still restore them).
  async withQuery(key, sessionId, cwd, fn) {
    const live = this.live.get(key);
    if (live?.sessionId === sessionId) return fn(live.query);
    const q = query({
      prompt: new InputQueue(),
      options: { cwd, resume: sessionId, enableFileCheckpointing: true, settingSources: [], tools: [], env: this.env?.() },
    });
    try {
      return await fn(q);
    } finally {
      q.close();
    }
  }

  // Where a rewind to messageId lands: the entry just before it (null when it's the first).
  async rewindPoint(sessionId, cwd, messageId) {
    const messages = await getSessionMessages(sessionId, { dir: cwd });
    const index = messages.findIndex((m) => m.uuid === messageId);
    if (index < 0) return { found: false };
    return { found: true, before: index ? messages[index - 1].uuid : null };
  }

  // What rewinding would do: whether the message is found, and which files would change.
  async rewindPreview({ key, sessionId, cwd, messageId }) {
    const point = await this.rewindPoint(sessionId, cwd, messageId);
    if (!point.found) return { found: false };
    const files = await this.withQuery(key, sessionId, cwd, (q) => q.rewindFiles(messageId, { dryRun: true })).catch((error) => ({ canRewind: false, error: error.message }));
    return { found: true, first: point.before === null, files };
  }

  // Puts the conversation back to just before messageId and, if `files`, restores the
  // files Claude changed since then. The next message continues from there; rewinding to
  // the first message starts a new session and deletes this one.
  async rewind({ key, sessionId, cwd, messageId, files }) {
    if (this.live.get(key)?.busy) throw new Error('Stop Claude before rewinding.');
    const point = await this.rewindPoint(sessionId, cwd, messageId);
    if (!point.found) throw new Error("This message isn't in the saved conversation.");
    let restored = null;
    if (files) restored = await this.withQuery(key, sessionId, cwd, (q) => q.rewindFiles(messageId));
    const live = this.live.get(key);
    this.live.delete(key);
    live?.close();
    if (point.before) {
      this.resumeAt.set(key, point.before);
      return { fresh: false, files: restored };
    }
    this.resumeAt.delete(key);
    await deleteSession(sessionId, { dir: cwd }).catch(() => {});
    return { fresh: true, files: restored };
  }

  async setEffort(key, level) {
    await this.live.get(key)?.query.applyFlagSettings({ effortLevel: level || null });
  }

  async setFast(key, on) {
    await this.live.get(key)?.query.applyFlagSettings({ fastMode: Boolean(on) });
  }

  async context(key) {
    const live = this.live.get(key);
    if (!live) return null;
    const usage = await live.query.getContextUsage({ detail: 'summary' });
    return { percentage: usage.percentage, totalTokens: usage.totalTokens, maxTokens: usage.maxTokens, model: usage.model };
  }

  // Slash commands for a running conversation, or the general list before one starts.
  async commands(key) {
    const q = this.live.get(key)?.query || this.probe();
    return (await q.supportedCommands()).map(({ name, description, argumentHint }) => ({ name, description, argumentHint }));
  }

  interrupt(key) {
    return this.live.get(key)?.query.interrupt();
  }

  async setMode(key, mode) {
    await this.live.get(key)?.setMode(mode);
  }

  async setModel(key, model) {
    await this.live.get(key)?.query.setModel(model || undefined);
  }

  // An idle Claude process for account-level questions (the model list)
  // that works before any conversation starts. It never sends a prompt, and it
  // shuts down after two quiet minutes.
  probe() {
    clearTimeout(this.probeTimer);
    this.probeTimer = setTimeout(() => this.closeProbe(), 120000);
    if (!this.probeQuery) {
      const q = query({
        prompt: new InputQueue(),
        // User-level settings so your saved prompts (custom commands) are listed.
        options: { cwd: os.homedir(), settingSources: ['user'], persistSession: false, tools: [], env: this.env?.() },
      });
      this.probeQuery = q;
      (async () => {
        try {
          for await (const _ of q);
        } catch {}
        if (this.probeQuery === q) this.probeQuery = null;
      })();
    }
    return this.probeQuery;
  }

  closeProbe() {
    clearTimeout(this.probeTimer);
    this.probeQuery?.close();
    this.probeQuery = null;
  }

  models() {
    return this.probe().supportedModels();
  }

  respond(key, id, decision) {
    return this.live.get(key)?.respond(id, decision);
  }

  close(key) {
    this.live.get(key)?.close();
  }

  closeAll() {
    for (const session of this.live.values()) session.close();
    this.closeProbe();
  }
}
