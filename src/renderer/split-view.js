// Split view: a second conversation on the right, with its own small message box, so you
// can follow or answer one session while working in another. The conversation's own
// transcript element is moved here while it is split, and back when it is shown in main.
import { h, ICONS, svg } from './tools.js';

export function createSplitView({ container, onSend, onStop, onShow, tilde }) {
  let conv = null;
  let scroller = null;
  let input = null;
  let button = null;
  let title = null;

  function close() {
    if (conv?.el.parentElement === scroller) conv.el.remove();
    conv = null;
    container.hidden = true;
    container.replaceChildren();
    document.body.classList.remove('split-open');
  }

  function update() {
    if (!conv) return;
    title.textContent = conv.title || 'Session';
    button.classList.toggle('stop', Boolean(conv.busy));
    button.title = conv.busy ? 'Stop' : 'Send (Enter)';
    if (conv.hasMessages && conv.el.parentElement !== scroller) scroller.replaceChildren(conv.el);
  }

  function send() {
    if (!conv) return;
    if (conv.busy) return onStop(conv);
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    onSend(conv, text);
    update();
    scrollToBottom();
  }

  function scrollToBottom() {
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  function open(next) {
    onShow?.();
    close();
    conv = next;
    title = h('span', { class: 'viewer-name' });
    scroller = h('div', { class: 'split-scroller' });
    input = h('textarea', { class: 'split-input', rows: 2, placeholder: 'Reply in this session…' });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
      // Escape here stops this session, not the one in the main pane.
      if (e.key === 'Escape' && conv?.busy) {
        e.preventDefault();
        onStop(conv);
      }
    });
    button = h('button', { class: 'send', 'aria-label': 'Send', onclick: send }, svg('<svg class="icon-send" viewBox="0 0 20 20"><path d="M10 15.5v-11M5 9.5l5-5 5 5" /></svg>'), svg('<svg class="icon-stop" viewBox="0 0 20 20"><rect x="6" y="6" width="8" height="8" rx="1.5" /></svg>'));
    container.replaceChildren(
      h(
        'div',
        { class: 'viewer-head' },
        h('div', { class: 'viewer-title' }, title, h('span', { class: 'viewer-path' }, tilde(conv.cwd))),
        h('button', { class: 'icon-btn', title: 'Close split view', 'aria-label': 'Close split view', onclick: close }, svg(ICONS.x)),
      ),
      scroller,
      h('div', { class: 'split-composer' }, input, button),
    );
    if (conv.hasMessages) scroller.append(conv.el);
    else scroller.append(h('div', { class: 'muted viewer-note' }, 'Nothing in this session yet.'));
    container.hidden = false;
    document.body.classList.add('split-open');
    update();
    requestAnimationFrame(scrollToBottom);
  }

  return {
    open,
    close,
    update,
    scrollToBottom,
    isOpen: () => Boolean(conv),
    current: () => conv,
  };
}
