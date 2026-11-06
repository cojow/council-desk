// The only bridge between the page and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  app: {
    info: invoke('app:info'),
    openExternal: invoke('app:openExternal'),
    attention: invoke('app:attention'),
    testNotification: invoke('app:testNotification'),
    openNotificationSettings: invoke('app:openNotificationSettings'),
    reveal: invoke('app:reveal'),
    openPath: invoke('app:openPath'),
    engineVersion: invoke('app:engineVersion'),
    checkEngine: invoke('app:checkEngine'),
    hotkey: invoke('app:hotkey'),
    saveThemeIcon: invoke('app:saveThemeIcon'),
    deleteThemeIcon: invoke('app:deleteThemeIcon'),
  },
  account: {
    status: invoke('account:status'),
    saveKey: invoke('account:saveKey'),
    clearKey: invoke('account:clearKey'),
  },
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set'),
  },
  folders: {
    pick: invoke('folders:pick'),
    use: invoke('folders:use'),
  },
  memory: {
    read: invoke('memory:read'),
    write: invoke('memory:write'),
  },
  prompts: {
    list: invoke('prompts:list'),
    save: invoke('prompts:save'),
    remove: invoke('prompts:delete'),
  },
  mcp: {
    list: invoke('mcp:list'),
    add: invoke('mcp:add'),
    remove: invoke('mcp:remove'),
    login: invoke('mcp:login'),
    logout: invoke('mcp:logout'),
    approve: invoke('mcp:approve'),
  },
  git: {
    info: invoke('git:info'),
    changes: invoke('git:changes'),
    count: invoke('git:count'),
    createWorktree: invoke('git:createWorktree'),
    removeWorktree: invoke('git:removeWorktree'),
  },
  permissions: {
    read: invoke('permissions:read'),
    write: invoke('permissions:write'),
  },
  trust: {
    check: invoke('trust:check'),
    grant: invoke('trust:grant'),
  },
  files: {
    pick: invoke('files:pick'),
    read: invoke('files:read'),
    list: invoke('files:list'),
    // Full path of a file dropped onto the window ('' for pasted images).
    pathFor: (file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    },
  },
  sessions: {
    list: invoke('sessions:list'),
    search: invoke('sessions:search'),
    history: invoke('sessions:history'),
    rename: invoke('sessions:rename'),
    tag: invoke('sessions:tag'),
    remove: invoke('sessions:remove'),
    removeMany: invoke('sessions:removeMany'),
  },
  chat: {
    send: invoke('chat:send'),
    interrupt: invoke('chat:interrupt'),
    rewindPreview: invoke('chat:rewindPreview'),
    rewind: invoke('chat:rewind'),
    setMode: invoke('chat:setMode'),
    setModel: invoke('chat:setModel'),
    models: invoke('chat:models'),
    setEffort: invoke('chat:setEffort'),
    setFast: invoke('chat:setFast'),
    context: invoke('chat:context'),
    commands: invoke('chat:commands'),
    respond: invoke('chat:respond'),
    close: invoke('chat:close'),
  },
  schedules: {
    list: invoke('schedules:list'),
    save: invoke('schedules:save'),
    remove: invoke('schedules:remove'),
    setEnabled: invoke('schedules:setEnabled'),
    run: invoke('schedules:run'),
    stop: invoke('schedules:stop'),
    onEvent: (callback) => {
      ipcRenderer.on('schedules', (_event, payload) => callback(payload));
    },
  },
  board: {
    onEvent: (callback) => {
      ipcRenderer.on('board', (_event, payload) => callback(payload));
    },
  },
  browser: {
    attach: invoke('browser:attach'),
    onEvent: (callback) => ipcRenderer.on('browser', (_event, payload) => callback(payload)),
  },
  term: {
    open: invoke('term:open'),
    kill: invoke('term:kill'),
    write: (id, data) => ipcRenderer.send('term:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('term:resize', id, cols, rows),
    onEvent: (callback) => ipcRenderer.on('term:event', (_event, payload) => callback(payload)),
  },
  onEvent(callback) {
    ipcRenderer.on('session:event', (_event, payload) => callback(payload));
  },
  onMenu(callback) {
    ipcRenderer.on('menu', (_event, command) => callback(command));
  },
});
