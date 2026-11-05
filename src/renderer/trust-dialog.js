// "Do you trust this folder?": asked before Claude first runs in a folder (see
// src/main/trust.js), with what the project's own settings would do once you say yes.
import { openModal } from './modal.js';
import { h } from './tools.js';

const listOf = (items, line) => h('pre', { class: 'tool-pre' }, items.map(line).join('\n'));

// The question's text, also used inline (scheduled tasks ask inside their own dialog).
export function trustDetails(cwd, { hooks = [], allowed = [], servers = [] } = {}) {
  return h(
    'div',
    {},
    h('p', {}, `Claude will read files, make edits and run commands in ${cwd}.`),
    h(
      'p',
      { class: 'settings-hint' },
      'Only trust folders whose files you trust, such as your own projects. A project downloaded from someone else can include settings that run commands by themselves or let Claude do things without asking.',
    ),
    hooks.length ? [h('div', { class: 'settings-hint' }, 'This project runs these commands by itself (hooks):'), listOf(hooks, (x) => `${x.event}: ${x.command}   (${x.file})`)] : null,
    allowed.length ? [h('div', { class: 'settings-hint' }, 'It lets Claude do these without asking:'), listOf(allowed, (x) => `${x.rule}   (${x.file})`)] : null,
    servers.length ? h('div', { class: 'settings-hint' }, `It also lists connectors (${servers.join(', ')}); those stay off until you approve them in Connectors.`) : null,
    !hooks.length && !allowed.length && !servers.length ? h('div', { class: 'settings-hint' }, 'This folder has no Claude settings of its own.') : null,
  );
}

// Resolves true once the folder is trusted (asking first if needed), false if you decline.
export async function ensureTrusted(api, cwd) {
  const check = await api.trust.check(cwd);
  if (check.trusted) return true;
  return new Promise((resolve) => {
    openModal({
      title: 'Do you trust this folder?',
      body: trustDetails(cwd, check.details),
      actions: [
        {
          label: 'Trust folder',
          primary: true,
          run: async () => {
            await api.trust.grant(cwd);
            resolve(true);
          },
        },
        { label: 'Cancel', run: () => resolve(false) },
      ],
      onClose: () => resolve(false),
    });
  });
}
