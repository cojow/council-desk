// How each tool call is summarised in a row, and what its expanded body shows.

export const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
};

export const svg = (markup) => {
  const span = document.createElement('span');
  span.innerHTML = markup;
  return span.firstElementChild;
};

export const ICONS = {
  check: '<svg viewBox="0 0 20 20"><path d="M5 10.5l3.2 3.2L15 7" /></svg>',
  x: '<svg viewBox="0 0 20 20"><path d="M6 6l8 8M14 6l-8 8" /></svg>',
  chev: '<svg viewBox="0 0 20 20"><path d="M8 5.5l4.5 4.5L8 14.5" /></svg>',
  folder: '<svg viewBox="0 0 20 20"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3.2l1.6 1.8h6.2A1.5 1.5 0 0 1 17 8.3v6.2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z" /></svg>',
  key: '<svg viewBox="0 0 20 20"><circle cx="7" cy="10" r="3.5" /><path d="M10.5 10H17M14.5 10v2.5M17 10v2" /></svg>',
  more: '<svg viewBox="0 0 20 20"><circle cx="5" cy="10" r="0.6" /><circle cx="10" cy="10" r="0.6" /><circle cx="15" cy="10" r="0.6" /></svg>',
  refresh: '<svg viewBox="0 0 20 20"><path d="M15.5 9.5a5.5 5.5 0 1 1-1.7-4" /><path d="M15.5 3.5v3h-3" /></svg>',
  rewind: '<svg viewBox="0 0 20 20"><path d="M4.5 9.5a5.5 5.5 0 1 0 1.7-4" /><path d="M4.5 3.5v3h3" /></svg>',
  // The Council Desk mark: three seats around a desk.
  mark: '<svg viewBox="0 0 24 24"><circle cx="6.5" cy="10" r="2" /><circle cx="12" cy="8" r="2" /><circle cx="17.5" cy="10" r="2" /><path d="M4.5 15.5h15" /></svg>',
};

const base = (p) => (p ? String(p).split('/').filter(Boolean).pop() : '');

export function relPath(p, cwd) {
  if (!p) return '';
  if (cwd && p.startsWith(cwd + '/')) return p.slice(cwd.length + 1);
  return p;
}

const firstLine = (s, max = 140) => {
  const line = String(s ?? '').split('\n')[0];
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
};

// { verb, target, extra } for the collapsed row.
export function summarize(name, input = {}, cwd) {
  switch (name) {
    case 'Read':
      return { verb: 'Read', target: relPath(input.file_path, cwd) };
    case 'Write':
      return { verb: 'Write', target: relPath(input.file_path, cwd) };
    case 'Edit':
    case 'MultiEdit':
      return { verb: 'Edit', target: relPath(input.file_path, cwd) };
    case 'NotebookEdit':
      return { verb: 'Edit notebook', target: relPath(input.notebook_path, cwd) };
    case 'Bash':
      return { verb: 'Ran', target: input.description ? input.description : firstLine(input.command) };
    case 'Grep':
      return { verb: 'Searched', target: input.pattern, extra: input.path ? `in ${relPath(input.path, cwd)}` : '' };
    case 'Glob':
      return { verb: 'Found files', target: input.pattern };
    case 'WebFetch':
      return { verb: 'Fetched', target: input.url };
    case 'WebSearch':
      return { verb: 'Searched the web', target: input.query };
    case 'Task':
    case 'Agent':
      return { verb: 'Agent', target: input.description || input.subagent_type || '' };
    case 'TodoWrite':
      return { verb: 'Updated tasks', target: '' };
    case 'Skill':
      return { verb: 'Skill', target: input.skill || input.name || '' };
    case 'ExitPlanMode':
      return { verb: 'Plan ready', target: '' };
    case 'AskUserQuestion':
      return { verb: 'Asked', target: input.questions?.[0]?.question || '' };
    default: {
      const mcp = name.match(/^mcp__(.+?)__(.+)$/);
      const firstString = Object.values(input).find((v) => typeof v === 'string');
      return { verb: mcp ? `${mcp[2]}` : name, target: firstString ? firstLine(firstString, 90) : '', extra: mcp ? mcp[1] : '' };
    }
  }
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// One line for a run of tool steps, like "Ran 3 commands, read 2 files".
// steps: [{ name, input }]
export function groupSummary(steps) {
  const files = (names) => new Set(steps.filter((s) => names.includes(s.name)).map((s) => s.input?.file_path || s.input?.notebook_path || s.name)).size;
  const n = (names) => steps.filter((s) => names.includes(s.name)).length;
  const parts = [];
  const edits = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
  if (n(['Bash'])) parts.push(`ran ${count(n(['Bash']), 'command', 'commands')}`);
  if (n(['Read'])) parts.push(`read ${count(files(['Read']), 'file', 'files')}`);
  if (n(edits)) parts.push(`edited ${count(files(edits), 'file', 'files')}`);
  if (n(['Grep', 'Glob'])) parts.push(`searched ${count(n(['Grep', 'Glob']), 'time', 'times')}`);
  if (n(['WebSearch'])) parts.push(`searched the web${n(['WebSearch']) > 1 ? ` ${n(['WebSearch'])} times` : ''}`);
  if (n(['WebFetch'])) parts.push(`fetched ${count(n(['WebFetch']), 'page', 'pages')}`);
  if (n(['Task', 'Agent'])) parts.push(`ran ${count(n(['Task', 'Agent']), 'agent', 'agents')}`);
  const known = ['Bash', 'Read', ...edits, 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'Task', 'Agent'];
  const servers = new Map();
  let other = 0;
  for (const s of steps) {
    if (known.includes(s.name)) continue;
    const mcp = s.name.match(/^mcp__(.+?)__/);
    if (mcp) servers.set(mcp[1], (servers.get(mcp[1]) || 0) + 1);
    else other++;
  }
  for (const [server, k] of servers) parts.push(`used ${server.replace(/^claude_ai_/, '').replace(/_/g, ' ')}${k > 1 ? ` ${k} times` : ''}`);
  if (other) parts.push(count(other, 'other step', 'other steps'));
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Line diff (LCS) with unchanged runs collapsed to a little context.
export function diffLines(oldText, newText) {
  const a = String(oldText ?? '').replace(/\n$/, '').split('\n');
  const b = String(newText ?? '').replace(/\n$/, '').split('\n');
  if (a.length * b.length > 250000) {
    return [...a.map((t) => ({ t, k: 'del' })), ...b.map((t) => ({ t, k: 'add' }))];
  }
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) out.push({ t: a[i++], k: 'same' }), j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: a[i++], k: 'del' });
    else out.push({ t: b[j++], k: 'add' });
  }
  while (i < a.length) out.push({ t: a[i++], k: 'del' });
  while (j < b.length) out.push({ t: b[j++], k: 'add' });
  return out;
}

export function diffView(lines, context = 3) {
  const el = h('div', { class: 'diff' });
  const keep = lines.map((line, idx) =>
    line.k !== 'same' || lines.slice(Math.max(0, idx - context), idx + context + 1).some((l) => l.k !== 'same'),
  );
  let skipped = 0;
  lines.forEach((line, idx) => {
    if (!keep[idx]) return void skipped++;
    if (skipped) el.append(h('div', { class: 'diff-line gap' }, `⋯ ${skipped} unchanged line${skipped > 1 ? 's' : ''}`));
    skipped = 0;
    el.append(h('div', { class: `diff-line ${line.k === 'same' ? '' : line.k}` }, line.t || ' '));
  });
  if (skipped) el.append(h('div', { class: 'diff-line gap' }, `⋯ ${skipped} unchanged line${skipped > 1 ? 's' : ''}`));
  return el;
}

const clip = (s, max = 400) => {
  const lines = String(s ?? '').split('\n');
  return lines.length > max ? lines.slice(0, max).join('\n') + `\n… ${lines.length - max} more lines` : lines.join('\n');
};

// The part of the body that comes from the tool's input (shown in rows and permission cards).
export function inputView(name, input = {}, cwd) {
  switch (name) {
    case 'Bash':
      return h('pre', { class: 'tool-pre' }, `$ ${input.command ?? ''}`);
    case 'Edit':
      return diffView(diffLines(input.old_string, input.new_string));
    case 'MultiEdit':
      return h('div', {}, ...(input.edits || []).map((e) => diffView(diffLines(e.old_string, e.new_string))));
    case 'Write':
      return diffView(clip(String(input.content ?? '').replace(/\n$/, ''), 300).split('\n').map((t) => ({ t, k: 'add' })), 300);
    case 'Read':
    case 'Glob':
    case 'Grep':
    case 'WebFetch':
    case 'WebSearch':
      return null;
    default: {
      const json = JSON.stringify(input, null, 2);
      return json && json !== '{}' ? h('pre', { class: 'tool-pre' }, clip(json, 60)) : null;
    }
  }
}

export function resultText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map((c) => (c.type === 'text' ? c.text : c.type === 'image' ? '[image]' : '')).join('\n');
  return JSON.stringify(content, null, 2);
}

export function resultView(name, text, isError) {
  if (!text && !isError) return null;
  if (!isError && ['Edit', 'MultiEdit', 'Write', 'TodoWrite'].includes(name)) return null;
  if (!isError && name === 'Read') return h('div', { class: 'tool-label' }, `${String(text).split('\n').length} lines read`);
  return h('div', {}, h('div', { class: 'tool-label' }, isError ? 'Error' : 'Output'), h('pre', { class: 'tool-pre' }, clip(text, 200)));
}

export function todoView(todos = []) {
  return h(
    'div',
    { class: 'todos' },
    h('div', { class: 'todos-title' }, 'Tasks'),
    ...todos.map((t) => h('div', { class: `todo ${t.status}` }, h('span', { class: 'box' }), h('span', { class: 'label' }, t.status === 'in_progress' ? t.activeForm || t.content : t.content))),
  );
}

export { base };
