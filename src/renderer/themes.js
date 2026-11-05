// Theme presets (palettes live in themes.css), the picker panel, and the editor for
// your own themes (palettes worked out in custom-themes.js).
import { h } from './tools.js';

// colors: [background, sidebar, accent, text] for the picker swatch.
export const THEMES = [
  { id: 'warm', name: 'Warm', sub: 'Warm neutrals · follows light/dark', colors: ['#faf9f5', '#f3f1ea', '#3f7480', '#1f1e1d'] },
  { id: 'midnight', name: 'Midnight Ember', sub: 'Near-black, ember orange', colors: ['#14161c', '#0f1116', '#ff7a45', '#ebe9e6'] },
  { id: 'nord', name: 'Nord Frost', sub: 'Cool slate, icy blue', colors: ['#2e3440', '#272c36', '#88c0d0', '#eceff4'] },
  { id: 'forest', name: 'Forest Lab', sub: 'Deep green, mint', colors: ['#141d18', '#0f1712', '#8fd19e', '#e4eee7'] },
  { id: 'dusk', name: 'Synthwave Dusk', sub: 'Purple night, neon pink', colors: ['#1a1326', '#140e1e', '#ff6ec7', '#f3ecff'] },
  { id: 'red-neon', name: 'Red Neon', sub: 'Red neon glow on black', colors: ['#07080b', '#050608', '#ff2d2d', '#f6eae9'] },
  { id: 'cyan-neon', name: 'Cyan Neon', sub: 'Cyan neon glow on black', colors: ['#04080d', '#03060a', '#2de2ff', '#e6f8ff'] },
  { id: 'terminal', name: 'Terminal Lime', sub: 'Black, lime, all monospace', colors: ['#0e0f0e', '#0a0b0a', '#c6f432', '#e2e6e1'] },
  { id: 'paper', name: 'Paper & Ink', sub: 'Crisp white, cobalt blue', colors: ['#ffffff', '#f6f7f9', '#2f5bea', '#111827'] },
  { id: 'sandstone', name: 'Sandstone', sub: 'Desert sand, canyon teal', colors: ['#f3ede3', '#e9e0d1', '#2f7d7a', '#2b2118'] },
];

// Warm carries a marker too, so an edited Warm can be styled like any other theme.
export function applyTheme(id) {
  document.documentElement.dataset.theme = id || 'warm';
}

// actions: [{ label, title, run }] shown on hover.
function themeCard(t, current, onPick, actions = []) {
  const [bg, side, accent, text] = t.colors;
  const card = h(
    'button',
    { class: `theme-card${t.id === current ? ' on' : ''}`, title: t.sub, 'data-theme-id': t.id, onclick: () => onPick(t.id) },
    h(
      'div',
      { class: 'swatch' },
      h('span', { class: 'side', style: `background:${side}` }),
      h('span', { style: `background:${bg}` }),
      h('span', { class: 'dot', style: `background:${bg}` }, h('i', { style: `background:${accent};box-shadow:0 0 0 3px ${text}22` })),
    ),
    h('div', { class: 'label' }, t.name),
    h('div', { class: 'sub' }, t.sub),
  );
  if (actions.length) {
    card.append(
      h(
        'span',
        { class: 'theme-actions' },
        actions.map((a) => h('span', { class: `theme-action${a.danger ? ' danger' : ''}`, role: 'button', title: a.title || a.label, onclick: (e) => (e.stopPropagation(), a.run()) }, a.label)),
      ),
    );
  }
  return card;
}

const swatchColors = (c) => [c.bg, c.sidebar, c.accent, c.text];

// customs: your themes; overrides: { themeId: colors } for edited built-ins; hidden: built-ins you deleted.
export function themePanel(current, onPick, { customs = [], overrides = {}, hidden = [], onNew, onEdit, onDelete, onShowHidden } = {}) {
  const builtIns = THEMES.filter((t) => !hidden.includes(t.id)).map((t) => {
    const edited = overrides[t.id];
    const shown = edited ? { ...t, sub: `${t.sub} · edited`, colors: swatchColors(edited) } : t;
    const actions = [{ label: 'Edit', title: 'Change its colors', run: () => onEdit(t, true) }];
    if (t.id !== 'warm') actions.push({ label: 'Delete', title: 'Hide this theme (you can bring it back)', danger: true, run: () => onDelete(t, true) });
    return themeCard(shown, current, onPick, actions);
  });
  const yours = customs.map((t) =>
    themeCard({ id: t.id, name: t.name, sub: 'Your theme', colors: swatchColors(t.colors) }, current, onPick, [
      { label: 'Edit', run: () => onEdit(t, false) },
      { label: 'Delete', danger: true, run: () => onDelete(t, false) },
    ]),
  );
  const makeCard = h(
    'button',
    { class: 'theme-card theme-new', onclick: onNew },
    h('div', { class: 'swatch new-swatch' }, '+'),
    h('div', { class: 'label' }, 'Make your own'),
    h('div', { class: 'sub' }, 'Pick five colors'),
  );
  return h(
    'div',
    { class: 'theme-panel', role: 'dialog', 'aria-label': 'Theme' },
    h('div', { class: 'usage-head' }, h('span', {}, 'Theme'), h('span', { class: 'settings-hint' }, 'Hover a theme to edit or delete it')),
    h('div', { class: 'theme-grid' }, builtIns, yours, makeCard),
    hidden.length
      ? h('button', { class: 'btn link show-hidden', onclick: onShowHidden }, `Show ${hidden.length} hidden theme${hidden.length === 1 ? '' : 's'}`)
      : null,
  );
}

const FIELDS = [
  ['bg', 'Background'],
  ['sidebar', 'Sidebar'],
  ['surface', 'Cards and message box'],
  ['text', 'Text'],
  ['accent', 'Accent'],
];

// draft: { id, name, colors }. onChange(draft) previews live. Built-in themes keep their
// name and offer Reset (when edited); your own themes can be renamed and deleted.
// A custom theme's voice: how Claude talks when Settings → Voice is "Match theme".
function voiceField(draft) {
  const box = h('textarea', { class: 'instructions-box', rows: 3, placeholder: 'Voice (optional): e.g. A cheerful ship\'s captain, brief and nautical.', 'aria-label': 'Theme voice' });
  box.value = draft.voice || '';
  box.addEventListener('input', () => (draft.voice = box.value));
  return h('div', { class: 'theme-voice' }, h('div', { class: 'settings-hint' }, 'Voice, used when Settings → Voice is set to Match theme'), box);
}

export function themeEditor(draft, { isNew, builtIn, edited, onChange, onSave, onDelete, onReset, onCancel }) {
  const name = h('input', { type: 'text', value: draft.name, maxlength: 40, 'aria-label': 'Theme name', disabled: builtIn });
  name.addEventListener('input', () => {
    draft.name = name.value;
    onChange(draft);
  });
  const rows = FIELDS.map(([key, label]) => {
    const input = h('input', { type: 'color', value: draft.colors[key], 'aria-label': label });
    const code = h('span', { class: 'color-code' }, draft.colors[key]);
    input.addEventListener('input', () => {
      draft.colors[key] = input.value;
      code.textContent = input.value;
      onChange(draft);
    });
    return h('label', { class: 'color-row' }, input, h('span', { class: 'color-label' }, label), code);
  });
  return h(
    'div',
    { class: 'theme-panel theme-editor', role: 'dialog', 'aria-label': 'Theme editor' },
    h('div', { class: 'usage-head' }, h('span', {}, isNew ? 'New theme' : `Edit ${builtIn ? draft.name : 'theme'}`)),
    name,
    h(
      'div',
      { class: 'settings-hint' },
      builtIn
        ? 'Changes show live. Borders, softer text and hover colors are worked out from these; extras like glows and grids stay.'
        : 'Changes show live. Borders, softer text and hover colors are worked out from these.',
    ),
    ...rows,
    builtIn ? null : voiceField(draft),
    h(
      'div',
      { class: 'settings-actions editor-actions' },
      h('button', { class: 'btn primary', onclick: () => onSave(draft) }, 'Save'),
      h('button', { class: 'btn', onclick: onCancel }, 'Cancel'),
      builtIn && edited ? h('button', { class: 'btn link', title: 'Back to the original colors', onclick: onReset }, 'Reset to original') : null,
      !builtIn && !isNew ? h('button', { class: 'btn link danger-link', onclick: onDelete }, 'Delete') : null,
    ),
  );
}
