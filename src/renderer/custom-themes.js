// Themes you make: five picked colors, with every other theme color worked out from
// them. Stored in settings as { id, name, colors: { bg, sidebar, surface, text, accent } }.
import { iconSvg } from '../shared/icon-svg.js';

const rgb = (hex) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
// mix(a, b, t): t = 0 gives a, t = 1 gives b.
const mix = (a, b, t) => {
  const [x, y] = [rgb(a), rgb(b)];
  return hex(...x.map((v, i) => v + (y[i] - v) * t));
};
const alpha = (color, a) => `rgba(${rgb(color).join(', ')}, ${a})`;
const luminance = (color) => {
  const [r, g, b] = rgb(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const isDark = (colors) => luminance(colors.bg) < 0.25;

// Every CSS variable a theme defines (see themes.css), from the five picked colors.
export function paletteFrom(colors) {
  const { bg, sidebar, surface, text, accent } = colors;
  const dark = isDark(colors);
  const ok = dark ? '#74b483' : '#3f8a4f';
  const danger = dark ? '#e0756b' : '#c0443a';
  return {
    '--bg': bg,
    '--sidebar': sidebar,
    '--surface': surface,
    '--raised': mix(surface, text, 0.07),
    '--border': mix(bg, text, dark ? 0.13 : 0.11),
    '--border-strong': mix(bg, text, dark ? 0.22 : 0.2),
    '--text': text,
    '--muted': mix(text, bg, 0.35),
    '--faint': mix(text, bg, 0.55),
    '--accent': accent,
    '--accent-hover': dark ? mix(accent, '#ffffff', 0.15) : mix(accent, '#000000', 0.12),
    '--accent-soft': alpha(accent, 0.14),
    '--on-accent': luminance(accent) > 0.45 ? '#111111' : '#ffffff',
    '--ok': ok,
    '--danger': danger,
    '--warn': dark ? '#e3b25a' : '#c27c1e',
    '--plan': dark ? '#7aa2ff' : '#4f6fd8',
    '--add-bg': alpha(ok, 0.14),
    '--del-bg': alpha(danger, 0.13),
    '--code-bg': sidebar,
    '--shadow': dark ? '0 1px 2px rgba(0,0,0,.35), 0 6px 20px rgba(0,0,0,.25)' : '0 1px 2px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.06)',
    'color-scheme': dark ? 'dark' : 'light',
  };
}

// Adds (or refreshes) a stylesheet holding every custom theme.
export function installCustomThemes(themes = []) {
  let style = document.getElementById('custom-themes');
  if (!style) {
    style = document.createElement('style');
    style.id = 'custom-themes';
    document.head.append(style);
  }
  style.textContent = themes
    .map((t) => {
      const body = Object.entries(paletteFrom(t.colors)).map(([k, v]) => `  ${k}: ${v};`).join('\n');
      return `:root[data-theme='${t.id}'] {\n${body}\n}`;
    })
    .join('\n');
}

// The five colors of whatever theme is showing now (a starting point for a new theme).
export function currentColors() {
  const css = getComputedStyle(document.documentElement);
  const read = (name) => {
    const v = css.getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : null;
  };
  return {
    bg: read('--bg') || '#1e1f22',
    sidebar: read('--sidebar') || '#17181a',
    surface: read('--surface') || '#26272b',
    text: read('--text') || '#ececec',
    accent: read('--accent') || '#3f7480',
  };
}

// The theme's Dock icon as a PNG data URL, drawn the same way as the built-in ones.
export async function renderIcon(colors) {
  const dark = isDark(colors);
  const svg = iconSvg({
    bg: dark ? [mix(colors.bg, '#ffffff', 0.08), mix(colors.bg, '#000000', 0.35)] : [mix(colors.bg, '#ffffff', 0.5), mix(colors.bg, '#000000', 0.08)],
    mark: [mix(colors.accent, '#ffffff', 0.25), colors.accent],
    light: !dark,
  });
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  canvas.getContext('2d').drawImage(image, 0, 0, 512, 512);
  return canvas.toDataURL('image/png');
}
