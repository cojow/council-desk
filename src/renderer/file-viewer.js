// A side panel that shows a file: code with line numbers and theme-colored syntax,
// images as pictures. Read-only; buttons open it in its usual app or in Finder.
import hljs from '../../node_modules/@highlightjs/cdn-assets/es/highlight.min.js';
import fortran from '../../node_modules/@highlightjs/cdn-assets/es/languages/fortran.min.js';
import julia from '../../node_modules/@highlightjs/cdn-assets/es/languages/julia.min.js';
import latex from '../../node_modules/@highlightjs/cdn-assets/es/languages/latex.min.js';
import matlab from '../../node_modules/@highlightjs/cdn-assets/es/languages/matlab.min.js';
import { base, h, ICONS, svg } from './tools.js';

// Common languages come with the bundle; these extras are common in research code.
for (const [name, language] of Object.entries({ fortran, julia, latex, matlab })) hljs.registerLanguage(name, language);

const LANGUAGES = {
  py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  json: 'json', md: 'markdown', sh: 'bash', zsh: 'bash', bash: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini',
  html: 'xml', xml: 'xml', svg: 'xml', css: 'css', scss: 'scss', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', java: 'java',
  rs: 'rust', go: 'go', rb: 'ruby', r: 'r', R: 'r', m: 'matlab', jl: 'julia', sql: 'sql', swift: 'swift', kt: 'kotlin', tex: 'latex',
  f: 'fortran', f90: 'fortran', f95: 'fortran',
  csv: 'plaintext', txt: 'plaintext', ipynb: 'json',
};
const MAX_HIGHLIGHT_CHARS = 400000;

const sizeText = (bytes) => (bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : bytes > 1e3 ? `${Math.round(bytes / 1e3)} KB` : `${bytes} B`);

export function createFileViewer({ api, container, getCwd, onShow }) {
  let currentPath = null;

  function close() {
    container.hidden = true;
    container.replaceChildren();
    document.body.classList.remove('viewer-open');
    currentPath = null;
  }

  function codeView(content, file) {
    const ext = file.split('.').pop();
    const language = LANGUAGES[ext] && hljs.getLanguage(LANGUAGES[ext]) ? LANGUAGES[ext] : null;
    let html;
    if (content.length > MAX_HIGHLIGHT_CHARS) html = null;
    else if (language) html = hljs.highlight(content, { language, ignoreIllegals: true }).value;
    else if (content.length < 100000) html = hljs.highlightAuto(content).value;
    const code = h('code', { class: 'hljs' });
    if (html != null) code.innerHTML = html;
    else code.textContent = content;
    const lines = content.split('\n').length;
    const gutter = h('pre', { class: 'viewer-gutter', 'aria-hidden': 'true' }, Array.from({ length: lines }, (_, i) => i + 1).join('\n'));
    return h('div', { class: 'viewer-code' }, gutter, h('pre', { class: 'viewer-text' }, code));
  }

  async function open(file) {
    onShow?.();
    currentPath = file;
    const cwd = getCwd();
    const shown = cwd && file.startsWith(`${cwd}/`) ? file.slice(cwd.length + 1) : file;
    const body = h('div', { class: 'viewer-body' }, h('div', { class: 'muted viewer-note' }, 'Loading…'));
    container.replaceChildren(
      h(
        'div',
        { class: 'viewer-head' },
        h('div', { class: 'viewer-title' }, h('span', { class: 'viewer-name' }, base(file)), h('span', { class: 'viewer-path', title: file }, shown)),
        h('button', { class: 'btn link', title: 'Open in its usual app', onclick: () => api.app.openPath(file) }, 'Open'),
        h('button', { class: 'btn link', title: 'Show in Finder', onclick: () => api.app.reveal(file) }, 'Finder'),
        h('button', { class: 'icon-btn', title: 'Close (Esc)', 'aria-label': 'Close', onclick: close }, svg(ICONS.x)),
      ),
      body,
    );
    container.hidden = false;
    document.body.classList.add('viewer-open');
    try {
      const result = await api.files.read(file);
      if (currentPath !== file) return;
      if (result.image) body.replaceChildren(h('div', { class: 'viewer-image' }, h('img', { src: result.image, alt: base(file) })));
      else if (result.binary || result.tooLarge)
        body.replaceChildren(
          h('div', { class: 'muted viewer-note' }, `${result.binary ? 'This file is not text' : 'This file is too large to show here'} (${sizeText(result.size)}). Use Open to view it in its usual app.`),
        );
      else body.replaceChildren(codeView(result.content, file));
    } catch (error) {
      body.replaceChildren(h('div', { class: 'note error viewer-note' }, `Could not open the file: ${String(error.message).replace(/^Error invoking remote method '[^']+': /, '')}`));
    }
  }

  return { open, close, isOpen: () => !container.hidden };
}
