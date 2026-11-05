// The Settings panel: instructions, voice, the engine version and the app-wide switches.
import { PRESETS, THEME_VOICES, voiceText } from '../shared/voices.js';
import { h } from './tools.js';

const TOGGLES = [
  { key: 'hotkey', label: 'Global shortcut', hint: 'Brings Council Desk to the front from any app' },
  {
    key: 'boardHelpers',
    label: 'Start helper sessions from council-board',
    hint: "For council-board users: when another agent on the board asks this app's agent (named in the board's agents.json) for help, Council Desk asks you, and if you say yes it starts a session in that project that runs /help-out. Only while Council Desk is open, and only in folders you trust.",
    defaultOn: false,
  },
  { key: 'boardHelperEdits', label: 'Helper sessions auto-accept file edits', hint: "Otherwise they ask before edits, like any session. Commands still ask unless your permission rules allow them.", defaultOn: false },
  { key: 'browserTools', label: 'Let Claude use the browser', hint: 'Claude can open, read, click and type in the Browser pane (⇧⌘B). It asks before clicking or typing. Applies to new sessions.' },
  {
    key: 'keepRunning',
    label: 'Keep running when the window is closed',
    hint: 'Sessions keep going; reopen from the menu bar icon, the Dock or the shortcut. ⌘Q quits.',
    defaultOn: false,
  },
];

// The Anthropic API key: where Claude Code's key comes from, and a field to save one
// (encrypted, see main/api-key.js). The key itself never comes back to the window.
function apiKeySection(api, onAccountChange) {
  const line = h('div', { class: 'settings-hint' }, 'Checking…');
  const input = h('input', { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: 'Paste a new API key', 'aria-label': 'Anthropic API key' });
  const note = h('span', { class: 'settings-hint' }, '');
  const removeButton = h('button', { class: 'btn link danger-link', hidden: true, onclick: () => change(() => api.account.clearKey(), 'Removed.') }, 'Remove saved key');
  const form = h('div', { class: 'settings-actions api-key-form' }, input, h('button', { class: 'btn primary', onclick: () => change(() => api.account.saveKey(input.value), 'Saved. New sessions use it.') }, 'Save'), removeButton);

  async function show() {
    const account = await api.account.status();
    form.hidden = account.keySource === 'environment';
    removeButton.hidden = account.keySource !== 'saved';
    line.textContent =
      account.keySource === 'environment'
        ? 'Using ANTHROPIC_API_KEY from your environment. To change it, change it there and reopen Council Desk.'
        : account.keySource === 'saved'
          ? 'A key is saved here, encrypted, with the encryption key in your macOS Keychain.'
          : account.loggedIn
            ? 'No key saved here. Claude Code authenticates its own way (see the sidebar).'
            : 'No key yet. Usage is billed to your own Anthropic Console account.';
  }
  async function change(run, done) {
    try {
      await run();
      input.value = '';
      note.textContent = done;
    } catch (error) {
      note.textContent = String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    }
    show();
    onAccountChange?.();
  }
  show();
  return [h('div', { class: 'usage-section' }, 'Anthropic API key'), line, form, note];
}

export function settingsPanel({ api, settings, onToggle, onOpen, onAccountChange }) {
  // The bundled Claude Code engine. Checking asks npm for the newest version only when you
  // click; updating means rebuilding from source.
  const status = h('div', { class: 'settings-status muted' }, '');
  const version = h('span', { class: 'muted' }, '');
  api.app.engineVersion().then((v) => (version.textContent = v));

  async function check() {
    status.textContent = 'Checking…';
    try {
      const u = await api.app.checkEngine();
      if (!u.latest) status.textContent = "Couldn't reach npm to check. Are you online?";
      else if (u.available) status.textContent = `Version ${u.latest} is available. To update, rebuild Council Desk from source (see the README).`;
      else status.textContent = 'Up to date.';
    } catch (error) {
      status.textContent = `Couldn't check: ${error.message}`;
    }
  }

  const keyText = (accelerator) => accelerator.replace('Control+', '⌃').replace('Alt+', '⌥').replace('Space', 'Space');
  const hotkeyLabel = h('span', {}, 'Global shortcut');
  const hotkeyHint = h('span', { class: 'settings-hint' }, 'Brings Council Desk to the front from any app');
  async function showHotkey() {
    const k = await api.app.hotkey();
    hotkeyLabel.textContent = k.active ? `Global shortcut ${keyText(k.active)}` : 'Global shortcut';
    if (!k.enabled) hotkeyHint.textContent = 'Off';
    else if (!k.active) hotkeyHint.textContent = `${keyText(k.preferred)} and its fallback are taken by other apps`;
    else if (k.active !== k.preferred) hotkeyHint.textContent = `${keyText(k.preferred)} is taken by another app, so this one is used`;
    else hotkeyHint.textContent = 'Brings Council Desk to the front from any app; press again to hide it';
  }

  const rows = TOGGLES.map((t) => {
    const on = t.key in settings ? settings[t.key] !== false : t.defaultOn !== false;
    const input = h('input', { type: 'checkbox', role: 'switch', checked: on });
    input.addEventListener('change', async () => {
      await onToggle(t.key, input.checked);
      if (t.key === 'hotkey') showHotkey();
    });
    const text = t.key === 'hotkey' ? [hotkeyLabel, hotkeyHint] : [h('span', {}, t.label), h('span', { class: 'settings-hint' }, t.hint)];
    return h(
      'label',
      { class: 'settings-row' },
      h('span', { class: 'settings-text' }, ...text),
      h('span', { class: 'switch' }, input, h('span', { class: 'switch-track' })),
    );
  });
  showHotkey();

  // Instructions for Claude: the all-projects CLAUDE.md that every session reads.
  const instructions = h('textarea', {
    class: 'instructions-box',
    rows: 5,
    spellcheck: true,
    placeholder: 'e.g. Explain changes briefly before making them. Use metric units. Prefer Python with type hints.',
    'aria-label': 'Instructions for Claude',
  });
  const instructionsNote = h('span', { class: 'settings-hint' }, '');
  let savedInstructions = '';
  api.memory.read(null).then((memory) => {
    savedInstructions = memory.user?.content || '';
    instructions.value = savedInstructions;
  });
  async function saveInstructions() {
    await api.memory.write('user', null, instructions.value);
    savedInstructions = instructions.value;
    instructionsNote.textContent = 'Saved. New Code sessions use it.';
  }
  instructions.addEventListener('input', () => (instructionsNote.textContent = instructions.value === savedInstructions ? '' : 'Not saved yet'));

  // Voice: how Claude talks to you in Code sessions.
  const voice = { mode: 'default', preset: 'concise', custom: '', ...(settings.voice || {}) };
  const voiceSelect = h(
    'select',
    { 'aria-label': 'Voice' },
    h('option', { value: 'default' }, "Claude's usual voice"),
    PRESETS.filter((p) => p.id !== 'default').map((p) => h('option', { value: `preset:${p.id}` }, p.name)),
    h('option', { value: 'theme' }, 'Match theme'),
    h('option', { value: 'custom' }, 'In your own words…'),
  );
  voiceSelect.value = voice.mode === 'preset' ? `preset:${voice.preset}` : voice.mode;
  const voiceCustom = h('textarea', { class: 'instructions-box', rows: 3, placeholder: 'e.g. Talk like a calm air-traffic controller: short, clear, checklist-style.', 'aria-label': 'Your voice description' });
  voiceCustom.value = voice.custom;
  const voicePreview = h('div', { class: 'settings-hint voice-preview' });
  const saveVoice = () => {
    const [mode, preset] = voiceSelect.value.split(':');
    Object.assign(voice, { mode, preset: preset || voice.preset, custom: voiceCustom.value });
    settings.voice = { ...voice };
    api.settings.set({ voice: settings.voice });
    voiceCustom.hidden = mode !== 'custom';
    const text = voiceText(settings);
    const themeName = mode === 'theme' && !THEME_VOICES[settings.theme || 'warm'] && !text ? 'This custom theme has no voice yet: add one in its theme editor. ' : '';
    voicePreview.textContent = `${themeName}${text ? `“${text}”` : mode === 'theme' ? '' : 'Claude talks as usual.'} Applies to sessions you start or reopen from now on.`;
  };
  voiceSelect.addEventListener('change', saveVoice);
  let voiceTimer = null;
  voiceCustom.addEventListener('input', () => {
    clearTimeout(voiceTimer);
    voiceTimer = setTimeout(saveVoice, 400);
  });
  voiceCustom.hidden = voice.mode !== 'custom';

  const notifyHint = h('span', { class: 'settings-hint' }, 'Council Desk notifies you when Claude needs your OK or finishes, and shows a number on its Dock icon while requests wait. macOS has to allow its notifications.');

  const panel = h(
    'div',
    { class: 'settings-panel', role: 'dialog', 'aria-label': 'Settings' },
    h('div', { class: 'usage-head' }, h('span', {}, 'Settings')),
    ...apiKeySection(api, onAccountChange),
    h('div', { class: 'usage-section' }, 'Instructions for Claude'),
    h('div', { class: 'settings-hint' }, 'General instructions for every session in every project (your CLAUDE.md for all projects).'),
    instructions,
    h(
      'div',
      { class: 'settings-actions' },
      h('button', { class: 'btn primary', onclick: saveInstructions }, 'Save'),
      instructionsNote,
    ),
    h('div', { class: 'usage-section' }, 'Voice'),
    h('div', { class: 'settings-hint' }, 'How Claude talks to you in Code sessions. Code, commit messages and files keep their usual style.'),
    h('label', { class: 'field voice-field' }, voiceSelect),
    voiceCustom,
    voicePreview,
    h('div', { class: 'usage-section' }, 'Updates'),
    h('div', { class: 'settings-line' }, h('span', {}, 'Claude Code engine'), version),
    status,
    h('div', { class: 'settings-actions' }, h('button', { class: 'btn', onclick: check }, 'Check for a newer version')),
    h('div', { class: 'usage-section' }, 'Claude Code'),
    h(
      'div',
      { class: 'settings-actions' },
      h('button', { class: 'btn', onclick: () => onOpen?.('permissions') }, 'Permission rules…'),
      h('button', { class: 'btn', onclick: () => onOpen?.('memory') }, 'Project memory…'),
      h('button', { class: 'btn', onclick: () => onOpen?.('prompts') }, 'Saved prompts…'),
      h('button', { class: 'btn', onclick: () => onOpen?.('connectors') }, 'Connectors…'),
      h('button', { class: 'btn', onclick: () => onOpen?.('schedules') }, 'Scheduled tasks…'),
    ),
    h('div', { class: 'usage-section' }, 'App'),
    ...rows,
    h('div', { class: 'settings-row static' }, h('span', { class: 'settings-text' }, h('span', {}, 'Notifications'), notifyHint)),
    h(
      'div',
      { class: 'settings-actions' },
      h('button', { class: 'btn', onclick: async () => (notifyHint.textContent = (await api.app.testNotification()) ? "Sent one. If nothing appeared, macOS has Council Desk's notifications turned off: use the next button and turn on Allow notifications." : "This Mac doesn't support notifications here.") }, 'Send a test notification'),
      h('button', { class: 'btn', onclick: () => api.app.openNotificationSettings() }, 'Notification settings…'),
    ),
  );
  {
    const text = voiceText(settings);
    voicePreview.textContent = text ? `“${text}”` : voice.mode === 'theme' ? 'This theme has no voice yet: add one in its theme editor.' : 'Claude talks as usual.';
  }
  return panel;
}
