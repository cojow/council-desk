// The Changes panel: every file that differs from the last commit (git), each with its
// diff. Outside a git repository it lists the edits Claude made in this session instead.
import { diffLines, diffView, h, ICONS, svg } from './tools.js';

// Splits a unified patch into { path: lines[] }.
function parsePatch(patch) {
  const files = new Map();
  let current = null;
  for (const line of patch.split('\n')) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      current = [];
      files.set(header[2], current);
      continue;
    }
    if (!current || /^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/.test(line)) continue;
    current.push(line);
  }
  return files;
}

function patchView(lines) {
  const view = h('div', { class: 'diff' });
  for (const line of lines) {
    if (line.startsWith('@@')) view.append(h('div', { class: 'diff-line gap' }, line.replace(/^@@ [^@]+ @@ ?/, '⋯ ') || '⋯'));
    else if (line.startsWith('+')) view.append(h('div', { class: 'diff-line add' }, line.slice(1) || ' '));
    else if (line.startsWith('-')) view.append(h('div', { class: 'diff-line del' }, line.slice(1) || ' '));
    else if (line.startsWith('\\')) continue;
    else view.append(h('div', { class: 'diff-line' }, line.slice(1) || ' '));
  }
  return view;
}

export function createChangesPanel({ api, container, getCwd, getSessionEdits, onOpenFile, onShow }) {
  let open = false;
  const expanded = new Set();

  function close() {
    open = false;
    container.hidden = true;
    container.replaceChildren();
    document.body.classList.remove('changes-open');
  }

  function fileSection({ path, status, additions, deletions, binary }, body, fullPath) {
    const isOpen = expanded.has(path);
    const section = h('div', { class: `change-file${isOpen ? ' open' : ''}` });
    const head = h(
      'button',
      {
        class: 'change-head',
        onclick: () => {
          if (expanded.has(path)) expanded.delete(path);
          else expanded.add(path);
          section.classList.toggle('open');
          bodyEl.hidden = !section.classList.contains('open');
        },
      },
      h('span', { class: 'tool-chev' }, svg(ICONS.chev)),
      h('span', { class: `change-status ${status}` }, status === 'added' ? 'A' : status === 'edited' ? 'E' : 'M'),
      h('span', { class: 'change-path', title: path }, path),
      binary ? h('span', { class: 'muted' }, 'binary') : h('span', { class: 'change-counts' }, h('span', { class: 'plus' }, `+${additions}`), ' ', h('span', { class: 'minus' }, `−${deletions}`)),
      fullPath ? h('span', { class: 'btn link change-open', role: 'button', onclick: (e) => (e.stopPropagation(), onOpenFile(fullPath)) }, 'Open') : null,
    );
    const bodyEl = h('div', { class: 'change-body', hidden: !isOpen }, body);
    section.append(head, bodyEl);
    return section;
  }

  let latest = 0; // only the newest render may fill the panel (you may switch sessions meanwhile)

  async function render() {
    const ticket = ++latest;
    const cwd = getCwd();
    const body = h('div', { class: 'changes-body' }, h('div', { class: 'muted viewer-note' }, 'Loading…'));
    const summary = h('span', { class: 'viewer-path' }, '');
    container.replaceChildren(
      h(
        'div',
        { class: 'viewer-head' },
        h('div', { class: 'viewer-title' }, h('span', { class: 'viewer-name' }, 'Changes'), summary),
        h('button', { class: 'btn link', title: 'Refresh', onclick: render }, 'Refresh'),
        h('button', { class: 'icon-btn', title: 'Close (Esc)', 'aria-label': 'Close', onclick: close }, svg(ICONS.x)),
      ),
      body,
    );
    if (!cwd) {
      body.replaceChildren(h('div', { class: 'muted viewer-note' }, 'Choose a project folder first.'));
      return;
    }
    const result = await api.git.changes(cwd).catch((error) => ({ error }));
    if (!open || ticket !== latest) return;
    if (result.error) {
      body.replaceChildren(h('div', { class: 'note error viewer-note' }, `Could not read changes: ${result.error.message}`));
      return;
    }

    if (!result.isRepo) {
      // Not a git repository: show what Claude edited in this session.
      const edits = getSessionEdits();
      summary.textContent = 'Not a git repository · edits from this session';
      if (!edits.length) {
        body.replaceChildren(h('div', { class: 'muted viewer-note' }, "This folder isn't a git repository, and Claude hasn't edited any files in this session yet."));
        return;
      }
      const byFile = new Map();
      for (const e of edits) byFile.set(e.path, [...(byFile.get(e.path) || []), e]);
      body.replaceChildren(
        ...[...byFile].map(([file, list]) => {
          const views = list.map((e) => diffView(diffLines(e.before, e.after)));
          const counts = list.map((e) => diffLines(e.before, e.after)).flat();
          return fileSection(
            { path: file.replace(`${cwd}/`, ''), status: 'edited', additions: counts.filter((l) => l.k === 'add').length, deletions: counts.filter((l) => l.k === 'del').length },
            h('div', { class: 'change-diffs' }, views),
            file,
          );
        }),
      );
      return;
    }

    const patches = parsePatch(result.patch);
    const totalAdd = result.files.reduce((n, f) => n + f.additions, 0);
    const totalDel = result.files.reduce((n, f) => n + f.deletions, 0);
    summary.textContent = `${result.branch ? `${result.branch} · ` : ''}${result.files.length} file${result.files.length === 1 ? '' : 's'} · +${totalAdd} −${totalDel} since the last commit`;
    if (!result.files.length) {
      body.replaceChildren(h('div', { class: 'muted viewer-note' }, 'No changes since the last commit.'));
      return;
    }
    if (expanded.size === 0 && result.files.length <= 6) result.files.forEach((f) => expanded.add(f.path));
    body.replaceChildren(
      ...(result.truncated ? [h('div', { class: 'note viewer-note' }, 'The changes are very large; only the first part is shown.')] : []),
      ...result.files.map((f) => {
        const diff = f.binary
          ? h('div', { class: 'muted viewer-note' }, 'Binary file; no text diff.')
          : f.status === 'added'
            ? diffView((f.content || '').replace(/\n$/, '').split('\n').map((t) => ({ t, k: 'add' })), 400)
            : patchView(patches.get(f.path) || []);
        return fileSection(f, diff, `${result.root}/${f.path}`);
      }),
    );
  }

  return {
    async open() {
      onShow?.();
      open = true;
      container.hidden = false;
      document.body.classList.add('changes-open');
      await render();
    },
    close,
    toggle() {
      return open ? close() : this.open();
    },
    refresh: () => open && render(),
    isOpen: () => open,
  };
}
