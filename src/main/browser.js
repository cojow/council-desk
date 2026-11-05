// The Browser pane, and the tools that let Claude use it: open pages, look (screenshot),
// read (text plus numbered links, buttons and fields), click, type, press keys, scroll and
// read the console. The page is a <webview> in the window with its own cookie store, so you
// see everything Claude does and can take over at any time. One browser serves every
// session. The window reports the page's id (attach); tools ask the window to show the
// pane first, since a hidden page can't be captured.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { session, webContents } from 'electron';
import { z } from 'zod';
import { toWebUrl } from '../shared/web-url.js';

export const BROWSER_PARTITION = 'persist:browser';

// Tools that only look at the page run without asking; the rest go through the usual
// permission prompt (where "Always allow" works as for any tool).
export const BROWSER_READ_ONLY = new Set(['mcp__browser__screenshot', 'mcp__browser__read_page', 'mcp__browser__console']);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

// Runs in an isolated world (the page's own scripts can't see or change it). Numbers the
// visible interactive elements with data-claude-ref and returns them plus the page text.
export const READ_PAGE = `(() => {
  for (const el of document.querySelectorAll('[data-claude-ref]')) el.removeAttribute('data-claude-ref');
  const selector = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=option], [role=switch], [role=combobox], [role=textbox], [contenteditable=""], [contenteditable=true], [onclick]';
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const clean = (s, n = 80) => String(s || '').replace(/\\s+/g, ' ').trim().slice(0, n);
  // Passwords and card or one-time codes typed into the page never go to Claude.
  const sensitive = (el) => el.type === 'password' || /password|one-time-code|cc-/.test(el.getAttribute('autocomplete') || '');
  const name = (el) => clean(el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.getAttribute('placeholder') || el.innerText || (sensitive(el) ? '' : el.value) || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('name') || '');
  const items = [];
  let n = 0;
  for (const el of document.querySelectorAll(selector)) {
    if (!visible(el) || n >= 300) continue;
    const ref = ++n;
    el.setAttribute('data-claude-ref', ref);
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? 'input:' + (el.type || 'text') : tag);
    const r = el.getBoundingClientRect();
    const inView = r.bottom > 0 && r.top < innerHeight;
    let extra = '';
    if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) extra = el.checked ? ' (checked)' : ' (unchecked)';
    else if ((tag === 'input' || tag === 'textarea') && el.value) extra = sensitive(el) ? ' (filled in)' : ' value="' + clean(el.value, 60) + '"';
    else if (tag === 'select') extra = ' selected="' + clean(el.selectedOptions?.[0]?.text, 40) + '"';
    if (tag === 'a') extra += ' -> ' + clean(el.getAttribute('href'), 80);
    items.push('[' + ref + '] ' + role + ' "' + name(el) + '"' + extra + (inView ? '' : ' (off screen)'));
  }
  const body = (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
  return { title: document.title, url: location.href, items, text: body.length > 12000 ? body.slice(0, 12000) + '\\n… (text cut off)' : body, scroll: [scrollY, document.documentElement.scrollHeight, innerHeight] };
})()`;

// Center of a numbered element, scrolled into view first.
export const LOCATE = (ref) => `(() => {
  const el = document.querySelector('[data-claude-ref="${Number(ref)}"]');
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tag: el.tagName.toLowerCase(), label: (el.getAttribute('aria-label') || el.innerText || (el.type === 'password' || /password|one-time-code|cc-/.test(el.getAttribute('autocomplete') || '') ? '' : el.value) || el.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim().slice(0, 60) };
})()`;

const HINT = { searchHint: 'web browser page website localhost open click type screenshot' };

const KEY_NAMES = {
  enter: 'Enter', return: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', backspace: 'Backspace', delete: 'Delete', space: 'Space',
  arrowup: 'Up', up: 'Up', arrowdown: 'Down', down: 'Down', arrowleft: 'Left', left: 'Left', arrowright: 'Right', right: 'Right',
  pageup: 'PageUp', pagedown: 'PageDown', home: 'Home', end: 'End',
};
const MODIFIERS = { cmd: 'meta', command: 'meta', meta: 'meta', ctrl: 'control', control: 'control', alt: 'alt', option: 'alt', shift: 'shift' };

export function createBrowser({ getWindow, log }) {
  let contents = null;
  let attachWaiters = [];
  const consoleLines = [];

  function attach(id) {
    const next = webContents.fromId(id);
    if (!next || next.getType() !== 'webview' || next.session !== session.fromPartition(BROWSER_PARTITION)) return false;
    if (next !== contents) {
      contents = next;
      contents.on('console-message', (event) => {
        const { level, message, lineNumber, sourceId } = event;
        if (/^Electron Security Warning/.test(message)) return;
        consoleLines.push(`[${level}] ${message}${sourceId ? ` (${sourceId.split('/').pop()}:${lineNumber})` : ''}`);
        if (consoleLines.length > 200) consoleLines.shift();
      });
      contents.on('destroyed', () => contents === next && (contents = null));
    }
    for (const resolve of attachWaiters.splice(0)) resolve();
    return true;
  }

  function activity(message) {
    getWindow()?.webContents.send('browser', { type: 'activity', message });
  }

  // Shows the pane (creating the page if needed) and waits until it can be driven.
  async function ready() {
    const win = getWindow();
    if (!win) throw new Error('The Council Desk window is closed.');
    win.webContents.send('browser', { type: 'show' });
    if (!contents || contents.isDestroyed()) {
      let attached;
      await Promise.race([new Promise((resolve) => attachWaiters.push((attached = resolve))), wait(10000)]);
      // After a timeout, stop waiting for this call (so waiters don't pile up).
      attachWaiters = attachWaiters.filter((resolve) => resolve !== attached);
      if (!contents) throw new Error("The browser pane didn't open.");
    }
    await wait(150);
    return contents;
  }

  const inPage = (c, code) => c.executeJavaScriptInIsolatedWorld(999, [{ code }]);

  async function settle(c) {
    await wait(400);
    for (let i = 0; i < 20 && c.isLoading(); i++) await wait(250);
  }

  const where = (c) => `Now at: ${c.getTitle() || '(no title)'} — ${c.getURL()}`;

  async function click(c, x, y, count = 1) {
    c.sendInputEvent({ type: 'mouseMove', x, y });
    c.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: count });
    c.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: count });
  }

  function press(c, combo) {
    const parts = String(combo).split('+').map((p) => p.trim()).filter(Boolean);
    const keyName = parts.pop();
    const modifiers = parts.map((p) => MODIFIERS[p.toLowerCase()]).filter(Boolean);
    const keyCode = KEY_NAMES[keyName.toLowerCase()] || keyName;
    c.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (!modifiers.some((m) => m === 'meta' || m === 'control')) {
      const char = keyCode === 'Enter' ? '\r' : keyCode === 'Space' ? ' ' : keyCode.length === 1 ? keyCode : null;
      if (char) c.sendInputEvent({ type: 'char', keyCode: char, modifiers });
    }
    c.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  }

  // Wraps a tool so errors come back to Claude as tool errors rather than crashing the turn.
  const guarded = (fn) => async (args) => {
    try {
      return await fn(args, await ready());
    } catch (error) {
      log?.(`browser tool: ${error.message}`);
      return fail(String(error.message || error));
    }
  };

  const tools = [
    tool(
      'navigate',
      "Open a web page in the Browser pane of Council Desk, which the user can see. Use 'back', 'forward' or 'reload' as the url to move through history. Pages can be the user's local dev servers (http://localhost:…) or any http(s) site. Sites may already be signed in to the user's accounts there; act only as the task needs.",
      { url: z.string().describe("Full URL (https:// is added if missing), or 'back', 'forward', 'reload'") },
      guarded(async ({ url }, c) => {
        const target = url.trim();
        if (target === 'back') c.navigationHistory.canGoBack() && c.navigationHistory.goBack();
        else if (target === 'forward') c.navigationHistory.canGoForward() && c.navigationHistory.goForward();
        else if (target === 'reload') c.reload();
        else {
          const full = toWebUrl(target);
          if (!full) return fail('Only http and https pages can be opened.');
          activity(`Opening ${full}`);
          await Promise.race([c.loadURL(full).catch((e) => (e.code === 'ERR_ABORTED' ? null : Promise.reject(e))), wait(20000)]);
        }
        await settle(c);
        return text(where(c));
      }),
      HINT,
    ),
    tool(
      'screenshot',
      'Take a screenshot of the Browser pane. Coordinates in the image are the ones click() takes. Prefer read_page for reading text and finding things to click; use screenshots when layout or images matter.',
      {},
      guarded(async (_args, c) => {
        activity('Taking a screenshot');
        const [width, height] = await inPage(c, '[innerWidth, innerHeight]');
        // Captured from the window (the page's own capture can come back black).
        const win = getWindow();
        const rect = await win.webContents.executeJavaScript(
          "(() => { const r = document.querySelector('#browser-panel webview')?.getBoundingClientRect(); return r && r.width ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null; })()",
        );
        if (!rect || !win.isVisible()) return fail("The browser pane isn't visible right now, so it can't be captured. read_page still works.");
        let image = await win.webContents.capturePage(rect);
        if (image.isEmpty()) return fail("The screenshot came back empty. read_page still works.");
        if (image.getSize().width !== width) image = image.resize({ width, height });
        return {
          content: [
            { type: 'image', data: image.toJPEG(75).toString('base64'), mimeType: 'image/jpeg' },
            { type: 'text', text: `${where(c)}\nViewport ${width}×${height}.` },
          ],
        };
      }),
      HINT,
    ),
    tool(
      'read_page',
      'Read the page in the Browser pane: its title, URL, visible text, and a numbered list of links, buttons and form fields. Use the numbers (refs) with click and type. Refs change each time you call read_page.',
      {},
      guarded(async (_args, c) => {
        activity('Reading the page');
        const page = await inPage(c, READ_PAGE);
        const [y, total, view] = page.scroll;
        return text(
          `${page.title || '(no title)'} — ${page.url}\nScrolled ${Math.round(y)} of ${Math.max(0, total - view)} px.\n\nInteractive elements:\n${page.items.join('\n') || '(none)'}\n\nPage text:\n${page.text}`,
        );
      }),
      HINT,
    ),
    tool(
      'click',
      'Click in the Browser pane: an element by its ref from read_page, or a point (x, y) from the latest screenshot.',
      { ref: z.number().int().optional().describe('Element number from read_page'), x: z.number().optional(), y: z.number().optional(), double: z.boolean().optional().describe('Double-click') },
      guarded(async ({ ref, x, y, double }, c) => {
        let label = `(${x}, ${y})`;
        if (ref != null) {
          const spot = await inPage(c, LOCATE(ref));
          if (!spot) return fail(`No element [${ref}] on the page now; call read_page again.`);
          await wait(120);
          ({ x, y } = spot);
          label = `[${ref}] ${spot.tag}${spot.label ? ` "${spot.label}"` : ''}`;
        } else if (x == null || y == null) return fail('Give a ref, or both x and y.');
        activity(`Clicking ${label}`);
        await click(c, Math.round(x), Math.round(y), double ? 2 : 1);
        await settle(c);
        return text(`Clicked ${label}. ${where(c)}`);
      }),
      HINT,
    ),
    tool(
      'type',
      'Type text into the Browser pane: into the element with the given ref (clicked first), or wherever the focus is. clear replaces what the field holds; submit presses Enter afterwards.',
      { text: z.string(), ref: z.number().int().optional(), clear: z.boolean().optional(), submit: z.boolean().optional() },
      guarded(async ({ text: value, ref, clear, submit }, c) => {
        if (ref != null) {
          const spot = await inPage(c, LOCATE(ref));
          if (!spot) return fail(`No element [${ref}] on the page now; call read_page again.`);
          await wait(120);
          await click(c, spot.x, spot.y);
          await wait(120);
        }
        activity(`Typing${ref != null ? ` into [${ref}]` : ''}`);
        // Typed through the page, replacing the selection (all of it with clear), so it works
        // without keyboard focus on the pane; insertText as a fallback for pages that refuse.
        // (Simulated keys arrive later than page scripts, so they can't be mixed in here.)
        const selectAll = clear ? "{ const el = document.activeElement; if (el && typeof el.select === 'function') el.select(); else document.execCommand('selectAll'); }" : '';
        const typed = await inPage(c, `${selectAll} document.execCommand('insertText', false, ${JSON.stringify(value)})`);
        if (!typed) await c.insertText(value);
        await wait(150);
        const now = await inPage(c, "(() => { const el = document.activeElement; if (!el || !('value' in el) || el.type === 'password' || /password|one-time-code|cc-/.test(el.getAttribute('autocomplete') || '')) return null; return String(el.value); })()");
        if (submit) {
          press(c, 'Enter');
          await settle(c);
        }
        const holds = now != null && !submit ? ` The field now holds: "${now.slice(0, 200)}".` : '';
        return text(`Typed ${value.length} characters${submit ? ' and pressed Enter' : ''}.${holds} ${where(c)}`);
      }),
      HINT,
    ),
    tool(
      'press_key',
      "Press a key in the Browser pane, optionally with modifiers: e.g. 'Enter', 'Tab', 'Escape', 'ArrowDown', 'Backspace', 'cmd+a', 'shift+Tab'.",
      { key: z.string() },
      guarded(async ({ key }, c) => {
        activity(`Pressing ${key}`);
        press(c, key);
        await settle(c);
        return text(`Pressed ${key}. ${where(c)}`);
      }),
      HINT,
    ),
    tool(
      'scroll',
      'Scroll the page in the Browser pane by about one screen per amount.',
      { direction: z.enum(['up', 'down', 'top', 'bottom']), amount: z.number().optional().describe('Screens to scroll (default 1)') },
      guarded(async ({ direction, amount = 1 }, c) => {
        activity(`Scrolling ${direction}`);
        const code =
          direction === 'top' ? 'scrollTo(0, 0)' : direction === 'bottom' ? 'scrollTo(0, document.documentElement.scrollHeight)' : `scrollBy(0, ${direction === 'up' ? '-' : ''}innerHeight * 0.85 * ${Number(amount) || 1})`;
        const pos = await inPage(c, `${code}; [scrollY, document.documentElement.scrollHeight - innerHeight]`);
        await wait(200);
        return text(`Scrolled to ${Math.round(pos[0])} of ${Math.max(0, Math.round(pos[1]))} px.`);
      }),
      HINT,
    ),
    tool(
      'console',
      "Read the Browser pane's recent console messages (errors, warnings, logs), newest last. Useful when testing a web app.",
      { clear: z.boolean().optional().describe('Empty the list after reading') },
      guarded(async ({ clear }) => {
        const lines = consoleLines.slice(-80);
        if (clear) consoleLines.length = 0;
        return text(lines.length ? lines.join('\n') : 'No console messages.');
      }),
      HINT,
    ),
  ];

  return {
    attach,
    // A fresh server per session: an MCP server instance serves one connection.
    server: () => createSdkMcpServer({ name: 'browser', version: '1.0.0', tools }),
  };
}
