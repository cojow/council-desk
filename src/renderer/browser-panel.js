// The Browser pane: a web page on the right that you and Claude share. Claude uses it
// through its browser tools (the main process drives the page); you can browse, sign in
// or take over at any time. Closing the pane only hides it, so the page stays as it was.
import { toWebUrl as toUrl } from '../shared/web-url.js';
import { h, ICONS, svg } from './tools.js';

const START = 'about:blank';

export function createBrowserPanel({ api, container, onShow }) {
  let view = null;
  let address = null;
  let status = null;
  let blank = null;
  let statusTimer = null;
  let ready = false; // the page has loaded once (webview methods work from then on)

  const icon = (markup) => svg(`<svg viewBox="0 0 20 20">${markup}</svg>`);

  function build() {
    address = h('input', { class: 'browser-address', type: 'text', spellcheck: false, placeholder: 'Type an address', 'aria-label': 'Address' });
    address.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const url = toUrl(address.value);
      // Webview methods throw until the page has loaded once; before that, set where it starts.
      if (url) ready ? view.loadURL(url).catch(() => {}) : view.setAttribute('src', url);
      view.focus();
    });
    address.addEventListener('focus', () => address.select());
    status = h('div', { class: 'browser-status', hidden: true });
    blank = h('div', { class: 'browser-blank muted' }, 'Type an address above, or ask Claude to open a page. Claude can look at, read, click and type in this browser; it asks before clicking or typing unless you chose Always allow.');
    view = document.createElement('webview');
    view.setAttribute('partition', 'persist:browser');
    view.setAttribute('src', START);
    const sync = () => {
      const url = view.getURL();
      if (document.activeElement !== address) address.value = url === START ? '' : url;
      blank.hidden = url !== START;
    };
    view.addEventListener('dom-ready', () => {
      ready = true;
      api.browser.attach(view.getWebContentsId());
      sync();
    });
    view.addEventListener('did-navigate', sync);
    view.addEventListener('did-navigate-in-page', sync);
    const button = (label, markup, onclick) => h('button', { class: 'icon-btn', title: label, 'aria-label': label, onclick }, icon(markup));
    container.replaceChildren(
      h(
        'div',
        { class: 'viewer-head browser-head' },
        button('Back', '<path d="M12 5l-5 5 5 5" />', () => ready && view.canGoBack() && view.goBack()),
        button('Forward', '<path d="M8 5l5 5-5 5" />', () => ready && view.canGoForward() && view.goForward()),
        button('Reload', '<path d="M15.5 9.5a5.5 5.5 0 1 1-1.7-4" /><path d="M15.5 3.5v3h-3" />', () => ready && view.reload()),
        address,
        button('Open in your browser', '<path d="M11 4h5v5M16 4l-7 7" /><path d="M14 12v3.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1h3.5" />', () => {
          if (!ready) return;
          const url = view.getURL();
          if (/^https?:/.test(url)) api.app.openExternal(url);
        }),
        h('button', { class: 'icon-btn', title: 'Close (the page stays open)', 'aria-label': 'Close browser', onclick: close }, svg(ICONS.x)),
      ),
      h('div', { class: 'browser-body' }, view, blank, status),
    );
  }

  function show() {
    if (!view) build();
    if (!container.hidden) return;
    onShow?.();
    container.hidden = false;
    document.body.classList.add('browser-open');
  }

  function close() {
    container.hidden = true;
    document.body.classList.remove('browser-open');
  }

  // What Claude is doing, shown under the address bar for a few seconds.
  function activity(message) {
    show();
    status.textContent = `Claude: ${message}`;
    status.hidden = false;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (status.hidden = true), 4000);
  }

  api.browser.onEvent((event) => {
    if (event.type === 'show') show();
    if (event.type === 'activity') activity(event.message);
  });

  return {
    show,
    close,
    toggle: () => (container.hidden ? show() : close()),
    isOpen: () => !container.hidden,
  };
}
