// Edits CLAUDE.md, the notes Claude Code reads at the start of every session: one for the
// current project folder, one for all your projects.
import { openModal } from './modal.js';
import { base, h } from './tools.js';

const HINTS = {
  project: 'Claude reads this at the start of every session in this folder. Good for how to run and test the code, conventions, and things to avoid. It is a normal file in the project, so it can be committed with the code.',
  user: 'Claude reads this in every session, in every project. Good for how you like to work.',
};

const PLACEHOLDERS = {
  project: '# Project notes for Claude\n\n- Run the tests with: pytest -q\n- Data lives in data/raw (never edit it)\n- Use metric units',
  user: '# How I like to work\n\n- Explain changes briefly before making them\n- Prefer small, focused commits',
};

export async function openMemoryEditor({ api, cwd }) {
  const memory = await api.memory.read(cwd);
  let scope = memory.project ? 'project' : 'user';
  const drafts = { project: memory.project?.content ?? '', user: memory.user.content };

  const textarea = h('textarea', { class: 'memory-text', spellcheck: false, rows: 18 });
  const hint = h('div', { class: 'settings-hint' });
  const where = h('button', { class: 'btn link path-link', title: 'Show in Finder' });
  const tabs = h('div', { class: 'modal-tabs', role: 'tablist' });
  const saveError = h('div', { class: 'note error', hidden: true });

  function showScope(next) {
    drafts[scope] = textarea.value;
    scope = next;
    const info = memory[scope];
    textarea.value = drafts[scope];
    textarea.placeholder = PLACEHOLDERS[scope];
    hint.textContent = HINTS[scope];
    where.textContent = info.exists ? info.path : `${info.path} (new file)`;
    where.onclick = () => info.exists && api.app.reveal(info.path);
    for (const tab of tabs.children) tab.setAttribute('aria-selected', String(tab.dataset.scope === scope));
    textarea.focus();
  }

  tabs.append(
    h(
      'button',
      { role: 'tab', 'data-scope': 'project', disabled: !memory.project, title: memory.project ? cwd : 'Choose a project folder first', onclick: () => showScope('project') },
      memory.project ? `This project · ${base(cwd)}` : 'This project',
    ),
    h('button', { role: 'tab', 'data-scope': 'user', onclick: () => showScope('user') }, 'All projects'),
  );

  openModal({
    title: 'Project memory (CLAUDE.md)',
    wide: true,
    body: h('div', {}, tabs, hint, textarea, where, saveError),
    actions: [
      {
        label: 'Save',
        primary: true,
        run: async () => {
          drafts[scope] = textarea.value;
          saveError.hidden = true;
          for (const s of ['project', 'user']) {
            if (!memory[s] || drafts[s] === memory[s].content) continue;
            try {
              await api.memory.write(s, cwd, drafts[s]);
              // Saved: a retry after a later failure won't write it again.
              Object.assign(memory[s], { content: drafts[s], exists: true });
            } catch (error) {
              // Keep the dialog open with the reason, so nothing is lost.
              const which = s === 'project' ? 'this project' : 'all projects';
              saveError.textContent = `Couldn't save the notes for ${which}: ${String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`;
              saveError.hidden = false;
              return false;
            }
          }
        },
      },
      { label: 'Cancel' },
    ],
  });
  showScope(scope);
}
