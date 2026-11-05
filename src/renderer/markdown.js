import { marked } from '../../node_modules/marked/lib/marked.esm.js';
import DOMPurify from '../../node_modules/dompurify/dist/purify.es.mjs';

marked.setOptions({ gfm: true, breaks: false });

// Links open in the default browser (the main process routes target=_blank there).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  // The only class kept is a code block's language; the app's own classes could draw a
  // convincing fake dialog. The only input kept is a task list's read-only checkbox.
  const cls = node.getAttribute?.('class');
  if (cls && !(node.tagName === 'CODE' && /^language-[\w+#.-]+$/.test(cls))) node.removeAttribute('class');
  if (node.tagName === 'INPUT') {
    if (node.getAttribute('type') === 'checkbox') node.setAttribute('disabled', '');
    else node.remove();
  }
});

// Only what Markdown itself produces: text from Claude (which can be steered by files or web
// pages it reads) must not be able to restyle the app, draw forms, or imitate its dialogs,
// e.g. hide what a permission card is asking to run.
const SANITIZE = {
  ALLOWED_TAGS: ['a', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'kbd', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'],
  ALLOWED_ATTR: ['align', 'alt', 'checked', 'class', 'colspan', 'href', 'rowspan', 'src', 'start', 'title', 'type'],
};

export function renderMarkdown(el, text) {
  el.innerHTML = DOMPurify.sanitize(marked.parse(text || ''), SANITIZE);
  for (const pre of el.querySelectorAll('pre')) {
    const button = document.createElement('button');
    button.className = 'copy-btn';
    button.textContent = 'Copy';
    button.addEventListener('click', () => {
      navigator.clipboard.writeText(pre.querySelector('code')?.innerText ?? pre.innerText);
      button.textContent = 'Copied';
      setTimeout(() => (button.textContent = 'Copy'), 1200);
    });
    pre.appendChild(button);
  }
}
