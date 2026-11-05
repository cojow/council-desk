// The built-in terminal: a panel at the bottom with one shell per project folder.
// Switching sessions shows that folder's terminal; drag the top edge to resize.
import { FitAddon } from '../../node_modules/@xterm/addon-fit/lib/addon-fit.mjs';
import { Terminal } from '../../node_modules/@xterm/xterm/lib/xterm.mjs';
import { base, h, ICONS, svg } from './tools.js';

const RESTART_ICON = '<svg viewBox="0 0 20 20"><path d="M15.5 9.5a5.5 5.5 0 1 1-1.7-4" /><path d="M15.5 3.5v3h-3" /></svg>';

function themeFromCss() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    background: v('--code-bg'),
    foreground: v('--text'),
    cursor: v('--accent'),
    cursorAccent: v('--code-bg'),
    selectionBackground: v('--accent-soft'),
  };
}

export function createTerminalPanel({ api, container, getCwd, getHeight, setHeight }) {
  const terms = new Map(); // folder -> { term, fit, el, alive }
  let open = false;
  let current = null; // the terminal shown: a folder, or '' (no folder: your home folder)

  const title = h('span', { class: 'terminal-title' }, 'Terminal');
  const host = h('div', { class: 'terminal-host' });
  const handle = h('div', { class: 'terminal-resize', title: 'Drag to resize' });
  container.append(
    handle,
    h(
      'div',
      { class: 'terminal-head' },
      title,
      h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', title: 'Restart this terminal', 'aria-label': 'Restart terminal', onclick: () => current != null && restart(current) }, svg(RESTART_ICON)),
      h('button', { class: 'icon-btn', title: 'Hide terminal (⌃`)', 'aria-label': 'Hide terminal', onclick: () => hide() }, svg(ICONS.x)),
    ),
    host,
  );

  // Drag the top edge to resize.
  handle.addEventListener('mousedown', (down) => {
    const start = down.clientY;
    const startHeight = container.offsetHeight;
    const move = (e) => (container.style.height = `${Math.min(window.innerHeight - 220, Math.max(120, startHeight + start - e.clientY))}px`);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setHeight(container.offsetHeight);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  function fitAndResize(entry) {
    if (!open || !entry) return;
    try {
      entry.fit.fit();
      api.term.resize(entry.id, entry.term.cols, entry.term.rows);
    } catch {}
  }

  async function start(entry) {
    entry.alive = true;
    await api.term.open(entry.id, entry.folder, entry.term.cols, entry.term.rows);
  }

  function restart(folder) {
    const entry = terms.get(folder);
    if (!entry) return;
    api.term.kill(entry.id);
    entry.term.reset();
    start(entry);
  }

  function ensure(id) {
    let entry = terms.get(id);
    if (entry) return entry;
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      macOptionIsMeta: true,
      theme: themeFromCss(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const el = h('div', { class: 'terminal-instance' });
    entry = { id, folder: id, term, fit, el, alive: false };
    term.onData((data) => {
      if (!entry.alive) {
        if (data === '\r') {
          term.reset();
          start(entry);
        }
        return;
      }
      api.term.write(entry.id, data);
    });
    terms.set(id, entry);
    host.append(el);
    term.open(el);
    fit.fit();
    start(entry);
    return entry;
  }

  function showFolder(id) {
    current = id;
    const entry = ensure(id);
    title.textContent = `Terminal · ${base(entry.folder) || entry.folder}`;
    title.title = entry.folder;
    for (const e of terms.values()) e.el.hidden = e !== entry;
    requestAnimationFrame(() => {
      fitAndResize(entry);
      entry.term.focus();
    });
  }

  api.term.onEvent(({ id, data, exit }) => {
    const entry = terms.get(id);
    if (!entry) return;
    if (data) entry.term.write(data);
    if (exit !== undefined) {
      entry.alive = false;
      entry.term.write('\r\n\x1b[2m[The shell exited. Press Enter to start a new one.]\x1b[0m\r\n');
    }
  });

  new ResizeObserver(() => fitAndResize(terms.get(current))).observe(host);

  function show() {
    if (!container.style.height) container.style.height = `${getHeight() || 260}px`;
    open = true;
    container.hidden = false;
    document.body.classList.add('terminal-open');
    showFolder(getCwd() || '');
  }

  function hide() {
    open = false;
    container.hidden = true;
    document.body.classList.remove('terminal-open');
  }

  return {
    toggle: () => (open ? hide() : show()),
    show,
    hide,
    isOpen: () => open,
    // When the active session changes, show its folder's terminal.
    follow(folder) {
      if (open && folder && folder !== current) showFolder(folder);
    },
    applyTheme() {
      const theme = themeFromCss();
      for (const e of terms.values()) e.term.options.theme = theme;
    },
  };
}
