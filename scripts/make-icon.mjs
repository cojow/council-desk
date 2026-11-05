// Draws the app icon in every theme's colors: a rounded tile with the Council Desk mark.
// Writes build/icon.png (the .app icon, Warm), src/renderer/assets/icon.png (welcome
// screen), src/assets/dock/<theme>.png (the Dock icon for each theme) and the menu bar icon.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { iconSvg } from '../src/shared/icon-svg.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// bg: top and bottom of the background gradient; mark: gradient ends of the mark.
const ICONS = {
  warm: { bg: ['#fbf8f2', '#e6dfd1'], mark: ['#3f7480', '#22474f'], light: true },
  midnight: { bg: ['#1f222b', '#0b0d12'], mark: ['#ffa27a', '#ff6a30'] },
  nord: { bg: ['#3e4657', '#232831'], mark: ['#bfe6f0', '#7fb6c6'] },
  forest: { bg: ['#203027', '#0b130e'], mark: ['#c0efcb', '#6fbf82'] },
  dusk: { bg: ['#2e2048', '#120b1d'], mark: ['#ff9a5a', '#ff5fc4'], glow: true },
  'red-neon': { bg: ['#16070a', '#020203'], mark: ['#ff7a6a', '#ff1414'], glow: true, grid: '#ff2d2d' },
  'cyan-neon': { bg: ['#06121c', '#010306'], mark: ['#c4f8ff', '#20d8ff'], glow: true, grid: '#2de2ff' },
  terminal: { bg: ['#161916', '#060706'], mark: ['#e6ff8a', '#a8d816'], glow: true },
  paper: { bg: ['#ffffff', '#e9edf3'], mark: ['#6a8dff', '#2f5bea'], light: true },
  sandstone: { bg: ['#f8f2e8', '#e2d5bf'], mark: ['#45a19c', '#2a6f6c'], light: true },
};

const dockDir = path.join(root, 'src/assets/dock');
fs.mkdirSync(dockDir, { recursive: true });
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.mkdirSync(path.join(root, 'src/renderer/assets'), { recursive: true });

for (const [id, palette] of Object.entries(ICONS)) {
  await sharp(Buffer.from(iconSvg(palette))).resize(512, 512).png().toFile(path.join(dockDir, `${id}.png`));
}
const warm = Buffer.from(iconSvg(ICONS.warm));
await sharp(warm).png().toFile(path.join(root, 'build/icon.png'));
await sharp(warm).resize(256, 256).png().toFile(path.join(root, 'src/renderer/assets/icon.png'));
// Menu bar icon: the mark drawn in black; macOS recolors "Template" images itself.
const trayGlyph = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16">
  <circle cx="4.3" cy="7" r="1.6" fill="#000" />
  <circle cx="8" cy="5.6" r="1.6" fill="#000" />
  <circle cx="11.7" cy="7" r="1.6" fill="#000" />
  <rect x="2.2" y="9.6" width="11.6" height="2.2" rx="1.1" fill="#000" />
</svg>`;
await sharp(Buffer.from(trayGlyph(16))).png().toFile(path.join(root, 'src/assets/trayTemplate.png'));
await sharp(Buffer.from(trayGlyph(32))).png().toFile(path.join(root, 'src/assets/trayTemplate@2x.png'));

console.log(`wrote ${Object.keys(ICONS).length} dock icons, the menu bar icon, build/icon.png and src/renderer/assets/icon.png`);
