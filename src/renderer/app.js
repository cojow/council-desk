import { createBrowserPanel } from './browser-panel.js';
import { createChangesPanel } from './changes-panel.js';
import { openConnectorsPanel } from './connectors-panel.js';
import { createAttachments, createMentionMenu, createSlashMenu } from './composer.js';
import { createFileViewer } from './file-viewer.js';
import { openMemoryEditor } from './memory-editor.js';
import { closeModal, modalOpen, openModal } from './modal.js';
import { openPermissionsPanel } from './permissions-panel.js';
import { openPromptsPanel } from './prompts-panel.js';
import { openSchedulesPanel } from './schedules-panel.js';
import { settingsPanel } from './settings-panel.js';
import { createTerminalPanel } from './terminal-panel.js';
import { createSplitView } from './split-view.js';
import { currentColors, installCustomThemes, renderIcon } from './custom-themes.js';
import { applyTheme, themeEditor, themePanel } from './themes.js';
import { Conversation } from './transcript.js';
import { base, h, ICONS, svg } from './tools.js';
import { ensureTrusted } from './trust-dialog.js';

const api = window.api;
const $ = (id) => document.getElementById(id);
const el = {
  sessionList: $('session-list'),
  account: $('account'),
  host: $('transcript-host'),
  scroller: $('scroller'),
  topbar: $('topbar'),
  title: $('session-title'),
  folder: $('session-folder'),
  input: $('input'),
  folderChip: $('folder-chip'),
  mode: $('mode-select'),
  model: $('model-select'),
  effort: $('effort-select'),
  fast: $('fast-toggle'),
  meter: $('context-meter'),
  meterPct: $('context-pct'),
  send: $('send'),
  welcome: $('welcome'),
  dropOverlay: $('drop-overlay'),
};

const state = {
  info: null,
  account: null,
  settings: null,
  sessions: [],
  convs: new Map(),
  active: null,
  fastInfo: null,
  query: '',
  searchHits: new Map(), // sessionId -> matching line from inside the conversation
};

// ---------- helpers ----------

const tilde = (p) => (p && state.info && p.startsWith(state.info.home) ? '~' + p.slice(state.info.home.length) : p || '');

function timeAgo(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const nearBottom = () => el.scroller.scrollHeight - el.scroller.scrollTop - el.scroller.clientHeight < 120;
const scrollToBottom = () => (el.scroller.scrollTop = el.scroller.scrollHeight);

// The Dock badge counts permission requests waiting in any session.
function updateAttention(isNew) {
  let pending = 0;
  for (const c of state.convs.values()) pending += c.cards.size;
  api.app.attention(pending, isNew).catch(() => {});
}

// Notifies when the window isn't in front, or (`conv`) when that conversation isn't the one
// you're looking at, such as a helper session running in the background. Clicking shows it.
function notify(title, body, conv = null) {
  const inView = conv ? state.active === conv || split.current() === conv : true;
  if (document.hasFocus() && inView) return;
  try {
    const note = new Notification(title, { body, silent: false });
    if (conv) note.onclick = () => show(conv);
  } catch {}
}

let menuEl = null;
function openMenu(x, y, items) {
  closeMenu();
  menuEl = h(
    'div',
    { class: 'menu' },
    items.map((item) =>
      h('button', { class: item.danger ? 'danger' : '', onclick: () => (closeMenu(), item.run()) }, item.label),
    ),
  );
  document.body.append(menuEl);
  const rect = menuEl.getBoundingClientRect();
  menuEl.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
  menuEl.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
}
function closeMenu() {
  menuEl?.remove();
  menuEl = null;
}

// One floating panel at a time (settings, theme), anchored above the account footer.
let popover = null;
// onClose runs when the panel is dismissed (click outside, Esc, or another panel).
function openPopover(name, node, onClose) {
  closePopover();
  popover = { name, node, onClose };
  document.body.append(node);
}
function closePopover() {
  const closing = popover;
  popover = null;
  closing?.node.remove();
  closing?.onClose?.();
}
const togglePopover = (name, build) => (popover?.name === name ? closePopover() : build());

document.addEventListener('mousedown', (e) => {
  if (menuEl && !menuEl.contains(e.target)) closeMenu();
  if (popover && !popover.node.contains(e.target) && !e.target.closest('.popover-trigger')) closePopover();
});

// ---------- themes ----------

function setTheme(id) {
  applyTheme(id);
  state.settings.theme = id;
  api.settings.set({ theme: id });
  terminal.applyTheme();
  popover?.node.querySelectorAll('.theme-card').forEach((card) => card.classList.toggle('on', card.dataset.themeId === id));
}

// ---------- settings ----------

function toggleSettings() {
  togglePopover('settings', () =>
    openPopover(
      'settings',
      settingsPanel({
        api,
        settings: state.settings,
        onToggle: (key, value) => {
          state.settings[key] = value;
          return api.settings.set({ [key]: value });
        },
        onAccountChange: accountChanged,
        onOpen: (what) => {
          closePopover();
          if (what === 'permissions') openPermissionsPanel({ api, cwd: state.active?.cwd });
          if (what === 'memory') openMemoryEditor({ api, cwd: state.active?.cwd });
          if (what === 'prompts') showPrompts();
          if (what === 'schedules') showSchedules();
          if (what === 'connectors') openConnectorsPanel({ api, cwd: state.active?.cwd });
        },
      }),
    ),
  );
}

function toggleThemes() {
  togglePopover('themes', openThemes);
}

// Your themes plus edited built-ins, as one stylesheet; `draft` stands in for its saved version.
function installAllThemes(draft) {
  const customs = (state.settings.customThemes || []).filter((t) => t.id !== draft?.id);
  const edits = Object.entries(state.settings.themeOverrides || {})
    .filter(([id]) => id !== draft?.id)
    .map(([id, colors]) => ({ id, colors }));
  installCustomThemes([...customs, ...edits, ...(draft ? [draft] : [])]);
}

function saveThemeSettings(patch) {
  Object.assign(state.settings, patch);
  api.settings.set(patch);
}

function openThemes() {
  openPopover(
    'themes',
    themePanel(state.settings.theme || 'warm', setTheme, {
      customs: state.settings.customThemes || [],
      overrides: state.settings.themeOverrides || {},
      hidden: state.settings.hiddenThemes || [],
      onNew: () => openThemeEditor(null),
      onEdit: (theme, builtIn) => openThemeEditor(theme, builtIn),
      onDelete: (theme, builtIn) => deleteTheme(theme, builtIn),
      onShowHidden: () => {
        saveThemeSettings({ hiddenThemes: [] });
        openThemes();
      },
    }),
  );
}

// Built-in themes are hidden (they can be brought back); your own are deleted for good.
function deleteTheme(theme, builtIn) {
  const current = state.settings.theme || 'warm';
  if (builtIn) {
    saveThemeSettings({ hiddenThemes: [...new Set([...(state.settings.hiddenThemes || []), theme.id])] });
  } else {
    if (!confirm(`Delete your theme "${theme.name}"? This can't be undone.`)) return;
    saveThemeSettings({ customThemes: (state.settings.customThemes || []).filter((t) => t.id !== theme.id) });
    api.app.deleteThemeIcon(theme.id);
    installAllThemes();
  }
  if (current === theme.id) setTheme('warm');
  openThemes();
}

// Edits a built-in theme's colors or one of your themes (or makes a new one), previewing
// live; Cancel or clicking away undoes the preview.
function openThemeEditor(existing, builtIn = false) {
  const before = state.settings.theme || 'warm';
  const overrides = state.settings.themeOverrides || {};
  let draft;
  if (builtIn) {
    applyTheme(existing.id);
    draft = { id: existing.id, name: existing.name, colors: { ...(overrides[existing.id] || currentColors()) } };
  } else {
    draft = existing
      ? { ...existing, colors: { ...existing.colors } }
      : { id: `custom-${Date.now().toString(36)}`, name: 'My theme', colors: currentColors() };
  }
  let done = false;
  const preview = () => {
    installAllThemes(draft);
    applyTheme(draft.id);
  };
  const revert = () => {
    if (done) return;
    done = true;
    installAllThemes();
    applyTheme(before);
    terminal.applyTheme();
  };
  const finish = (theme) => {
    done = true;
    installAllThemes();
    closePopover();
    setTheme(theme);
  };
  const editor = themeEditor(draft, {
    isNew: !existing,
    builtIn,
    edited: Boolean(overrides[draft.id]),
    onChange: preview,
    onCancel: () => (revert(), closePopover()),
    onSave: async () => {
      if (builtIn) {
        saveThemeSettings({ themeOverrides: { ...overrides, [draft.id]: { ...draft.colors } } });
      } else {
        draft.name = draft.name.trim() || 'My theme';
        const saved = state.settings.customThemes || [];
        saveThemeSettings({ customThemes: existing ? saved.map((t) => (t.id === draft.id ? draft : t)) : [...saved, draft] });
      }
      await api.app.saveThemeIcon(draft.id, await renderIcon(draft.colors));
      finish(draft.id);
    },
    onReset: () => {
      const { [draft.id]: _removed, ...rest } = overrides;
      saveThemeSettings({ themeOverrides: rest });
      api.app.deleteThemeIcon(draft.id);
      finish(draft.id);
    },
    onDelete: () => {
      if (!confirm(`Delete your theme "${draft.name}"? This can't be undone.`)) return;
      saveThemeSettings({ customThemes: (state.settings.customThemes || []).filter((t) => t.id !== draft.id) });
      api.app.deleteThemeIcon(draft.id);
      finish(before === draft.id ? 'warm' : before);
    },
  });
  openPopover('theme-editor', editor, revert);
  preview();
}

// ---------- models, effort and fast mode ----------

// The model list arrives in two shapes: the version in the name ("Opus 5.5") or in
// the description ("Opus" + "Opus 5.5 · Best for…"). Either way, show "Opus 5.5".
const VERSIONED = /^[A-Za-z]+ \d+(\.\d+)*\b/;

function modelName(m) {
  if (!m) return '';
  if (/\d/.test(m.displayName)) return m.displayName;
  const head = (m.description || '').split(' · ')[0].trim();
  return VERSIONED.test(head) && head.toLowerCase().startsWith(m.displayName.toLowerCase()) ? head : m.displayName;
}

function modelLabel(m) {
  const name = modelName(m);
  return /usage credits/i.test(m.description || '') ? `${name} · needs credits` : name;
}

function renderModelOptions(models) {
  const fallback = models.find((m) => m.value === 'default');
  const fallbackHead = (fallback?.description || '').split(' · ')[0].trim();
  el.model.replaceChildren(
    h('option', { value: '', title: fallback?.description || '' }, VERSIONED.test(fallbackHead) ? `Default · ${fallbackHead}` : 'Default model'),
    ...models
      .filter((m) => m.value && m.value !== 'default')
      .map((m) => h('option', { value: m.value, title: m.description || '' }, modelLabel(m))),
  );
  setSelect(el.model, state.active?.model ?? '');
}

async function loadModels() {
  if (state.settings.models?.length) renderModelOptions(state.settings.models);
  try {
    const models = await api.chat.models();
    if (!models?.length) return;
    renderModelOptions(models);
    state.settings = await api.settings.set({
      models: models.map(({ value, displayName, description }) => ({ value, displayName, description })),
    });
  } catch (error) {
    console.error('Could not load models', error);
  }
}

const FAST_REASONS = {
  extra_usage_disabled: 'Fast mode is turned off for this account.',
  model_not_allowed: 'Fast mode is not available for this model.',
  free: 'Fast mode is not available for this account.',
  preference: 'Fast mode is turned off in your Claude Code settings.',
  network_error: 'Could not check fast mode (network error).',
  disabled_by_env: 'Fast mode is disabled by an environment setting.',
};

function renderFast() {
  const conv = state.active;
  const on = Boolean(conv?.fast);
  const info = state.fastInfo;
  const blocked = on && info?.reason && info.reason !== 'sdk_opt_in_required' && info.reason !== 'pending';
  el.fast.setAttribute('aria-pressed', String(on));
  el.fast.classList.toggle('unavailable', Boolean(blocked));
  el.fast.title = blocked
    ? `${FAST_REASONS[info.reason] || `Fast mode is unavailable (${info.reason}).`} Click to turn the request off.`
    : info?.state === 'cooldown'
      ? 'Fast mode is paused after hitting a rate limit.'
      : on
        ? 'Fast mode is on: faster output at a higher price.'
        : 'Fast mode: faster output at a higher price, where your account allows it.';
}

// ---------- context meter ----------

async function refreshContext(conv) {
  if (!conv) return;
  try {
    conv.context = await api.chat.context(conv.key);
  } catch {
    conv.context = null;
  }
  if (state.active === conv) renderContext();
}

function renderContext() {
  const context = state.active?.context;
  el.meter.hidden = !context;
  if (!context) return;
  const pct = Math.max(0, Math.min(100, Math.round(context.percentage)));
  el.meter.querySelector('.ring').style.strokeDashoffset = String(44 * (1 - pct / 100));
  el.meter.classList.toggle('high', pct >= 70 && pct < 90);
  el.meter.classList.toggle('full', pct >= 90);
  el.meterPct.textContent = `${pct}%`;
  el.meter.title = `${fmtTokens(context.totalTokens)} of ${fmtTokens(context.maxTokens)} tokens of context used. Claude compacts automatically when it fills up. Click for options.`;
}

el.meter.addEventListener('click', (e) => {
  const rect = el.meter.getBoundingClientRect();
  openMenu(rect.left - 60, rect.top - 92, [
    { label: 'Compact conversation now', run: () => sendText('/compact') },
    { label: 'Show context breakdown', run: () => sendText('/context') },
  ]);
  e.stopPropagation();
});

// ---------- account ----------

const PROVIDERS = { bedrock: 'Amazon Bedrock', vertex: 'Google Vertex AI', foundry: 'Microsoft Foundry' };

// How Claude Code is authenticated, in a few words for the sidebar footer.
function authLabel(account) {
  if (account.apiProvider && account.apiProvider !== 'firstParty') return PROVIDERS[account.apiProvider] || account.apiProvider;
  if (account.keySource === 'saved') return 'API key saved in Council Desk';
  if (account.keySource === 'environment') return 'API key from your environment';
  if (account.apiKeySource && account.apiKeySource !== 'none') return `API key from ${account.apiKeySource}`;
  return "Claude Code's own sign-in";
}

// Shows the welcome screen until Claude Code has a way to authenticate.
async function refreshAccount() {
  const account = await api.account.status();
  state.account = account;
  el.welcome.hidden = Boolean(account.loggedIn);
  if (!account.loggedIn) return el.account.replaceChildren();
  el.account.replaceChildren(
    h('div', { class: 'avatar' }, svg(ICONS.key)),
    h('div', { class: 'who' }, h('div', { class: 'email' }, 'Claude Code'), h('div', { class: 'org' }, h('span', { class: 'org-name', title: authLabel(account) }, authLabel(account)))),
    h(
      'button',
      {
        class: 'icon-btn popover-trigger',
        title: 'Settings and appearance',
        onclick: (e) =>
          openMenu(e.clientX, e.clientY - 150, [
            { label: 'Settings…', run: toggleSettings },
            { label: 'Theme…', run: toggleThemes },
            { label: 'Saved prompts…', run: () => showPrompts() },
            { label: 'Scheduled tasks…', run: () => showSchedules() },
            { label: 'Show Claude Code config folder', run: () => api.app.reveal(state.info.configDir) },
          ]),
      },
      svg(ICONS.more),
    ),
  );
}

// After a key is saved or removed (here or in Settings): recheck, and load what needs a
// working engine.
async function accountChanged() {
  await refreshAccount();
  if (state.account?.loggedIn) {
    commandCache.clear();
    loadModels();
  }
}

$('welcome-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('welcome-key');
  const status = $('welcome-status');
  status.textContent = 'Checking…';
  try {
    await api.account.saveKey(input.value);
    input.value = '';
    status.textContent = '';
  } catch (error) {
    status.textContent = ipcMessage(error);
    return;
  }
  await accountChanged();
  if (!state.account?.loggedIn) status.textContent = "Claude Code still can't authenticate with that key.";
});
$('welcome-check').addEventListener('click', async () => {
  $('welcome-status').textContent = 'Checking…';
  await accountChanged();
  $('welcome-status').textContent = state.account?.loggedIn ? '' : 'Claude Code has no way to authenticate yet.';
});
$('welcome-console').addEventListener('click', (e) => {
  e.preventDefault();
  api.app.openExternal(e.currentTarget.href);
});

// ---------- sessions sidebar ----------

let refreshTimer = 0;
function scheduleRefreshSessions(delay = 600) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshSessions, delay);
}

async function refreshSessions() {
  try {
    state.sessions = (await api.sessions.list()).sort((a, b) => b.lastModified - a.lastModified);
  } catch (error) {
    console.error(error);
  }
  renderSidebar();
}

const PIN_ICON = '<svg class="pin" viewBox="0 0 20 20"><path d="M12.5 3.5l4 4-3 1.5-2.5 2.5.5 3.5-1.5 1.5-3-3-3.5 3.5M7 10l3 3" /></svg>';

const convForSession = (sessionId) => [...state.convs.values()].find((c) => c.sessionId === sessionId);

function sessionTitle(s) {
  return (s.customTitle || s.summary || s.firstPrompt || 'Untitled').replace(/\s+/g, ' ').trim();
}

// Sessions that helped another agent: ones Council Desk started for a help request (tagged
// 'helper'), or ones that began with /help-out. They go in the sidebar's Helper sessions
// group, closed by default, so they don't push your own sessions down. The ⋯ menu moves
// a session in or out (kept in settings, like pins).
function isHelperSession(s) {
  if ((state.settings.notHelperSessions || []).includes(s.sessionId)) return false;
  return s.tag === 'helper' || (state.settings.helperSessions || []).includes(s.sessionId) || /^\/help-out\b/.test(String(s.firstPrompt || '').trim());
}

function moveHelperGroup(s, into) {
  const without = (key) => (state.settings[key] || []).filter((id) => id !== s.sessionId);
  const patch = { helperSessions: without('helperSessions'), notHelperSessions: without('notHelperSessions') };
  patch[into ? 'helperSessions' : 'notHelperSessions'].push(s.sessionId);
  Object.assign(state.settings, patch);
  api.settings.set(patch);
  renderSidebar();
}

function renderSidebar() {
  if (el.sessionList.querySelector('input.rename')) return;
  const items = [];
  const active = state.active;
  if (active && !active.sessionId && active.hasMessages) {
    items.push(sidebarItem({ title: active.title || 'New session', meta: base(active.cwd), active: true, busy: active.busy }));
  }
  const pinned = new Set(state.settings.pinnedSessions || []);
  const archived = new Set(state.settings.archivedSessions || []);
  const query = state.query.trim().toLowerCase();
  const matches = (s) => !query || sessionTitle(s).toLowerCase().includes(query) || state.searchHits.has(s.sessionId);
  const list = state.sessions.filter(matches);

  const itemFor = (s) => {
    const conv = convForSession(s.sessionId);
    const isPinned = pinned.has(s.sessionId);
    const isArchived = archived.has(s.sessionId);
    return sidebarItem({
      title: conv?.title || sessionTitle(s),
      meta: `${isArchived && query ? 'Archived · ' : ''}${worktreeBranch(s.cwd) ? `⎇ ${worktreeBranch(s.cwd).slice(7)}` : base(s.cwd) || 'No folder'} · ${timeAgo(s.lastModified)}`,
      snippet: query && state.searchHits.get(s.sessionId),
      active: active?.sessionId === s.sessionId,
      busy: conv?.busy,
      pinned: isPinned,
      open: () => openSession(s),
      menu: (x, y, item) =>
        openMenu(x, y, [
          { label: isPinned ? 'Unpin' : 'Pin to top', run: () => toggleListed('pinnedSessions', s.sessionId) },
          { label: 'Open in split view', run: () => openInSplit(s) },
          { label: 'Rename', run: () => startRename(item, s) },
          { label: 'Show folder in Finder', run: () => api.app.reveal(s.cwd) },
          { label: isArchived ? 'Unarchive' : 'Archive', run: () => toggleListed('archivedSessions', s.sessionId) },
          isHelperSession(s) ? { label: 'Move out of Helper sessions', run: () => moveHelperGroup(s, false) } : { label: 'Move to Helper sessions', run: () => moveHelperGroup(s, true) },
          ...(worktreeBranch(s.cwd) ? [{ label: 'Remove branch folder…', run: () => removeWorktree(s) }] : []),
          { label: 'Delete', danger: true, run: () => removeSession(s) },
        ]),
    });
  };

  if (query) {
    items.push(...list.map(itemFor));
  } else {
    // Pinned and archived win over the helper group (they're your own choices).
    const top = list.filter((s) => pinned.has(s.sessionId) && !archived.has(s.sessionId));
    const helping = list.filter((s) => !pinned.has(s.sessionId) && !archived.has(s.sessionId) && isHelperSession(s));
    const rest = list.filter((s) => !pinned.has(s.sessionId) && !archived.has(s.sessionId) && !isHelperSession(s));
    const old = list.filter((s) => archived.has(s.sessionId));
    if (top.length) items.push(h('div', { class: 'sidebar-group' }, 'Pinned'), ...top.map(itemFor));
    if (top.length && rest.length) items.push(h('div', { class: 'sidebar-group' }, 'Recent'));
    items.push(...rest.map(itemFor));
    if (helping.length) {
      // Closed by default. Opening one of them (e.g. from a notification) opens the group once,
      // so you can see where it is; you can still close it. A dot shows one is working.
      if (active?.sessionId && state.helperShownFor !== active.sessionId && helping.some((s) => s.sessionId === active.sessionId)) {
        state.helperShownFor = active.sessionId;
        state.showHelpers = true;
      }
      const open = Boolean(state.showHelpers);
      const working = helping.some((s) => convForSession(s.sessionId)?.busy);
      items.push(
        h(
          'button',
          { class: `sidebar-group archived-toggle${open ? ' open' : ''}`, title: 'Sessions that helped other agents', onclick: () => ((state.showHelpers = !open), renderSidebar()) },
          svg(ICONS.chev),
          `Helper sessions (${helping.length})`,
          working ? h('span', { class: 'dot busy', title: 'A helper session is working' }) : null,
        ),
      );
      if (open) items.push(...helping.map(itemFor));
    }
    if (old.length) {
      items.push(
        h(
          'button',
          { class: `sidebar-group archived-toggle${state.showArchived ? ' open' : ''}`, onclick: () => ((state.showArchived = !state.showArchived), renderSidebar()) },
          svg(ICONS.chev),
          `Archived (${old.length})`,
        ),
      );
      if (state.showArchived) items.push(...old.map(itemFor));
    }
  }
  if (!items.length) items.push(h('div', { class: 'session-empty' }, query ? 'No matching sessions.' : 'No sessions yet.'));
  el.sessionList.replaceChildren(...items);
}

// Adds or removes a session from a saved list (pinnedSessions, archivedSessions).
function toggleListed(key, sessionId) {
  const list = state.settings[key] || [];
  const next = list.includes(sessionId) ? list.filter((id) => id !== sessionId) : [...list, sessionId];
  state.settings[key] = next;
  api.settings.set({ [key]: next });
  if (key === 'archivedSessions' && next.includes(sessionId)) {
    state.settings.pinnedSessions = (state.settings.pinnedSessions || []).filter((id) => id !== sessionId);
    api.settings.set({ pinnedSessions: state.settings.pinnedSessions });
  }
  renderSidebar();
}

function sidebarItem({ title, meta, snippet, active, busy, pinned, open, menu }) {
  const item = h(
    'div',
    { class: `session-item${active ? ' active' : ''}`, role: 'button', tabindex: 0, onclick: () => open?.() },
    busy ? h('span', { class: 'dot busy' }) : null,
    h('span', { class: 'title' }, pinned ? svg(PIN_ICON) : null, title),
    h('span', { class: snippet ? 'meta snippet' : 'meta' }, snippet || meta),
  );
  item.addEventListener('keydown', (e) => e.key === 'Enter' && open?.());
  if (menu) {
    item.append(
      h('button', { class: 'more', title: 'More', onclick: (e) => (e.stopPropagation(), menu(e.clientX, e.clientY, item)) }, svg(ICONS.more)),
    );
    item.addEventListener('contextmenu', (e) => (e.preventDefault(), menu(e.clientX, e.clientY, item)));
  }
  return item;
}

function startRename(item, s) {
  const titleEl = item.querySelector('.title');
  const input = h('input', { type: 'text', value: titleEl.textContent, class: 'rename' });
  input.style.cssText = 'width:100%;font:inherit;border:1px solid var(--border-strong);border-radius:6px;padding:1px 5px;background:var(--surface);color:var(--text)';
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  input.addEventListener('click', (e) => e.stopPropagation());
  // Runs once (Enter, Escape or clicking away), and takes the box away so the sidebar,
  // which waits while a rename box is open, can redraw.
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const title = input.value.trim();
    input.replaceWith(titleEl);
    try {
      if (save && title && title !== titleEl.textContent) {
        await api.sessions.rename(s.sessionId, title, s.cwd);
        const conv = convForSession(s.sessionId);
        if (conv) conv.title = title;
        if (conv && state.active === conv) el.title.textContent = title;
      }
    } finally {
      refreshSessions();
    }
  };
  input.addEventListener('keydown', (e) => {
    // Kept from the session item (Enter opens it) and the window (Escape stops Claude).
    if (e.key === 'Enter' || e.key === 'Escape') e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true), { once: true });
}

async function removeSession(s) {
  if (!(await api.sessions.remove(s.sessionId, s.cwd))) return;
  for (const key of ['pinnedSessions', 'archivedSessions']) {
    if (!(state.settings[key] || []).includes(s.sessionId)) continue;
    state.settings[key] = state.settings[key].filter((id) => id !== s.sessionId);
    api.settings.set({ [key]: state.settings[key] });
  }
  const conv = convForSession(s.sessionId);
  if (conv) {
    state.convs.delete(conv.key);
    if (state.active === conv) newSession();
  }
  refreshSessions();
}

// ---------- conversations ----------

// Each project folder remembers the mode, model and effort last used there; other
// folders start from the general defaults.
function defaultsFor(cwd) {
  const own = (cwd && state.settings.folderDefaults?.[cwd]) || {};
  return {
    mode: own.mode ?? state.settings.mode ?? 'default',
    model: own.model ?? state.settings.model ?? '',
    effort: own.effort ?? state.settings.effort ?? '',
    useWorktree: Boolean(own.useWorktree),
  };
}

function setFolder(conv, cwd) {
  conv.cwd = cwd;
  Object.assign(conv, defaultsFor(cwd));
  show(conv);
}

function rememberForFolder(conv, patch) {
  api.settings.set(patch);
  Object.assign(state.settings, patch);
  if (!conv.cwd) return;
  const folderDefaults = { ...(state.settings.folderDefaults || {}) };
  // Save the folder's whole setup, so a choice made elsewhere doesn't leak in later.
  folderDefaults[conv.cwd] = { mode: conv.mode, model: conv.model, effort: conv.effort, useWorktree: Boolean(conv.useWorktree) };
  state.settings.folderDefaults = folderDefaults;
  api.settings.set({ folderDefaults });
}

function createConversation(fields) {
  const defaults = defaultsFor(fields.cwd);
  const conv = new Conversation({
    api,
    onRespond: (c, id, decision) => api.chat.respond(c.key, id, decision),
    ...fields,
    ...defaults,
  });
  conv.effort = defaults.effort;
  conv.useWorktree = defaults.useWorktree;
  conv.fast = Boolean(state.settings.fast);
  conv.context = null;
  conv.onUpdate = () => state.active === conv && stick && scrollToBottom();
  conv.onOpenFile = (file) => viewer.open(file);
  conv.onRewind = (target) => rewindTo(conv, target);
  state.convs.set(conv.key, conv);
  return conv;
}

async function openSession(s) {
  let conv = convForSession(s.sessionId);
  if (!conv) {
    conv = createConversation({ key: s.sessionId, sessionId: s.sessionId, cwd: s.cwd, title: sessionTitle(s) });
    // While the history loads, the session shows "Loading…" and can't be sent to, so a new
    // message can't land before the old ones.
    conv.loading = true;
    show(conv);
    try {
      conv.loadHistory(await api.sessions.history(s.sessionId, s.cwd));
    } catch (error) {
      conv.addNote(`Could not load this session: ${error.message}`, 'error');
    }
    conv.loading = false;
    // You may have opened another session meanwhile; don't jump back to this one.
    if (state.active !== conv) return;
  }
  show(conv);
  scrollToBottom();
}

function newSession(cwd) {
  const current = state.active;
  if (current && !current.hasMessages && !current.sessionId) {
    if (cwd) setFolder(current, cwd);
    else show(current);
    return;
  }
  const conv = createConversation({
    key: `new-${crypto.randomUUID()}`,
    cwd: cwd || state.settings.recentFolders?.[0] || null,
  });
  show(conv);
}

function emptyState(conv) {
  if (conv.loading) return h('div', { class: 'empty' }, h('p', {}, 'Loading…'));
  const folders = state.settings.recentFolders || [];
  return h(
    'div',
    { class: 'empty' },
    h('div', { class: 'mark' }, svg(ICONS.mark)),
    h('h1', {}, 'What are we working on?'),
    h('p', {}, conv.cwd ? `In ${tilde(conv.cwd)}` : 'Pick a project folder to start.'),
    h(
      'div',
      { class: 'recent-folders' },
      folders.slice(0, 6).map((f) =>
        h('button', { class: f === conv.cwd ? 'on' : '', title: tilde(f), onclick: () => setFolder(conv, f) }, base(f)),
      ),
      h('button', { onclick: pickFolder }, 'Choose folder…'),
    ),
  );
}

function show(conv) {
  if (split.current() === conv) split.close();
  state.active = conv;
  el.host.replaceChildren(conv.hasMessages ? conv.el : emptyState(conv));
  el.title.textContent = conv.hasMessages ? conv.title || 'New session' : '';
  el.folder.textContent = conv.cwd ? tilde(conv.cwd) : '';
  el.folder.title = conv.cwd ? 'Show in Finder' : '';
  el.folderChip.replaceChildren(svg(ICONS.folder), conv.cwd ? base(conv.cwd) : 'Choose folder');
  el.folderChip.disabled = conv.hasMessages;
  el.folderChip.title = conv.hasMessages ? tilde(conv.cwd) : 'Choose the project folder';
  setSelect(el.mode, conv.mode);
  setSelect(el.model, conv.model);
  setSelect(el.effort, conv.effort);
  updateChangeCount();
  refreshGit(conv);
  terminal.follow(conv.cwd);
  if (changes.isOpen()) changes.refresh();
  renderFast();
  renderContext();
  updateSendButton();
  renderSidebar();
  requestAnimationFrame(() => {
    scrollToBottom();
    el.input.focus();
  });
}

function setSelect(select, value) {
  if (![...select.options].some((o) => o.value === value)) select.append(h('option', { value }, value));
  select.value = value;
  select.parentElement.className = `chip select-chip${select === el.mode ? ` mode-${value}` : ''}`;
}

function updateSendButton() {
  const conv = state.active;
  const busy = conv?.busy;
  el.send.classList.toggle('stop', Boolean(busy));
  el.send.title = busy ? 'Stop (Esc)' : 'Send (Enter)';
  el.send.disabled = !busy && !el.input.value.trim() && !attachments.list().length;
}

async function pickFolder() {
  const folder = await api.folders.pick();
  if (!folder) return null;
  state.settings = await api.settings.get();
  const conv = state.active;
  if (conv && !conv.hasMessages) {
    setFolder(conv, folder);
  } else {
    newSession(folder);
  }
  return folder;
}

// Sends what's in the message box, or `command` (e.g. /compact) without touching the box,
// so a draft and its attachments stay where they are.
async function send(command) {
  const fromBox = command == null;
  // A pasted or dropped image may still be being read; wait so it goes with this message.
  if (fromBox) await attachments.ready();
  const conv = state.active;
  const text = fromBox ? el.input.value.trim() : command;
  const files = fromBox ? attachments.list() : [];
  if (!conv || (!text && !files.length) || conv.busy || conv.loading) return;
  if (!conv.cwd && !(await pickFolder())) return;
  // The first message in a folder you haven't trusted asks first; declining keeps the draft.
  if (!(await ensureTrusted(api, conv.cwd))) return;
  const first = !conv.hasMessages;
  if (first) {
    conv.title = (text || files[0].name).replace(/\s+/g, ' ').slice(0, 80);
    api.folders.use(conv.cwd);
  }
  slash.hide();
  const uuid = crypto.randomUUID();
  conv.addUser(text, files, uuid);
  conv.setBusy(true);
  if (fromBox) {
    el.input.value = '';
    attachments.clear();
    autosize();
  }
  if (first) show(conv);
  scrollToBottom();
  updateSendButton();
  if (first && conv.useWorktree && conv.git?.isRepo && !conv.git.isWorktree) await moveToWorktree(conv, text || files[0]?.name);
  await startTurn(conv, text, files, uuid);
}

// ---------- rewind ----------

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ipcMessage = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+': Error: /, '');

// "Rewind to here" on one of your messages: the conversation goes back to just before it
// (it and everything after are removed), Claude's file changes since then can be undone,
// and the message goes back in the message box to edit and resend.
async function rewindTo(conv, { uuid, text, node }) {
  if (conv.busy || !conv.sessionId) return;
  const args = { key: conv.key, sessionId: conv.sessionId, cwd: conv.cwd, messageId: uuid };
  let preview;
  try {
    preview = await api.chat.rewindPreview(args);
  } catch (error) {
    return conv.addNote(`Couldn't check this rewind: ${ipcMessage(error)}`, 'error');
  }
  if (!preview.found) return conv.addNote("Can't rewind to that message: it isn't in the saved conversation (commands like /compact can't be rewound to).", 'error');
  const files = preview.files || {};
  const changed = files.canRewind ? files.filesChanged || [] : [];
  const body = h(
    'div',
    {},
    h('p', {}, 'The conversation goes back to just before this message. It and everything after it are removed, and the message goes back in the message box so you can change it and send it again.'),
    preview.first ? h('p', { class: 'settings-hint' }, 'This is the first message, so the session starts over and the old one is deleted.') : null,
    changed.length
      ? h(
          'div',
          {},
          h('p', {}, `Claude's changes since then to ${plural(changed.length, 'file')} (+${files.insertions || 0} −${files.deletions || 0} lines) can be undone:`),
          h('ul', { class: 'rewind-files' }, changed.map((f) => h('li', {}, f.startsWith(conv.cwd + '/') ? f.slice(conv.cwd.length + 1) : f))),
          h('p', { class: 'settings-hint' }, 'Only edits Claude made with its file tools are tracked; changes from commands it ran (like git or scripts) and your own edits are not undone.'),
        )
      : h(
          'p',
          { class: 'settings-hint' },
          files.canRewind
            ? 'No files were changed since then.'
            : "File changes can't be undone for this message (sessions from before Rewind existed have no file backups), so only the conversation goes back.",
        ),
  );
  const run = async (restoreFiles) => {
    try {
      const result = await api.chat.rewind({ ...args, files: restoreFiles });
      conv.truncateFrom(node);
      if (result.fresh) {
        conv.sessionId = null;
        scheduleRefreshSessions(0);
      }
      const restored = result.files?.canRewind === false ? `, but files couldn't be restored: ${result.files.error || 'unknown error'}` : restoreFiles ? `; ${plural(changed.length, 'file')} restored` : '';
      conv.addNote(`Rewound${restored}.`, result.files?.canRewind === false ? 'error' : '');
      if (state.active === conv) {
        el.input.value = text || '';
        autosize();
        el.input.focus();
        updateSendButton();
      }
      updateChangeCount();
      if (changes.isOpen()) changes.refresh();
    } catch (error) {
      conv.addNote(`Couldn't rewind: ${ipcMessage(error)}`, 'error');
    }
  };
  openModal({
    title: 'Rewind to here?',
    body,
    actions: [
      { label: 'Cancel' },
      changed.length ? { label: 'Conversation only', run: () => run(false) } : null,
      { label: changed.length ? 'Rewind and undo changes' : 'Rewind', primary: true, run: () => run(changed.length > 0) },
    ].filter(Boolean),
  });
}

// ---------- branches (git worktrees) ----------

const worktreesRoot = () => `${state.info.configDir}/worktrees/`;
const worktreeBranch = (cwd) => (cwd?.startsWith(worktreesRoot()) ? `claude/${cwd.slice(worktreesRoot().length).split('/')[1]}` : null);

// Shows the branch in the title bar and offers "New branch" for new sessions in a repo.
async function refreshGit(conv) {
  const info = conv.cwd ? await api.git.info(conv.cwd).catch(() => ({ isRepo: false })) : { isRepo: false };
  conv.git = info;
  if (state.active !== conv) return;
  const label = $('session-branch');
  label.hidden = !info.isRepo || !info.branch;
  label.textContent = info.branch ? `⎇ ${info.branch}` : '';
  label.title = info.isWorktree ? `Branch in its own folder: ${conv.cwd}` : 'Current git branch';
  const toggle = $('branch-toggle');
  toggle.hidden = conv.hasMessages || !info.isRepo || info.isWorktree;
  toggle.setAttribute('aria-pressed', String(Boolean(conv.useWorktree)));
}

$('branch-toggle').addEventListener('click', () => {
  const conv = state.active;
  conv.useWorktree = !conv.useWorktree;
  $('branch-toggle').setAttribute('aria-pressed', String(conv.useWorktree));
  rememberForFolder(conv, {});
});

async function moveToWorktree(conv, title) {
  try {
    const w = await api.git.createWorktree(conv.cwd, title);
    conv.cwd = w.cwd;
    conv.worktree = w;
    conv.addNote(`Working on a new branch, ${w.branch}${w.base ? ` (from ${w.base})` : ''}, in its own folder. Your main checkout is untouched; ask Claude to merge when you're happy with it.`);
    refreshGit(conv);
  } catch (error) {
    conv.addNote(`Couldn't create a branch (${String(error.message).replace(/^Error invoking remote method '[^']+': Error: /, '')}), so this session works in the main folder.`, 'error');
  }
}

async function removeWorktree(s) {
  const dir = s.cwd.slice(0, worktreesRoot().length) + s.cwd.slice(worktreesRoot().length).split('/').slice(0, 2).join('/');
  const tryRemove = (force) => api.git.removeWorktree(dir, force);
  try {
    await tryRemove(false);
  } catch {
    if (!confirm(`The branch folder has changes that aren't committed.\n\nRemove it anyway and lose those changes? The branch ${worktreeBranch(s.cwd)} itself is kept.`)) return;
    await tryRemove(true).catch((e) => alert(`Couldn't remove it: ${e.message}`));
  }
  refreshSessions();
}

// Sends one message to a conversation's Claude process (starting it if needed).
async function startTurn(conv, text, files = [], uuid = crypto.randomUUID()) {
  try {
    await api.chat.send({
      key: conv.key,
      cwd: conv.cwd,
      resume: conv.sessionId || undefined,
      mode: conv.mode,
      model: conv.model,
      effort: conv.effort,
      fast: conv.fast,
      text,
      uuid,
      attachments: files.map(({ preview, ...rest }) => rest),
    });
  } catch (error) {
    conv.setBusy(false);
    conv.addNote(`Could not start Claude: ${error.message}`, 'error');
    if (state.active === conv) updateSendButton();
    split.update();
  }
}

// Sends a command such as /compact as if typed, leaving any draft in the message box.
function sendText(text) {
  if (state.active?.busy) return;
  send(text);
}

// ---------- events from the main process ----------

let stick = true;
el.scroller.addEventListener('scroll', () => {
  stick = nearBottom();
  el.topbar.classList.toggle('scrolled', el.scroller.scrollTop > 4);
});

const commandCache = new Map();

api.onEvent((ev) => {
  const conv = state.convs.get(ev.key);
  if (!conv) return;
  const isActive = state.active === conv;
  switch (ev.type) {
    case 'session':
      conv.sessionId = ev.sessionId;
      conv.cwd = ev.cwd || conv.cwd;
      labelHelper(conv);
      if (ev.mode && ev.mode !== conv.mode) conv.mode = ev.mode;
      commandCache.delete(conv.key);
      scheduleRefreshSessions();
      break;
    case 'busy':
      conv.setBusy(ev.busy);
      if (!ev.busy) {
        labelHelper(conv);
        scheduleRefreshSessions(300);
        refreshContext(conv);
        if (isActive) {
          updateChangeCount();
          changes.refresh();
        }
        // Background helper sessions say when they're done even while you're in the app.
        if (conv.key.startsWith('helper-')) notify('Helper session finished', conv.title, conv);
        else notify('Claude finished', conv.title || 'Your session is ready.');
      }
      renderSidebar();
      break;
    case 'sdk':
      conv.handleSdk(ev.msg);
      break;
    case 'permission':
      conv.showPermission(ev);
      updateAttention(true);
      notify(conv.key.startsWith('helper-') ? 'Helper session needs your OK' : 'Claude needs your input', ev.title || `${ev.toolName} in ${base(conv.cwd)}`, conv);
      break;
    case 'permission_resolved':
      conv.resolvePermission(ev.id);
      updateAttention(false);
      break;
    case 'mode':
      conv.mode = ev.mode;
      if (isActive) setSelect(el.mode, ev.mode);
      break;
    case 'fast':
      state.fastInfo = { state: ev.state, reason: ev.reason };
      renderFast();
      break;
    case 'error':
      conv.addNote(ev.message, 'error');
      break;
    case 'closed':
      conv.setBusy(false);
      conv.context = null;
      updateAttention(false);
      break;
  }
  if (isActive) {
    updateSendButton();
    if (stick) scrollToBottom();
  }
  if (split.current() === conv) {
    split.update();
    split.scrollToBottom();
  }
});

api.onMenu((command) => {
  if (command === 'new-session') newSession();
  if (command === 'pick-folder') pickFolder();
  if (command === 'toggle-sidebar') toggleSidebar();
  if (command === 'themes') toggleThemes();
  if (command === 'settings') toggleSettings();
  if (command === 'search') focusSearch();
  if (command === 'memory') openMemoryEditor({ api, cwd: state.active?.cwd });
  if (command === 'prompts') showPrompts();
  if (command === 'changes') changes.toggle();
  if (command === 'connectors') openConnectorsPanel({ api, cwd: state.active?.cwd });
  if (command === 'terminal') terminal.toggle();
  if (command === 'browser') browserPanel.toggle();
  if (command === 'focus-composer') el.input.focus();
  if (command === 'settings-changed') api.settings.get().then((settings) => (state.settings = settings));
  if (command === 'schedules') showSchedules();
});

// ---------- composer ----------

const attachments = createAttachments({ api, tray: $('attachments'), onChange: () => updateSendButton() });

const slash = createSlashMenu({
  menu: $('slash-menu'),
  input: el.input,
  // A running conversation has its project's own commands; otherwise use the general
  // list, which is loaded at startup so the menu opens instantly.
  getCommands: async () => {
    const conv = state.active;
    const key = conv && (conv.busy || conv.context) ? conv.key : 'general';
    if (!commandCache.has(key)) commandCache.set(key, api.chat.commands(key === 'general' ? null : key).catch(() => []));
    return commandCache.get(key);
  },
  onRun: send,
});

// @ file suggestions; each folder's file list is fetched once and refreshed after a while.
const fileLists = new Map();
const mentions = createMentionMenu({
  menu: $('slash-menu'),
  input: el.input,
  getFiles: async () => {
    const cwd = state.active?.cwd;
    if (!cwd) return null;
    const cached = fileLists.get(cwd);
    if (cached && Date.now() - cached.at < 30000) return cached.files;
    const files = await api.files.list(cwd).catch(() => []);
    fileLists.set(cwd, { at: Date.now(), files });
    return files;
  },
});

function autosize() {
  el.input.style.height = 'auto';
  el.input.style.height = `${Math.min(el.input.scrollHeight, 260)}px`;
}

el.input.addEventListener('input', () => {
  autosize();
  updateSendButton();
  slash.update();
  mentions.update();
});
el.input.addEventListener('blur', () => setTimeout(() => (slash.hide(), mentions.hide()), 150));
el.input.addEventListener('paste', (e) => attachments.handlePaste(e));
el.input.addEventListener('keydown', (e) => {
  if (slash.handleKey(e) || mentions.handleKey(e)) return e.preventDefault();
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (modalOpen()) return closeModal();
  if (viewer.isOpen() && !popover) return viewer.close();
  if (changes.isOpen() && !popover) return changes.close();
  if (popover) return closePopover();
  // Escape stops Claude only from the message box or the page itself, and only when no menu
  // used it: in other boxes (search, a permission card, the split view's reply box) it
  // belongs to that box.
  const elsewhere = e.target !== el.input && e.target.closest?.('input, textarea, select, [contenteditable]');
  if (e.defaultPrevented || elsewhere) return;
  if (state.active?.busy && !menuEl) api.chat.interrupt(state.active.key);
});
el.send.addEventListener('click', () => (state.active?.busy ? api.chat.interrupt(state.active.key) : send()));
$('attach').addEventListener('click', () => attachments.pick());
el.folderChip.addEventListener('click', pickFolder);
el.folder.addEventListener('click', () => state.active?.cwd && api.app.reveal(state.active.cwd));
// Built-in terminal at the bottom, one shell per project folder.
const terminal = createTerminalPanel({
  api,
  container: $('terminal-panel'),
  getCwd: () => state.active?.cwd,
  getHeight: () => state.settings?.terminalHeight,
  setHeight: (height) => api.settings.set({ terminalHeight: height }),
});

// ---------- scheduled tasks ----------

const scheduleListeners = new Set();
api.schedules.onEvent((event) => {
  for (const listener of scheduleListeners) listener(event);
  if (event.type === 'finished') scheduleRefreshSessions(300);
  if (event.type === 'open') openRun(event.sessionId, event.cwd);
});

// ---------- helper sessions (council-board) ----------

// The main process starts one when another agent on council-board asks this app's agent
// for help and you agree. It runs in the background (the session you're in stays in front) and shows in the
// sidebar; the notification or the sidebar opens it.
const helpers = new Map(); // brief id -> conversation key
api.board.onEvent((event) => {
  if (event.type === 'start-helper') startHelper(event);
  if (event.type === 'show-helper') {
    const conv = state.convs.get(helpers.get(event.briefId));
    if (conv) show(conv);
  }
});

// A helper session's title ("Helping …" instead of "/help-out") and its 'helper' tag, which
// puts it in the sidebar's Helper sessions group. Claude Code only saves a session once its
// first message is written, so a try at the start can fail; it's tried again after each
// turn until it works.
async function labelHelper(conv) {
  if (!conv.needsLabel || !conv.sessionId || conv.labeling) return;
  conv.labeling = true;
  try {
    await api.sessions.rename(conv.sessionId, conv.title, conv.cwd);
    await api.sessions.tag(conv.sessionId, 'helper', conv.cwd);
    conv.needsLabel = false;
    scheduleRefreshSessions(300);
  } catch {
  } finally {
    conv.labeling = false;
  }
}

function startHelper({ briefId, cwd, from, goal, mode, model, effort }) {
  const conv = createConversation({ key: `helper-${crypto.randomUUID()}`, cwd });
  conv.title = `Helping ${from}: ${goal || 'help request'}`.slice(0, 80);
  conv.needsLabel = true;
  if (mode) conv.mode = mode;
  // Same model and effort as the AI that asked (otherwise the folder's defaults).
  if (model) conv.model = model;
  if (effort) conv.effort = effort;
  helpers.set(briefId, conv.key);
  const uuid = crypto.randomUUID();
  conv.addUser('/help-out', [], uuid);
  conv.setBusy(true);
  startTurn(conv, '/help-out', [], uuid);
  scheduleRefreshSessions(1500);
}

// Opens a scheduled run's session, with its title once the sidebar knows it.
async function openRun(sessionId, cwd) {
  if (!state.sessions?.some((s) => s.sessionId === sessionId)) await refreshSessions();
  openSession(state.sessions.find((s) => s.sessionId === sessionId) || { sessionId, cwd, summary: 'Scheduled run' });
}

async function showSchedules() {
  const models = await api.chat.models().catch(() => []);
  openSchedulesPanel({
    api,
    cwd: state.active?.cwd,
    models,
    onOpenSession: (sessionId, cwd) => {
      closeModal();
      openRun(sessionId, cwd);
    },
    subscribe: (fn) => (scheduleListeners.add(fn), () => scheduleListeners.delete(fn)),
  });
}

$('terminal-btn').addEventListener('click', () => terminal.toggle());

// Split view: follow or answer a second session on the right.
const split = createSplitView({
  container: $('split-panel'),
  tilde,
  onShow: () => (viewer.close(), changes.close(), browserPanel.close()),
  onStop: (conv) => api.chat.interrupt(conv.key),
  onSend: async (conv, text) => {
    if (!(await ensureTrusted(api, conv.cwd))) return;
    const uuid = crypto.randomUUID();
    conv.addUser(text, [], uuid);
    conv.setBusy(true);
    startTurn(conv, text, [], uuid);
  },
});

async function openInSplit(s) {
  if (state.active?.sessionId === s.sessionId) return;
  let conv = convForSession(s.sessionId);
  if (!conv) {
    conv = createConversation({ key: s.sessionId, sessionId: s.sessionId, cwd: s.cwd, title: sessionTitle(s) });
    try {
      conv.loadHistory(await api.sessions.history(s.sessionId, s.cwd));
    } catch (error) {
      conv.addNote(`Could not load this session: ${error.message}`, 'error');
    }
  }
  split.open(conv);
}

const viewer = createFileViewer({ api, container: $('file-viewer'), getCwd: () => state.active?.cwd, onShow: () => (changes.close(), split.close(), browserPanel.close()) });

// Edits Claude made in a session, for the Changes panel outside git repositories.
function sessionEdits(conv) {
  const edits = [];
  for (const entry of conv?.tools.values() || []) {
    const file = entry.input?.file_path;
    if (!file || entry.isError) continue;
    if (entry.name === 'Edit') edits.push({ path: file, before: entry.input.old_string, after: entry.input.new_string });
    if (entry.name === 'Write') edits.push({ path: file, before: '', after: entry.input.content });
    if (entry.name === 'MultiEdit') for (const e of entry.input.edits || []) edits.push({ path: file, before: e.old_string, after: e.new_string });
  }
  return edits;
}

const changes = createChangesPanel({
  api,
  container: $('changes-panel'),
  getCwd: () => state.active?.cwd,
  getSessionEdits: () => sessionEdits(state.active),
  onOpenFile: (file) => viewer.open(file),
  onShow: () => (viewer.close(), split.close(), browserPanel.close()),
});

// The Browser pane, shared with Claude's browser tools.
const browserPanel = createBrowserPanel({ api, container: $('browser-panel'), onShow: () => (viewer.close(), changes.close(), split.close()) });
$('browser-btn').addEventListener('click', () => browserPanel.toggle());

// The number on the Changes button: files that differ from the last commit.
let countToken = 0;
async function updateChangeCount() {
  const badge = $('changes-count');
  const cwd = state.active?.cwd;
  const mine = ++countToken;
  const count = cwd ? await api.git.count(cwd).catch(() => null) : null;
  if (mine !== countToken) return;
  badge.hidden = !count;
  badge.textContent = count > 99 ? '99+' : String(count || '');
}
$('changes-btn').addEventListener('click', () => changes.toggle());

// Saved prompts are / commands; refresh the / menu after changes.
function showPrompts() {
  openPromptsPanel({ api, draft: el.input.value.trim(), onChange: () => commandCache.clear() });
}

$('memory-btn').addEventListener('click', () => openMemoryEditor({ api, cwd: state.active?.cwd }));

// Drag files anywhere onto the window to attach them.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  el.dropOverlay.hidden = false;
});
document.addEventListener('dragleave', () => {
  if (dragDepth && --dragDepth === 0) el.dropOverlay.hidden = true;
});
document.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
document.addEventListener('drop', (e) => {
  dragDepth = 0;
  el.dropOverlay.hidden = true;
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  attachments.addFiles([...e.dataTransfer.files]);
  el.input.focus();
});

el.mode.addEventListener('change', () => {
  const conv = state.active;
  const previous = conv.mode;
  const label = el.mode.selectedOptions[0]?.textContent || 'that mode';
  conv.mode = el.mode.value;
  setSelect(el.mode, conv.mode);
  rememberForFolder(conv, { mode: conv.mode });
  // If the session can't switch (Auto mode isn't available on every account), say so and
  // put the chip back, rather than show a mode the session isn't in.
  api.chat.setMode(conv.key, conv.mode).catch((error) => {
    conv.mode = previous;
    rememberForFolder(conv, { mode: previous });
    if (state.active === conv) setSelect(el.mode, previous);
    conv.addNote(`Couldn't switch to ${label}: ${ipcMessage(error)}`, 'error');
  });
});
el.model.addEventListener('change', () => {
  const conv = state.active;
  conv.model = el.model.value;
  rememberForFolder(conv, { model: conv.model });
  api.chat.setModel(conv.key, conv.model);
});
el.effort.addEventListener('change', () => {
  const conv = state.active;
  conv.effort = el.effort.value;
  setSelect(el.effort, conv.effort);
  rememberForFolder(conv, { effort: conv.effort });
  api.chat.setEffort(conv.key, conv.effort);
});
el.fast.addEventListener('click', () => {
  const conv = state.active;
  conv.fast = !conv.fast;
  api.settings.set({ fast: conv.fast });
  api.chat.setFast(conv.key, conv.fast);
  renderFast();
});

$('new-session').addEventListener('click', () => newSession());

// Session search: titles filter as you type; a moment later, matches from inside
// conversations are added with the matching line shown under the title.
const searchInput = $('session-search');
let searchTimer = 0;
searchInput.addEventListener('input', () => {
  state.query = searchInput.value;
  if (!state.query.trim()) state.searchHits = new Map();
  renderSidebar();
  clearTimeout(searchTimer);
  const query = state.query.trim();
  if (query.length < 2) return;
  searchTimer = setTimeout(async () => {
    const hits = await api.sessions.search(query).catch(() => []);
    if (state.query.trim() !== query) return;
    state.searchHits = new Map(hits.map((hit) => [hit.sessionId, hit.snippet]));
    renderSidebar();
  }, 250);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input'));
    el.input.focus();
  }
});
function focusSearch() {
  document.body.classList.remove('sidebar-hidden');
  searchInput.focus();
  searchInput.select();
}

function toggleSidebar() {
  const hidden = document.body.classList.toggle('sidebar-hidden');
  api.settings.set({ sidebarHidden: hidden });
}
$('toggle-sidebar').addEventListener('click', toggleSidebar);
$('show-sidebar').addEventListener('click', toggleSidebar);

// ---------- start ----------

async function init() {
  state.info = await api.app.info();
  state.settings = await api.settings.get();
  installAllThemes();
  applyTheme(state.settings.theme);
  document.body.classList.toggle('sidebar-hidden', Boolean(state.settings.sidebarHidden));
  await refreshAccount();
  await refreshSessions();
  newSession();
  if (state.account?.loggedIn) {
    loadModels();
    commandCache.set('general', api.chat.commands(null).catch(() => []));
  }
  setInterval(() => document.hasFocus() && renderSidebar(), 60000);
}

// Test hook (used by the screenshot runs): `await window.__councilDesk.ready` before driving the UI.
window.__councilDesk = { state, openSession, newSession, toggleThemes, setTheme, show, createConversation, attachments, toggleSettings, focusSearch, setFolder, openThemeEditor, openMemoryEditor: () => openMemoryEditor({ api, cwd: state.active?.cwd }), showPrompts, viewer, changes, split, openInSplit, terminal, openConnectors: () => openConnectorsPanel({ api, cwd: state.active?.cwd }), openPermissions: () => openPermissionsPanel({ api, cwd: state.active?.cwd }), ready: init() };
