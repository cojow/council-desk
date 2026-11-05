// One conversation's transcript: turns SDK messages (live or from history) into DOM.
import { renderMarkdown } from './markdown.js';
import { groupSummary, h, ICONS, inputView, relPath, resultText, resultView, summarize, svg, todoView } from './tools.js';

const HIDDEN_USER_TEXT = /^\s*<(command-|local-command|system-reminder|bash-|user-prompt-submit-hook)/;

export class Conversation {
  constructor({ key, sessionId = null, cwd = null, title = '', mode = 'default', model = '', api, onRespond }) {
    Object.assign(this, { key, sessionId, cwd, title, mode, model, api, onRespond });
    this.el = h('div', { class: 'transcript' });
    this.tools = new Map();
    this.cards = new Map();
    this.stream = null;
    this.todoEl = null;
    this.working = null;
    this.busy = false;
    this.loaded = false;
    this.hasMessages = false;
  }

  append(node) {
    // Anything other than a tool step ends the current run of steps.
    if (node !== this.group?.el) this.group = null;
    if (this.working?.isConnected) this.el.insertBefore(node, this.working);
    else this.el.append(node);
    this.hasMessages = true;
    return node;
  }

  // attachments: [{ kind: 'image' | 'file', name, preview? }]
  // uuid: the message's id in the session, which "Rewind to here" needs.
  addUser(text, attachments = [], uuid = null) {
    const extras = attachments.length
      ? h(
          'div',
          { class: 'bubble-attachments' },
          attachments.map((a) =>
            a.preview
              ? h('img', { src: a.preview, alt: a.name || '' })
              : h('span', { class: `file${a.path ? ' file-link' : ''}`, title: a.path || '', onclick: () => a.path && this.onOpenFile?.(a.path) }, a.name),
          ),
        )
      : null;
    const rewind = uuid
      ? h('button', { class: 'icon-btn rewind-btn', title: 'Rewind to here: go back to before this message, and undo the file changes made since', 'aria-label': 'Rewind to here', onclick: () => this.onRewind?.({ uuid, text, node }) }, svg(ICONS.rewind))
      : null;
    const node = h('div', { class: 'msg-user' }, extras, h('div', { class: 'msg-user-row' }, rewind, text ? h('div', { class: 'bubble' }, text) : null));
    if (uuid) node.dataset.uuid = uuid;
    this.append(node);
  }

  // Removes `node` and everything after it (used by Rewind).
  truncateFrom(node) {
    while (node) {
      const next = node.nextSibling;
      if (node !== this.working) node.remove();
      node = next;
    }
    this.stream = null;
    this.group = null;
    if (!this.todoEl?.isConnected) this.todoEl = null;
    this.hasMessages = [...this.el.children].some((child) => child !== this.working);
  }

  addText(text) {
    const el = this.append(h('div', { class: 'msg-text' }));
    renderMarkdown(el, text);
    return el;
  }

  addNote(text, kind = '') {
    this.append(h('div', { class: `note ${kind}` }, text));
  }

  // ---- tool rows ----

  addToolUse(block) {
    if (block.name === 'TodoWrite') {
      const view = todoView(block.input?.todos);
      if (this.todoEl?.isConnected) this.todoEl.replaceWith(view);
      else this.append(view);
      this.todoEl = view;
      this.tools.set(block.id, { name: block.name, row: null });
      return;
    }
    const s = summarize(block.name, block.input, this.cwd);
    // File tools: the file name opens the file viewer.
    const filePath = ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(block.name) && (block.input?.file_path || block.input?.notebook_path);
    const row = h('div', { class: 'tool running' });
    const body = h('div', { class: 'tool-body', hidden: true });
    const entry = { name: block.name, input: block.input, row, body, result: null, isError: false, steps: 0, extraEl: null };
    entry.extraEl = h('span', { class: 'tool-extra' }, s.extra || '');
    const head = h(
      'button',
      {
        class: 'tool-head',
        onclick: () => {
          const open = row.classList.toggle('open');
          body.hidden = !open;
          if (open) this.fillToolBody(entry);
        },
      },
      h('span', { class: 'tool-status' }),
      h('span', { class: 'tool-verb' }, s.verb),
      s.target
        ? h(
            'span',
            filePath
              ? { class: 'tool-target file-link', title: `Open ${filePath}`, onclick: (e) => (e.stopPropagation(), this.onOpenFile?.(filePath)) }
              : { class: 'tool-target', title: s.target },
            s.target,
          )
        : null,
      entry.extraEl,
      h('span', { class: 'tool-chev' }, svg(ICONS.chev)),
    );
    row.append(head, body);
    this.addToGroup(entry);
    this.tools.set(block.id, entry);
  }

  // ---- runs of tool steps ----
  // Steps in a row (between Claude's messages) fold into one summary line, like "Ran 3
  // commands, read 2 files", with a spinner while one runs; click it to see each step.
  // A run of one step shows that step as it is.

  addToGroup(entry) {
    if (!this.group) {
      const el = h('div', { class: 'tool-group single' });
      const group = { el, entries: [], open: false };
      group.status = h('span', { class: 'tool-status' });
      group.label = h('span', { class: 'tool-verb' });
      group.extra = h('span', { class: 'tool-extra' });
      group.rows = h('div', { class: 'tool-group-rows' });
      group.head = h(
        'button',
        {
          class: 'tool-head tool-group-head',
          onclick: () => {
            group.open = !group.open;
            this.renderGroup(group);
          },
        },
        group.status,
        group.label,
        group.extra,
        h('span', { class: 'tool-chev' }, svg(ICONS.chev)),
      );
      el.append(group.head, group.rows);
      this.group = group;
      this.append(el);
    }
    entry.group = this.group;
    this.group.entries.push(entry);
    this.group.rows.append(entry.row);
    this.renderGroup(this.group);
  }

  renderGroup(group) {
    const single = group.entries.length === 1;
    const running = group.entries.filter((e) => e.row.classList.contains('running'));
    const failed = group.entries.filter((e) => e.row.classList.contains('err')).length;
    group.el.classList.toggle('single', single);
    group.el.classList.toggle('open', group.open);
    group.rows.hidden = !single && !group.open;
    if (single) return;
    group.el.classList.toggle('running', running.length > 0);
    group.el.classList.toggle('err', !running.length && failed > 0);
    group.el.classList.toggle('ok', !running.length && !failed);
    group.status.replaceChildren(running.length ? '' : svg(failed ? ICONS.x : ICONS.check));
    group.label.textContent = groupSummary(group.entries);
    const now = running.at(-1);
    group.extra.textContent = now ? `· ${now.row.querySelector('.tool-verb')?.textContent || ''} ${now.row.querySelector('.tool-target')?.textContent || ''}`.trimEnd() : failed ? `· ${failed} failed` : '';
  }

  fillToolBody(entry) {
    const parts = [inputView(entry.name, entry.input, this.cwd), resultView(entry.name, entry.result, entry.isError)].filter(Boolean);
    entry.body.replaceChildren(...(parts.length ? parts : [h('div', { class: 'tool-label' }, 'No details')]));
  }

  setToolResult(id, content, isError) {
    const entry = this.tools.get(id);
    if (!entry?.row) return;
    entry.result = resultText(content);
    entry.isError = Boolean(isError);
    this.finishRow(entry, isError ? 'err' : 'ok');
    if (entry.row.classList.contains('open')) this.fillToolBody(entry);
  }

  finishRow(entry, outcome) {
    entry.row.classList.remove('running');
    if (outcome) entry.row.classList.add(outcome);
    const status = entry.row.querySelector('.tool-status');
    status.replaceChildren(outcome ? svg(outcome === 'err' ? ICONS.x : ICONS.check) : '');
    if (entry.group) this.renderGroup(entry.group);
  }

  // Rows left spinning after an interrupt or at the end of history.
  settleRows() {
    for (const entry of this.tools.values()) if (entry.row?.classList.contains('running')) this.finishRow(entry, null);
  }

  countSubagentStep(parentId, n) {
    const entry = this.tools.get(parentId);
    if (!entry?.extraEl) return;
    entry.steps += n;
    entry.extraEl.textContent = `${entry.steps} step${entry.steps === 1 ? '' : 's'}`;
  }

  // ---- working indicator ----

  setBusy(busy) {
    this.busy = busy;
    this.el.classList.toggle('busy', busy);
    if (busy && !this.working?.isConnected) {
      const label = h('span', {}, 'Working…');
      const elapsed = h('span', { class: 'muted' });
      const started = Date.now();
      this.working = h('div', { class: 'working' }, h('span', { class: 'mark' }, svg(ICONS.mark)), label, elapsed);
      this.working.label = label;
      this.working.timer = setInterval(() => {
        const s = Math.round((Date.now() - started) / 1000);
        elapsed.textContent = s >= 3 ? `${s}s` : '';
      }, 1000);
      this.el.append(this.working);
    } else if (!busy && this.working) {
      clearInterval(this.working.timer);
      this.working.remove();
      this.working = null;
      this.settleRows();
    }
  }

  setWorkingLabel(text) {
    if (this.working) this.working.label.textContent = text;
  }

  // ---- live SDK messages ----

  handleSdk(msg) {
    switch (msg.type) {
      case 'stream_event':
        if (!msg.parent_tool_use_id) this.handleStreamEvent(msg.event);
        break;
      case 'assistant':
        if (msg.parent_tool_use_id) {
          const n = msg.message.content.filter((b) => b.type === 'tool_use').length;
          if (n) this.countSubagentStep(msg.parent_tool_use_id, n);
          break;
        }
        if (msg.error) {
          const text = msg.message.content.map((b) => b.text || '').join('').trim();
          this.stream = null;
          this.addNote(text || `Error: ${msg.error}`, 'error');
          break;
        }
        this.handleAssistantBlocks(msg.message.content);
        break;
      case 'user':
        if (!msg.parent_tool_use_id) this.handleUserContent(msg.message.content, { live: true });
        break;
      case 'result':
        this.stream = null;
        if (msg.subtype !== 'success' || msg.is_error) {
          const detail = msg.errors?.join('\n') || msg.result || msg.subtype;
          if (detail && !/interrupt/i.test(detail)) this.addNote(detail, 'error');
        }
        this.settleRows();
        break;
      case 'system':
        if (msg.subtype === 'compact_boundary') this.append(h('div', { class: 'divider' }, 'Conversation compacted'));
        if (msg.subtype === 'api_retry') this.setWorkingLabel('Retrying…');
        if (msg.subtype === 'local_command_output' && msg.content?.trim()) this.addText(msg.content);
        break;
    }
  }

  handleStreamEvent(event) {
    if (event.type === 'content_block_start') {
      const kind = event.content_block?.type;
      if (kind === 'text') {
        const el = this.append(h('div', { class: 'msg-text' }));
        this.stream = { el, text: '', frame: 0 };
        this.setWorkingLabel('Writing…');
      } else if (kind === 'thinking' || kind === 'redacted_thinking') {
        this.setWorkingLabel('Thinking…');
      } else if (kind === 'tool_use') {
        this.setWorkingLabel('Working…');
      }
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && this.stream) {
      const stream = this.stream;
      stream.text += event.delta.text;
      if (!stream.frame) {
        stream.frame = requestAnimationFrame(() => {
          stream.frame = 0;
          renderMarkdown(stream.el, stream.text);
          this.onUpdate?.();
        });
      }
    }
  }

  handleAssistantBlocks(blocks) {
    for (const block of blocks) {
      if (block.type === 'text') {
        if (this.stream) {
          cancelAnimationFrame(this.stream.frame);
          renderMarkdown(this.stream.el, block.text);
          this.stream = null;
        } else if (block.text.trim()) {
          this.addText(block.text);
        }
      } else if (block.type === 'tool_use') {
        this.addToolUse(block);
      }
    }
  }

  handleUserContent(content, { live = false, uuid = null } = {}) {
    if (typeof content === 'string') {
      if (!live) this.addUserText(content, [], uuid);
      return;
    }
    const texts = [];
    const images = [];
    for (const block of content || []) {
      if (block.type === 'tool_result') this.setToolResult(block.tool_use_id, block.content, block.is_error);
      else if (block.type === 'text') texts.push(block.text);
      else if (block.type === 'image' && block.source?.type === 'base64')
        images.push({ kind: 'image', name: 'Image', preview: `data:${block.source.media_type};base64,${block.source.data}` });
    }
    if (!live && (texts.length || images.length)) this.addUserText(texts.join('\n'), images, uuid);
  }

  addUserText(text, images = [], uuid = null) {
    if (HIDDEN_USER_TEXT.test(text)) return;
    if (/^\[Request interrupted by user/.test(text)) return this.addNote('Interrupted');
    if (/^Caveat: The messages below were generated/.test(text)) return;
    // Files attached in this app are listed at the end of the message text.
    const files = [];
    const match = text.match(/\n*Attached files:\n((?:- .+\n?)+)$/);
    if (match) {
      text = text.slice(0, match.index).trim();
      for (const line of match[1].trim().split('\n')) {
        const path = line.replace(/^- /, '');
        files.push({ kind: 'file', name: path.split('/').pop(), path });
      }
    }
    if (text === 'See the attached image.' && images.length) text = '';
    this.addUser(text, [...images, ...files], uuid);
  }

  // ---- history from disk ----

  loadHistory(messages) {
    for (const m of messages) {
      if (m.parent_tool_use_id) continue;
      const message = m.message || {};
      if (m.type === 'assistant') this.handleAssistantBlocks(Array.isArray(message.content) ? message.content : []);
      else if (m.type === 'user') this.handleUserContent(message.content, { uuid: m.uuid });
    }
    this.settleRows();
    this.loaded = true;
  }

  // ---- permission, question and plan cards ----

  showPermission(ev) {
    let card;
    if (ev.toolName === 'AskUserQuestion') card = this.questionCard(ev);
    else if (ev.toolName === 'ExitPlanMode') card = this.planCard(ev);
    else card = this.permissionCard(ev);
    this.cards.set(ev.id, card);
    this.append(card);
  }

  resolvePermission(id) {
    this.cards.get(id)?.remove();
    this.cards.delete(id);
  }

  respond(id, decision) {
    const card = this.cards.get(id);
    const controls = [...(card?.querySelectorAll('button, input, textarea') || [])];
    controls.forEach((el) => (el.disabled = true));
    // If the answer doesn't reach Claude, turn the card back on so you can try again.
    Promise.resolve(this.onRespond(this, id, decision)).catch((error) => {
      controls.forEach((el) => (el.disabled = false));
      this.addNote(`Your answer didn't reach Claude: ${String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, 'error');
    });
  }

  permissionCard(ev) {
    const name = ev.displayName || ev.toolName;
    const title = ev.title || `Allow Claude to use ${name}?`;
    const s = summarize(ev.toolName, ev.input, this.cwd);
    const preview =
      inputView(ev.toolName, ev.input, this.cwd) ||
      (s.target ? h('pre', { class: 'tool-pre' }, `${s.verb} ${s.target}`) : null);
    const feedback = h('input', {
      type: 'text',
      placeholder: 'Or tell Claude what to do instead, then press Enter',
      onkeydown: (e) => {
        if (e.key === 'Enter' && e.target.value.trim()) this.respond(ev.id, { kind: 'deny', message: e.target.value.trim() });
      },
    });
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-title' }, title),
      ev.description || ev.decisionReason ? h('div', { class: 'card-sub' }, ev.description || ev.decisionReason) : null,
      preview,
      feedback,
      h(
        'div',
        { class: 'card-actions' },
        h('button', { class: 'btn primary', onclick: () => this.respond(ev.id, { kind: 'allow' }) }, 'Allow'),
        ev.canAlwaysAllow ? h('button', { class: 'btn', onclick: () => this.respond(ev.id, { kind: 'always' }) }, 'Always allow') : null,
        h('button', { class: 'btn', onclick: () => this.respond(ev.id, { kind: 'deny' }) }, 'Deny'),
      ),
    );
  }

  questionCard(ev) {
    const questions = ev.input?.questions || [];
    const answers = new Map();
    const submit = h('button', { class: 'btn primary', disabled: true }, 'Submit');
    const refresh = () => (submit.disabled = questions.some((q) => !answers.get(q.question)?.length));
    const blocks = questions.map((q) => {
      const picked = new Set();
      const other = h('input', { type: 'text', placeholder: 'Other…' });
      // The picked options plus anything typed in Other (single choice clears one or the other).
      const current = () => (other.value.trim() ? [...picked, other.value.trim()] : [...picked]);
      const optionEls = (q.options || []).map((o) =>
        h(
          'button',
          {
            class: 'option',
            onclick: (e) => {
              const btn = e.currentTarget;
              if (!q.multiSelect) {
                picked.clear();
                btn.parentElement.querySelectorAll('.option').forEach((x) => x.classList.remove('on'));
                other.value = '';
              }
              if (picked.has(o.label)) picked.delete(o.label), btn.classList.remove('on');
              else picked.add(o.label), btn.classList.add('on');
              answers.set(q.question, current());
              refresh();
            },
          },
          h('span', { class: 'o-label' }, o.label),
          o.description ? h('span', { class: 'o-desc' }, o.description) : null,
        ),
      );
      other.addEventListener('input', () => {
        if (!q.multiSelect && other.value) {
          picked.clear();
          optionEls.forEach((x) => x.classList.remove('on'));
        }
        answers.set(q.question, current());
        refresh();
      });
      return h(
        'div',
        { class: 'question' },
        q.header ? h('div', { class: 'q-head' }, q.header) : null,
        h('div', { class: 'q-text' }, q.question),
        h('div', {}, optionEls),
        other,
      );
    });
    submit.addEventListener('click', () => {
      const result = {};
      for (const q of questions) result[q.question] = answers.get(q.question).join(', ');
      this.respond(ev.id, { kind: 'allow', answers: result });
    });
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-title' }, questions.length > 1 ? 'Claude has a few questions' : 'Claude has a question'),
      ...blocks,
      h('div', { class: 'card-actions' }, submit, h('button', { class: 'btn', onclick: () => this.respond(ev.id, { kind: 'deny', message: 'The user skipped these questions.' }) }, 'Skip')),
    );
  }

  planCard(ev) {
    const plan = ev.input?.plan;
    const planEl = plan ? h('div', { class: 'plan-body msg-text' }) : null;
    if (planEl) renderMarkdown(planEl, plan);
    const feedback = h('textarea', { rows: 2, placeholder: 'What should change? (for "Keep planning")' });
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-title' }, 'Ready to code?'),
      h('div', { class: 'card-sub' }, plan ? 'Claude wrote this plan:' : 'Claude has finished planning. The plan is in the messages above.'),
      planEl,
      feedback,
      h(
        'div',
        { class: 'card-actions' },
        h('button', { class: 'btn primary', onclick: () => this.respond(ev.id, { kind: 'allow', setMode: 'acceptEdits' }) }, 'Yes, auto-accept edits'),
        h('button', { class: 'btn', title: 'A safety check approves routine steps and asks you when unsure', onclick: () => this.respond(ev.id, { kind: 'allow', setMode: 'auto' }) }, 'Yes, in Auto mode'),
        h('button', { class: 'btn', onclick: () => this.respond(ev.id, { kind: 'allow', setMode: 'default' }) }, 'Yes, ask before edits'),
        h(
          'button',
          {
            class: 'btn',
            onclick: () =>
              this.respond(ev.id, {
                kind: 'deny',
                message: feedback.value.trim() ? `Keep planning. Feedback: ${feedback.value.trim()}` : 'Keep planning; the user is not ready to approve yet.',
              }),
          },
          'Keep planning',
        ),
      ),
    );
  }
}

export { relPath };
