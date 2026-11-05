// Permission rules: the allow / ask / deny lists Claude Code checks before using a tool.
// "Always allow" on a permission card adds rules here; this screen lets you see, add and
// remove them, for all projects or just the current one.
import { openModal } from './modal.js';
import { h, ICONS, svg } from './tools.js';

const KINDS = [
  ['allow', 'Allow', 'Runs without asking'],
  ['ask', 'Ask', 'Always asks, even in auto-accept mode'],
  ['deny', 'Deny', 'Never allowed'],
];
const EXAMPLES = 'Examples: Bash(pytest:*) · Bash(git status) · Edit(src/**) · Read(~/data/**) · WebFetch(domain:docs.python.org) · WebSearch';

export async function openPermissionsPanel({ api, cwd }) {
  const files = await api.permissions.read(cwd);
  const original = JSON.stringify(files.map((f) => f.rules));
  let current = files[0].scope;

  const tabs = h('div', { class: 'modal-tabs', role: 'tablist' });
  const where = h('div', { class: 'path-link' });
  const saveError = h('div', { class: 'note error', hidden: true });
  const lists = h('div', { class: 'rule-groups' });
  const ruleInput = h('input', { type: 'text', placeholder: 'Bash(npm test:*)', 'aria-label': 'New rule' });
  const kindSelect = h('select', { 'aria-label': 'Rule type' }, KINDS.map(([k, label]) => h('option', { value: k }, label)));
  const fileFor = () => files.find((f) => f.scope === current);

  function render() {
    const file = fileFor();
    for (const tab of tabs.children) tab.setAttribute('aria-selected', String(tab.dataset.scope === current));
    where.textContent = file.invalid
      ? `${file.path} has a JSON error, so its rules can't be shown or saved here. Fix the file first.`
      : file.exists
        ? file.path
        : `${file.path} (created when you save)`;
    lists.replaceChildren(
      ...KINDS.map(([kind, label, hint]) =>
        h(
          'div',
          { class: 'rule-group' },
          h('div', { class: 'rule-head' }, h('span', { class: `rule-kind ${kind}` }, label), h('span', { class: 'settings-hint' }, hint)),
          file.rules[kind].length
            ? h(
                'div',
                { class: 'rule-chips' },
                file.rules[kind].map((rule, i) =>
                  h(
                    'span',
                    { class: 'rule-chip' },
                    rule,
                    h('button', { title: 'Remove', 'aria-label': `Remove ${rule}`, onclick: () => (file.rules[kind].splice(i, 1), render()) }, svg(ICONS.x)),
                  ),
                ),
              )
            : h('div', { class: 'settings-hint rule-none' }, 'None'),
        ),
      ),
    );
  }

  function addRule() {
    const rule = ruleInput.value.trim();
    if (!rule) return;
    const list = fileFor().rules[kindSelect.value];
    if (!list.includes(rule)) list.push(rule);
    ruleInput.value = '';
    render();
  }
  ruleInput.addEventListener('keydown', (e) => e.key === 'Enter' && addRule());

  tabs.append(
    ...files.map((f) =>
      h(
        'button',
        { role: 'tab', 'data-scope': f.scope, onclick: () => ((current = f.scope), render()) },
        f.label,
      ),
    ),
  );

  openModal({
    title: 'Permission rules',
    wide: true,
    body: h(
      'div',
      {},
      tabs,
      cwd ? null : h('div', { class: 'settings-hint' }, 'Choose a project folder to see its own rules too.'),
      lists,
      h('div', { class: 'rule-add' }, kindSelect, ruleInput, h('button', { class: 'btn', onclick: addRule }, 'Add')),
      h('div', { class: 'settings-hint' }, EXAMPLES),
      where,
      saveError,
    ),
    actions: [
      {
        label: 'Save',
        primary: true,
        run: async () => {
          const before = JSON.parse(original);
          try {
            for (const [i, file] of files.entries()) {
              if (JSON.stringify(file.rules) !== JSON.stringify(before[i])) await api.permissions.write(file.scope, cwd, file.rules);
            }
          } catch (error) {
            saveError.textContent = String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
            saveError.hidden = false;
            return false;
          }
        },
      },
      { label: 'Cancel' },
    ],
  });
  render();
}
