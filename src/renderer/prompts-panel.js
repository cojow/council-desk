// Saved prompts: your own / commands, stored as Claude Code custom commands so they
// also work in Claude Code in the terminal.
import { openModal } from './modal.js';
import { h } from './tools.js';

const toName = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

// While typing, each character maps to exactly one (A-Z lowercased, anything outside
// a-z 0-9 _ - becomes "-"), so the caret stays where it was; toName tidies it on save.
const typedName = (text) =>
  String(text)
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[^a-z0-9_-]/g, '-');

// draft: optional text to start a new prompt from (e.g. what's in the message box).
// onChange: called after prompts are added, edited or removed.
export async function openPromptsPanel({ api, draft = '', onChange }) {
  const listEl = h('div', { class: 'prompt-list' });
  const formEl = h('div', { class: 'prompt-form', hidden: true });
  const error = h('div', { class: 'note error', hidden: true });
  let editing = null;

  async function renderList() {
    const prompts = await api.prompts.list();
    listEl.replaceChildren(
      ...(prompts.length
        ? prompts.map((p) =>
            h(
              'div',
              { class: 'prompt-row' },
              h('div', { class: 'prompt-text' }, h('span', { class: 'prompt-name' }, `/${p.name}`), h('span', { class: 'settings-hint' }, p.description || p.body.slice(0, 80))),
              h('button', { class: 'btn link', onclick: () => showForm(p) }, 'Edit'),
              h(
                'button',
                {
                  class: 'btn link danger-link',
                  onclick: async () => {
                    await api.prompts.remove(p.name);
                    onChange?.();
                    renderList();
                  },
                },
                'Delete',
              ),
            ),
          )
        : [h('div', { class: 'settings-hint' }, 'No saved prompts yet. They show up in the / menu as your own commands.')]),
      h('button', { class: 'btn', onclick: () => showForm(null) }, '+ New prompt'),
    );
  }

  function showForm(prompt) {
    editing = prompt;
    error.hidden = true;
    const name = h('input', { type: 'text', value: prompt?.name || (draft ? toName(draft.split(/\s+/).slice(0, 4).join(' ')) : ''), placeholder: 'explain-plot' });
    const description = h('input', { type: 'text', value: prompt?.description || '', placeholder: 'What it does (shown in the / menu)' });
    const body = h('textarea', { class: 'memory-text', rows: 9, placeholder: 'Explain this plot in plain language and point out anything odd: $ARGUMENTS' });
    body.value = prompt?.body || draft;
    const tidyTyping = () => {
      const fixed = typedName(name.value);
      if (fixed === name.value) return;
      const { selectionStart, selectionEnd } = name;
      name.value = fixed;
      name.setSelectionRange(selectionStart, selectionEnd);
    };
    // Not while an input method is still composing a character.
    name.addEventListener('input', (e) => !e.isComposing && tidyTyping());
    name.addEventListener('compositionend', tidyTyping);
    formEl.replaceChildren(
      h('label', { class: 'field' }, h('span', {}, 'Name (you type it as /name)'), name),
      h('label', { class: 'field' }, h('span', {}, 'Description'), description),
      h('label', { class: 'field' }, h('span', {}, 'Prompt'), body),
      h('div', { class: 'settings-hint' }, 'Put $ARGUMENTS where anything you type after the command should go.'),
      error,
      h(
        'div',
        { class: 'settings-actions' },
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              try {
                await api.prompts.save({ name: toName(name.value), description: description.value, body: body.value, previousName: editing?.name });
                onChange?.();
                formEl.hidden = true;
                listEl.hidden = false;
                renderList();
              } catch (e) {
                error.textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': Error: /, '');
                error.hidden = false;
              }
            },
          },
          'Save prompt',
        ),
        h('button', { class: 'btn', onclick: () => ((formEl.hidden = true), (listEl.hidden = false)) }, 'Back'),
      ),
    );
    listEl.hidden = true;
    formEl.hidden = false;
    name.focus();
  }

  await renderList();
  openModal({ title: 'Saved prompts', wide: true, body: h('div', {}, listEl, formEl), actions: [{ label: 'Done' }] });
  if (draft) showForm(null);
}
