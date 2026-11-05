// The app icon as SVG: a rounded tile with the Council Desk mark, three seats around a
// desk. Shared by the build script (scripts/make-icon.mjs) and the app, which draws icons
// for your own themes.
// palette: { bg: [top, bottom], mark: [start, end], glow?, grid?, light? }
export function iconSvg({ bg, mark, glow, grid, light }) {
  const gridLines = grid
    ? Array.from({ length: 11 }, (_, i) => {
        const p = 100 + i * 82.4;
        return `<line x1="${p}" y1="100" x2="${p}" y2="924" /><line x1="100" y1="${p}" x2="924" y2="${p}" />`;
      }).join('')
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg[0]}" /><stop offset="1" stop-color="${bg[1]}" /></linearGradient>
    <linearGradient id="mark" gradientUnits="userSpaceOnUse" x1="262" y1="300" x2="762" y2="720"><stop offset="0" stop-color="${mark[0]}" /><stop offset="1" stop-color="${mark[1]}" /></linearGradient>
    <clipPath id="tile"><rect x="100" y="100" width="824" height="824" rx="186" /></clipPath>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="16" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)" />
  ${grid ? `<g clip-path="url(#tile)" stroke="${grid}" stroke-opacity="0.16" stroke-width="2">${gridLines}</g>` : ''}
  <rect x="100.5" y="100.5" width="823" height="823" rx="186" fill="none" stroke="${light ? '#000000' : grid || '#ffffff'}" stroke-opacity="${light ? 0.08 : grid ? 0.5 : 0.08}" stroke-width="3" />
  <g fill="url(#mark)"${glow ? ' filter="url(#glow)"' : ''}>
    <circle cx="332" cy="468" r="70" />
    <circle cx="512" cy="398" r="70" />
    <circle cx="692" cy="468" r="70" />
    <rect x="232" y="600" width="560" height="96" rx="48" />
  </g>
</svg>`;
}
