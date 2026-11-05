// A centered dialog over the window. Esc or clicking outside closes it (as Cancel).
import { h } from './tools.js';

let current = null;

// actions: [{ label, primary?, danger?, run }]; run may return false to keep it open.
export function openModal({ title, body, actions = [], wide = false, onClose }) {
  closeModal();
  const footer = h('div', { class: 'modal-actions' });
  const dialog = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div', { class: 'modal-title' }, title), h('div', { class: 'modal-body' }, body), footer);
  const backdrop = h('div', { class: 'modal-backdrop', onmousedown: (e) => e.target === backdrop && closeModal() }, dialog);
  for (const action of actions) {
    footer.append(
      h(
        'button',
        {
          class: `btn${action.primary ? ' primary' : ''}${action.danger ? ' link danger-link' : ''}`,
          // Buttons stay off while an action runs, so a double click can't run it twice.
          onclick: async () => {
            const buttons = [...footer.querySelectorAll('button')];
            const wasDisabled = buttons.map((b) => b.disabled);
            buttons.forEach((b) => (b.disabled = true));
            let keepOpen = false;
            try {
              keepOpen = (await action.run?.()) === false;
            } finally {
              buttons.forEach((b, i) => (b.disabled = wasDisabled[i]));
            }
            if (!keepOpen) closeModal();
          },
        },
        action.label,
      ),
    );
  }
  document.body.append(backdrop);
  current = { backdrop, onClose };
  requestAnimationFrame(() => dialog.querySelector('textarea, input, button')?.focus());
  return { close: closeModal, footer };
}

export function closeModal() {
  const closing = current;
  current = null;
  closing?.backdrop.remove();
  closing?.onClose?.();
}

export const modalOpen = () => Boolean(current);
