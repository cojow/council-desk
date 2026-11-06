import { CLAUDE_BIN, CONFIG_DIR, GLOBAL_CONFIG_FILE } from './env.js';
import './user-data.js';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, Notification, session, shell } from 'electron';
import { getAccountStatus } from './account.js';
import { createApiKey } from './api-key.js';
import { buildContent, imageTypeFor } from './attachments.js';
import { createConnectors, unapprovedProjectServers } from './connectors.js';
import { SessionManager } from './sessions.js';
import { createGit, defaultWorktreesDir } from './git.js';
import { createSearch } from './search.js';
import { createSchedules } from './schedules.js';
import { BROWSER_PARTITION, BROWSER_READ_ONLY, createBrowser } from './browser.js';
import { createStore } from './store.js';
import { createTerminals } from './terminals.js';
import { createEngineVersion } from './engine-version.js';
import { createTray } from './tray.js';
import { createTrust } from './trust.js';
import { createBoardWatch } from './board-watch.js';
import { voicePrompt } from '../shared/voices.js';
import { createWorkspace } from './workspace.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const store = createStore(app.getPath('userData'));
const apiKey = createApiKey({ dir: app.getPath('userData') });
const logFile = path.join(app.getPath('logs'), 'claude.log');
let win = null;
let quitting = false;

// Window color while the page loads, so a dark theme doesn't flash light.
const THEME_BACKGROUNDS = {
  midnight: '#14161c',
  nord: '#2e3440',
  forest: '#141d18',
  paper: '#ffffff',
  dusk: '#1a1326',
  sandstone: '#f3ede3',
  terminal: '#0e0f0e',
  'red-neon': '#07080b',
  'cyan-neon': '#04080d',
};

// Icons per theme: built-in ones drawn by scripts/make-icon.mjs, your own themes'
// drawn by the app and saved in the settings folder.
const DOCK_ICONS = path.join(here, '..', 'assets', 'dock');
const CUSTOM_ICONS = path.join(app.getPath('userData'), 'theme-icons');
// Icons drawn by the app (your themes and edited built-ins) win over the built-in files.
const THEME_ID = /^[a-z0-9-]{1,40}$/;
const themeIconFile = (theme) => {
  const drawn = THEME_ID.test(theme || '') && path.join(CUSTOM_ICONS, `${theme}.png`);
  if (drawn && fs.existsSync(drawn)) return drawn;
  const file = path.join(DOCK_ICONS, `${theme || 'warm'}.png`);
  return fs.existsSync(file) ? file : path.join(DOCK_ICONS, 'warm.png');
};
const themeBackground = (theme) =>
  store.get().themeOverrides?.[theme]?.bg || THEME_BACKGROUNDS[theme] || store.get().customThemes?.find((t) => t.id === theme)?.colors?.bg || null;

// The Dock icon while the app is running.
function setDockIcon(theme) {
  if (!app.dock) return;
  const image = nativeImage.createFromPath(themeIconFile(theme));
  if (!image.isEmpty()) app.dock.setIcon(image);
}

// A custom Finder icon on the installed app, so Finder and the Dock also show the
// theme's icon while the app is closed. Warm removes it (back to the built-in icon).
// macOS stores it as an "Icon\r" file in the bundle; the app's local signature still
// passes the normal check, only `codesign --strict` objects.
function setBundleIcon(theme) {
  if (!app.isPackaged) return;
  const bundle = path.resolve(app.getPath('exe'), '../../..');
  if (!bundle.endsWith('.app')) return;
  const warm = !theme || theme === 'warm';
  if (warm && !fs.existsSync(path.join(bundle, 'Icon\r'))) return;
  const image = warm ? '$()' : `$.NSImage.alloc.initWithContentsOfFile(${JSON.stringify(themeIconFile(theme))})`;
  const script = `ObjC.import('AppKit'); $.NSWorkspace.sharedWorkspace.setIconForFileOptions(${image}, ${JSON.stringify(bundle)}, 0);`;
  execFile('osascript', ['-l', 'JavaScript', '-e', script], (error) => error && log(`bundle icon: ${error.message}`));
}

function applyThemeIcons(theme) {
  setDockIcon(theme);
  setBundleIcon(theme);
}

// Files that run something when opened: apps, scripts, installers, and anything marked
// executable (e.g. a script Claude wrote and chmod'ed).
const RUNNABLE = /\.(app|command|tool|terminal|sh|bash|zsh|csh|py|pyw|rb|pl|scpt|applescript|workflow|action|pkg|mpkg|jar|webloc|inetloc)$/i;
function runnable(target) {
  try {
    const stat = fs.statSync(target);
    return RUNNABLE.test(String(target).replace(/\/+$/, '')) || (stat.isFile() && (stat.mode & 0o111) !== 0);
  } catch {
    return false;
  }
}

function log(line) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${String(apiKey.redact(line)).trimEnd()}\n`);
  } catch {}
}

const connectorApprovals = () => store.get().connectorApprovals || {};
const connectors = createConnectors({
  claudeBin: CLAUDE_BIN,
  configDir: CONFIG_DIR,
  globalConfigFile: GLOBAL_CONFIG_FILE,
  approvals: connectorApprovals,
  saveApprovals: (connectorApprovalsNext) => store.set({ connectorApprovals: connectorApprovalsNext }),
  isTrusted: (cwd) => trust.isTrusted(cwd),
});
const gitTools = createGit({ worktreesDir: defaultWorktreesDir(CONFIG_DIR) });
const workspace = createWorkspace({ configDir: CONFIG_DIR });
const trust = createTrust({ store, globalConfigFile: GLOBAL_CONFIG_FILE });
const untrusted = (cwd) => new Error(`${cwd || 'This folder'} isn't trusted yet. Start a session there and choose Trust folder first.`);
const searchSessions = createSearch(path.join(CONFIG_DIR, 'projects'));
const terminals = createTerminals({
  emit: (event) => win?.webContents.send('term:event', event),
  claudeBin: CLAUDE_BIN,
  binDir: path.join(app.getPath('userData'), 'bin'),
  log,
});
// Keystrokes and resizes are frequent, so they use one-way messages.
ipcMain.on('term:write', (event, id, data) => event.sender === win?.webContents && terminals.write(id, data));
ipcMain.on('term:resize', (event, id, cols, rows) => event.sender === win?.webContents && terminals.resize(id, cols, rows));

const engine = createEngineVersion({ appRoot: path.resolve(here, '..', '..') });

const browser = createBrowser({ getWindow: () => win, log });

// Scheduled tasks; a finished run notifies you, and clicking the notification opens it.
// Shown notifications are kept here until clicked or closed, or they could be garbage
// collected and their clicks lost.
const liveNotes = new Set();
const schedules = createSchedules({
  env: (extra) => apiKey.engineEnv(extra),
  file: path.join(app.getPath('userData'), 'schedules.json'),
  sessionOptions: (cwd) => {
    // A run fails (with this as its summary) rather than start in a folder you don't trust.
    if (!trust.isTrusted(cwd)) throw untrusted(cwd);
    const blocked = unapprovedProjectServers(cwd, CONFIG_DIR, connectorApprovals());
    return blocked.length ? { settings: { disabledMcpjsonServers: blocked } } : {};
  },
  onEvent: (event) => {
    win?.webContents.send('schedules', event);
    if (event.type !== 'finished') return;
    const { name, last, cwd } = event.task;
    if (!Notification.isSupported()) return;
    const note = new Notification({ title: `${last.ok ? 'Scheduled task done' : 'Scheduled task failed'}: ${name}`, body: last.summary.replace(/\s+/g, ' ').slice(0, 180) });
    liveNotes.add(note);
    note.on('click', () => {
      liveNotes.delete(note);
      showWindow();
      if (last.sessionId) win?.webContents.send('schedules', { type: 'open', sessionId: last.sessionId, cwd });
    });
    note.on('close', () => liveNotes.delete(note));
    note.show();
  },
  log,
});

const manager = new SessionManager({
  env: () => apiKey.engineEnv(),
  emit: (event) => win?.webContents.send('session:event', event),
  log,
  blockedConnectors: (cwd) => unapprovedProjectServers(cwd, CONFIG_DIR, connectorApprovals()),
  extraServers: () => (store.get().browserTools === false ? {} : { browser: browser.server() }),
  autoAllow: BROWSER_READ_ONLY,
  voice: () => voicePrompt(store.get()),
});

// Helper sessions (optional, off by default): when another agent on council-board asks this
// app's agent for help (and Settings → Start helper sessions is on), Council Desk asks you
// first; if you say yes, the window starts a session in that project that runs /help-out.
// Asking first matters because anything on this computer can write to the board, and the
// request's text steers the helper, so a request alone never starts one.
const askedBriefs = new Set();
const boardWatch = createBoardWatch({
  configDir: CONFIG_DIR,
  log,
  async onRequest(brief) {
    if (!store.get().boardHelpers || !win || askedBriefs.has(brief.id)) return;
    askedBriefs.add(brief.id);
    const name = path.basename(brief.project);
    const notify = (title, body, onClick) => {
      if (!Notification.isSupported()) return;
      const note = new Notification({ title, body });
      liveNotes.add(note);
      note.on('click', () => {
        liveNotes.delete(note);
        showWindow();
        onClick?.();
      });
      note.on('close', () => liveNotes.delete(note));
      note.show();
    };
    if (!fs.existsSync(brief.project)) return;
    if (!trust.isTrusted(brief.project)) {
      notify(`${brief.from} asked for help in ${name}`, "Council Desk hasn't trusted that folder yet, so no helper started. Start a session there and choose Trust folder, then run /help-out.");
      return;
    }
    const auto = store.get().boardHelperAuto !== false;
    notify(`${brief.from} asks ${brief.to} for help`, `In ${name}. Council Desk is asking whether to start a helper session.`);
    app.dock?.bounce('informational');
    const { response } = await dialog.showMessageBox({
      type: 'question',
      message: `${brief.from} asks ${brief.to} for help in ${name}`,
      detail: `Goal: ${String(brief.goal || '').slice(0, 300)}\n\nWants help with: ${String(brief.helpWith || '').slice(0, 600)}\n\nA helper session runs /help-out in ${brief.project}${brief.model ? `, as ${brief.model}${brief.effort ? ` at ${brief.effort} effort` : ''} to match ${brief.from}` : ''}, and ${auto ? 'works in Auto mode: a safety check approves routine steps, including commands, and asks you when unsure (Settings)' : 'asks before editing files or running commands'}. Only start it if you asked ${brief.from} for this.`,
      buttons: ['Start helper session', 'Not now'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0 || !win) {
      boardWatch.decline(brief);
      log(`board helper declined for ${brief.id}`);
      return;
    }
    // The helper works at the requester's level: same model and effort (when the request says).
    const start = { type: 'start-helper', briefId: brief.id, cwd: brief.project, from: brief.from, goal: String(brief.goal || '').slice(0, 120), mode: auto ? 'auto' : 'default', model: brief.model || null, effort: brief.effort || null };
    const send = () => win?.webContents.send('board', start);
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, 2000));
    else send();
    boardWatch.announce(brief);
    log(`board helper started for ${brief.id} in ${brief.project}`);
    notify(`${brief.from} asked ${brief.to} for help`, `Started a helper session in ${name}: ${start.goal}`, () => win?.webContents.send('board', { type: 'show-helper', briefId: brief.id }));
  },
});

function showWindow() {
  if (!win) createWindow();
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

// Global shortcut: brings Council Desk to the front with the message box ready, or hides
// it if it is already in front. Falls back when another app owns the first choice.
const HOTKEYS = ['Alt+Space', 'Control+Alt+Space'];
let activeHotkey = null;

function onHotkey() {
  if (win && win.isVisible() && win.isFocused()) return app.hide();
  showWindow();
  app.focus({ steal: true });
  win?.webContents.send('menu', 'focus-composer');
}

function registerHotkey() {
  if (activeHotkey) globalShortcut.unregister(activeHotkey);
  activeHotkey = null;
  if (store.get().hotkey === false) return;
  for (const key of HOTKEYS) {
    try {
      if (globalShortcut.register(key, onHotkey)) {
        activeHotkey = key;
        break;
      }
    } catch {}
  }
  log(`global shortcut: ${activeHotkey || 'none free'}`);
}

const tray = createTray({ store, iconPath: path.join(here, '..', 'assets', 'trayTemplate.png'), onOpen: showWindow });

const handlers = {
  'app:info': () => ({ home: os.homedir(), version: app.getVersion(), configDir: CONFIG_DIR }),
  'app:openExternal': (url) => /^https?:\/\//.test(url) && shell.openExternal(url),
  // Permission requests waiting anywhere: a number on the Dock icon, and a bounce when a
  // new one arrives while the window isn't in front (works even with notifications off).
  'app:attention': (pending, isNew) => {
    app.dock?.setBadge(pending > 0 ? String(pending) : '');
    if (isNew && !win?.isFocused()) app.dock?.bounce('informational');
  },
  'app:testNotification': () => {
    if (!Notification.isSupported()) return false;
    new Notification({ title: 'Council Desk notifications work', body: "You'll see these when Claude needs your OK or finishes." }).show();
    return true;
  },
  'app:openNotificationSettings': () => shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension'),
  'app:reveal': (target) => shell.showItemInFolder(target),

  // keySource: where ANTHROPIC_API_KEY came from ('environment', 'saved' or null).
  'account:status': async () => ({ ...(await getAccountStatus(apiKey.engineEnv())), keySource: apiKey.status().source }),
  // A saved or removed key applies to sessions started afterwards; the helper restarts.
  'account:saveKey': (key) => {
    const status = apiKey.save(key);
    manager.closeProbe();
    log('API key saved');
    return status;
  },
  'account:clearKey': () => {
    const status = apiKey.clear();
    manager.closeProbe();
    log('API key removed');
    return status;
  },

  'settings:get': () => store.get(),
  'settings:set': (patch) => {
    const data = store.set(patch);
    if ('theme' in patch) applyThemeIcons(patch.theme);
    if ('keepRunning' in patch) tray.render();
    if ('hotkey' in patch) registerHotkey();
    if ('boardHelpers' in patch) (patch.boardHelpers ? boardWatch.start() : boardWatch.stop());
    return data;
  },

  'folders:pick': async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a project folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: store.get().recentFolders[0] || os.homedir(),
    });
    if (result.canceled || !result.filePaths[0]) return null;
    store.addRecentFolder(result.filePaths[0]);
    return result.filePaths[0];
  },
  'folders:use': (folder) => store.addRecentFolder(folder),

  'files:pick': async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Attach files', properties: ['openFile', 'multiSelections'] });
    if (result.canceled) return [];
    return result.filePaths.map((file) => {
      const mediaType = imageTypeFor(file);
      const small = mediaType && fs.statSync(file).size <= 5 * 1024 * 1024;
      return {
        kind: small ? 'image' : 'file',
        path: file,
        name: path.basename(file),
        preview: small ? `data:${mediaType};base64,${fs.readFileSync(file).toString('base64')}` : null,
      };
    });
  },

  'memory:read': (cwd) => workspace.readMemory(cwd),
  'memory:write': (scope, cwd, content) => workspace.writeMemory(scope, cwd, content),
  'prompts:list': () => workspace.listPrompts(),
  // New or changed prompts show up in the / menu once the background helper restarts.
  'prompts:save': (prompt) => {
    workspace.savePrompt(prompt);
    manager.closeProbe();
    return true;
  },
  'prompts:delete': (name) => {
    workspace.deletePrompt(name);
    manager.closeProbe();
    return true;
  },
  'files:read': (file) => workspace.readFile(file),
  'files:list': (cwd) => workspace.listFiles(cwd),
  // Opening an app or a script would run it, so those are shown in Finder instead.
  'app:openPath': (target) => (runnable(target) ? (shell.showItemInFolder(target), '') : shell.openPath(target)),
  'permissions:read': (cwd) => workspace.readPermissions(cwd),
  'permissions:write': (scope, cwd, rules) => workspace.writePermissions(scope, cwd, rules),

  'git:info': (cwd) => gitTools.info(cwd),
  'git:changes': (cwd) => gitTools.changes(cwd),
  'git:count': (cwd) => gitTools.changeCount(cwd),
  // A branch folder holds the same project, so it's trusted when the project is.
  'git:createWorktree': async (cwd, title) => {
    const result = await gitTools.createWorktree(cwd, title);
    if (trust.isTrusted(cwd)) trust.trust(result.dir);
    return result;
  },
  'trust:check': (cwd) => (trust.isTrusted(cwd) ? { trusted: true } : { trusted: false, details: trust.details(cwd) }),
  'trust:grant': (cwd) => trust.trust(cwd),
  'git:removeWorktree': (dir, force) => gitTools.removeWorktree(dir, force),

  // New or removed connectors apply to sessions started afterwards; the helper restarts.
  'mcp:list': (cwd) => connectors.list(cwd),
  'mcp:add': (spec, cwd) => connectors.add(spec, cwd).then((ok) => (manager.closeProbe(), ok)),
  'mcp:remove': (name, scope, cwd) => connectors.remove(name, scope, cwd).then((ok) => (manager.closeProbe(), ok)),
  'mcp:login': (name, cwd) => connectors.login(name, cwd),
  'mcp:logout': (name, cwd) => connectors.logout(name, cwd),
  'mcp:approve': (name, cwd) => (connectors.approve(name, cwd), manager.closeProbe(), true),

  'term:open': (id, cwd, cols, rows) => terminals.open(id, cwd, cols, rows),
  'term:kill': (id) => terminals.kill(id),

  'sessions:list': () => manager.list(),
  'sessions:search': (query) => searchSessions(query),
  'sessions:history': (sessionId, cwd) => manager.history(sessionId, cwd),
  'sessions:rename': (sessionId, title, cwd) => manager.rename(sessionId, title, cwd),
  'sessions:tag': (sessionId, tag, cwd) => manager.tag(sessionId, tag, cwd),
  'sessions:remove': async (sessionId, cwd) => {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      message: 'Delete this session?',
      detail: 'Its conversation history is removed from this Mac. Files Claude changed are not affected.',
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return false;
    await manager.remove(sessionId, cwd);
    return true;
  },

  // One question for the whole batch, naming what goes. Sessions that started working since
  // the window looked are skipped, not stopped.
  'sessions:removeMany': async (items, leftOut = 0) => {
    const named = items.slice(0, 5).map((item) => `• ${String(item.title || 'Untitled').slice(0, 70)}`);
    if (items.length > named.length) named.push(`…and ${items.length - named.length} more`);
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      message: `Delete ${items.length === 1 ? 'this session' : `these ${items.length} sessions`}?`,
      detail: [
        named.join('\n'),
        "Their conversation history is removed from this Mac and can't be brought back. Files Claude changed are not affected.",
        leftOut ? `${leftOut} still working or waiting for you ${leftOut === 1 ? 'is' : 'are'} left out.` : '',
      ].filter(Boolean).join('\n\n'),
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return null;
    const result = { removed: [], failed: [] };
    for (const { sessionId, cwd } of items) {
      if (manager.isActive(sessionId)) {
        result.failed.push({ sessionId, error: 'it started working again' });
        continue;
      }
      try {
        await manager.remove(sessionId, cwd);
        result.removed.push(sessionId);
      } catch (error) {
        result.failed.push({ sessionId, error: error.message });
      }
    }
    return result;
  },

  // The window asks before the first message in a folder; this makes sure of it.
  'chat:send': ({ text, attachments, ...args }) => {
    if (!trust.isTrusted(args.cwd)) throw untrusted(args.cwd);
    return manager.send({ ...args, content: buildContent(text, attachments) });
  },
  'chat:setEffort': (key, level) => manager.setEffort(key, level),
  'chat:setFast': (key, on) => manager.setFast(key, on),
  'chat:context': (key) => manager.context(key),
  'chat:commands': (key) => manager.commands(key),
  'chat:interrupt': (key) => manager.interrupt(key),
  'browser:attach': (id) => browser.attach(id),
  'schedules:list': () => schedules.list(),
  'schedules:save': (task) => schedules.save(task),
  'schedules:remove': (id) => schedules.remove(id),
  'schedules:setEnabled': (id, on) => schedules.setEnabled(id, on),
  'schedules:run': (id) => (schedules.runNow(id), true),
  'schedules:stop': (id) => schedules.stop(id),
  'chat:rewindPreview': (args) => manager.rewindPreview(args),
  'chat:rewind': (args) => manager.rewind(args),
  'chat:setMode': (key, mode) => manager.setMode(key, mode),
  'chat:setModel': (key, model) => manager.setModel(key, model),
  'chat:models': () => manager.models(),

  'app:engineVersion': () => engine.current(),
  'app:checkEngine': () => engine.check(),
  'app:hotkey': () => ({ enabled: store.get().hotkey !== false, active: activeHotkey, preferred: HOTKEYS[0] }),
  'app:saveThemeIcon': (id, dataUrl) => {
    if (!THEME_ID.test(id) || !/^data:image\/png;base64,/.test(dataUrl)) return false;
    fs.mkdirSync(CUSTOM_ICONS, { recursive: true });
    fs.writeFileSync(path.join(CUSTOM_ICONS, `${id}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
    if (store.get().theme === id) applyThemeIcons(id);
    return true;
  },
  'app:deleteThemeIcon': (id) => {
    if (!THEME_ID.test(id)) return false;
    fs.rmSync(path.join(CUSTOM_ICONS, `${id}.png`), { force: true });
    if (store.get().theme === id) applyThemeIcons(id);
    return true;
  },
  'chat:respond': (key, id, decision) => manager.respond(key, id, decision),
  'chat:close': (key) => manager.close(key),
};

// Only the app's own page may use these, not anything embedded in it.
const fromApp = (event) => event.sender === win?.webContents && event.senderFrame === win.webContents.mainFrame;
for (const [channel, handler] of Object.entries(handlers)) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromApp(event)) throw new Error(`Refused ${channel} from outside the app`);
    return handler(...args);
  });
}

function buildMenu() {
  const send = (command) => () => win?.webContents.send('menu', command);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: send('settings') },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'File',
        submenu: [
          { label: 'New Session', accelerator: 'CmdOrCtrl+N', click: send('new-session') },
          { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: send('pick-folder') },
          { label: 'Project Memory…', accelerator: 'CmdOrCtrl+Shift+M', click: send('memory') },
          { label: 'Saved Prompts…', accelerator: 'CmdOrCtrl+Shift+P', click: send('prompts') },
          { label: 'Scheduled Tasks…', accelerator: 'CmdOrCtrl+Shift+L', click: send('schedules') },
          { label: 'Connectors…', accelerator: 'CmdOrCtrl+Shift+K', click: send('connectors') },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: send('toggle-sidebar') },
          { label: 'Search Sessions', accelerator: 'CmdOrCtrl+Shift+F', click: send('search') },
          { label: 'Changes', accelerator: 'CmdOrCtrl+Shift+D', click: send('changes') },
          { label: 'Terminal', accelerator: 'Control+`', click: send('terminal') },
          { label: 'Browser', accelerator: 'CmdOrCtrl+Shift+B', click: send('browser') },
          { label: 'Theme…', accelerator: 'CmdOrCtrl+Shift+T', click: send('themes') },
          { type: 'separator' },
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    ]),
  );
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 760,
    minHeight: 520,
    title: 'Council Desk',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: themeBackground(store.get().theme) || (nativeTheme.shouldUseDarkColors ? '#262624' : '#faf9f5'),
    show: false,
    webPreferences: {
      preload: path.join(here, '..', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
      // Screenshot runs open behind other windows; keep them painting.
      backgroundThrottling: !process.env.COUNCIL_DESK_SCREENSHOT,
    },
  });

  // The only embedded page is the Browser pane, locked down and in its own cookie store.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!/^(https?:\/\/|about:blank$)/.test(params.src || '')) return event.preventDefault();
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.backgroundThrottling = false;
    params.partition = BROWSER_PARTITION;
  });

  win.loadFile(path.join(here, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Links open in the default browser; the window itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });

  // With "keep running" on, closing the window only hides it: sessions continue and the
  // menu bar icon stays. ⌘Q (or Quit in the menu bar) still quits.
  win.on('close', (event) => {
    log(`window close: quitting=${quitting} keepRunning=${Boolean(store.get().keepRunning)}`);
    if (quitting || !store.get().keepRunning) return;
    event.preventDefault();
    win.hide();
  });

  win.on('closed', () => {
    win = null;
  });

  // Test hook: COUNCIL_DESK_SCREENSHOT=/path.png captures the window and quits.
  // COUNCIL_DESK_SCREENSHOT_JS runs in the page first (e.g. to open a session); with
  // COUNCIL_DESK_DUMP=/path.json its result is saved there.
  const shotPath = process.env.COUNCIL_DESK_SCREENSHOT;
  if (shotPath) {
    win.webContents.once('did-finish-load', async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(2500);
      if (process.env.COUNCIL_DESK_SCREENSHOT_JS) {
        const result = await win.webContents.executeJavaScript(process.env.COUNCIL_DESK_SCREENSHOT_JS).catch((e) => ({ error: String(e) }));
        if (process.env.COUNCIL_DESK_DUMP) fs.writeFileSync(process.env.COUNCIL_DESK_DUMP, JSON.stringify(result ?? null, null, 2));
        await wait(Number(process.env.COUNCIL_DESK_SCREENSHOT_WAIT || 2500));
      }
      // COUNCIL_DESK_TEST_CLOSE: close the window the way the red button does, and log the result.
      if (process.env.COUNCIL_DESK_TEST_CLOSE && win) {
        win.close();
        await wait(800);
        log(`test close: window ${!win || win.isDestroyed() ? 'destroyed' : win.isVisible() ? 'still visible' : 'hidden'}`);
      }
      if (win && !win.isDestroyed()) {
        if (!win.isVisible()) win.show();
        win.focus();
        await wait(400);
        const image = await Promise.race([win.webContents.capturePage(), wait(5000).then(() => null)]);
        if (image) fs.writeFileSync(shotPath, image.toPNG());
      }
      app.quit();
    });
  }
}

function setupBrowserSession() {
  // The Browser pane: no camera, microphone, location or notifications, and no downloads.
  const browsing = session.fromPartition(BROWSER_PARTITION);
  const allowed = (permission) => ['clipboard-sanitized-write', 'fullscreen'].includes(permission);
  browsing.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed(permission)));
  browsing.setPermissionCheckHandler((_contents, permission) => allowed(permission));
  browsing.on('will-download', (event, item) => {
    event.preventDefault();
    win?.webContents.send('browser', { type: 'activity', message: `Download blocked: ${item.getFilename()}` });
  });
}

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;
  // Links that open a new window in the Browser pane open in the pane itself; any other
  // embedded page (there shouldn't be one) opens nothing.
  const inPane = contents.session === session.fromPartition(BROWSER_PARTITION);
  contents.setWindowOpenHandler(({ url }) => {
    if (inPane && /^https?:\/\//.test(url)) contents.loadURL(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => /^(https?:|about:blank)/.test(url) || event.preventDefault());
});

app.whenReady().then(() => {
  apiKey.load();
  // Folders you already used before folder trust existed start out trusted (once).
  const used = store.get();
  trust.adopt([...(used.recentFolders || []), ...Object.keys(used.folderDefaults || {}), ...schedules.list().map((t) => t.cwd)]);
  applyThemeIcons(store.get().theme);
  setupBrowserSession();
  buildMenu();
  createWindow();
  tray.render();
  if (!process.env.COUNCIL_DESK_SCREENSHOT || process.env.COUNCIL_DESK_TEST_HOTKEY) registerHotkey();
  if (!process.env.COUNCIL_DESK_SCREENSHOT || process.env.COUNCIL_DESK_TEST_SCHEDULES) schedules.start();
  if (store.get().boardHelpers && (!process.env.COUNCIL_DESK_SCREENSHOT || process.env.COUNCIL_DESK_TEST_BOARD)) boardWatch.start();
});

app.on('window-all-closed', () => {
  if (!store.get().keepRunning) app.quit();
});
app.on('activate', () => showWindow());
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => {
  quitting = true;
  tray.stop();
  terminals.killAll();
  schedules.stopAll();
  boardWatch.stop();
  manager.closeAll();
});
