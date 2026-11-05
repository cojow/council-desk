// Composer extras: the attachment tray (picker, paste, drag and drop) and the / command menu.
import { h, ICONS, svg } from './tools.js';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FILE_ICON = '<svg viewBox="0 0 20 20"><path d="M6 3h5.5L15 6.5V16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M11 3v4h4" /></svg>';

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

// items: { kind: 'image' | 'file', path?, data?, mediaType?, name, preview? }
export function createAttachments({ api, tray, onChange }) {
  let items = [];
  let reading = Promise.resolve(); // files from paste or drop still being read

  function render() {
    tray.hidden = !items.length;
    tray.replaceChildren(
      ...items.map((item, index) =>
        h(
          'div',
          { class: 'attachment', title: item.path || item.name },
          item.preview ? h('img', { src: item.preview, alt: '' }) : h('span', { class: 'file-icon' }, svg(FILE_ICON)),
          h('span', { class: 'name' }, item.name),
          h('button', { class: 'remove', title: 'Remove', onclick: () => remove(index) }, svg(ICONS.x)),
        ),
      ),
    );
    onChange?.();
  }

  function remove(index) {
    items.splice(index, 1);
    render();
  }

  function addFiles(files) {
    const done = reading.then(() => readFiles(files));
    reading = done.catch(() => {});
    return done;
  }

  async function readFiles(files) {
    for (const file of files) {
      const path = api.files.pathFor(file);
      const isImage = IMAGE_TYPES.includes(file.type) && file.size <= MAX_IMAGE_BYTES;
      if (isImage) {
        const preview = await readAsDataUrl(file);
        items.push(
          path
            ? { kind: 'image', path, name: file.name, preview }
            : { kind: 'image', data: preview.split(',')[1], mediaType: file.type, name: file.name || 'Pasted image', preview },
        );
      } else if (path) {
        items.push({ kind: 'file', path, name: file.name });
      }
    }
    render();
  }

  async function pick() {
    items.push(...(await api.files.pick()));
    render();
  }

  return {
    pick,
    addFiles,
    list: () => items.slice(),
    ready: () => reading,
    clear() {
      items = [];
      render();
    },
    // Pasting an image (e.g. a screenshot) attaches it instead of inserting text.
    handlePaste(event) {
      const files = [...(event.clipboardData?.files || [])];
      if (!files.length) return;
      event.preventDefault();
      addFiles(files);
    },
  };
}

// Shows matching commands while the input is "/something" with no space yet.
export function createSlashMenu({ menu, input, getCommands, onRun }) {
  let matches = [];
  let index = 0;
  let token = 0;

  const hide = () => {
    menu.hidden = true;
    matches = [];
  };

  async function update() {
    const value = input.value;
    if (!/^\/\S*$/.test(value)) return hide();
    const query = value.slice(1).toLowerCase();
    const mine = ++token;
    const commands = await getCommands();
    if (mine !== token) return;
    const starts = commands.filter((c) => c.name.toLowerCase().startsWith(query));
    const contains = commands.filter((c) => !c.name.toLowerCase().startsWith(query) && c.name.toLowerCase().includes(query));
    matches = [...starts, ...contains].slice(0, 60);
    index = 0;
    render();
  }

  function render() {
    menu.hidden = false;
    if (!matches.length) {
      menu.replaceChildren(h('div', { class: 'slash-empty' }, 'No matching commands'));
      return;
    }
    menu.replaceChildren(
      ...matches.map((c, i) =>
        h(
          'div',
          { class: `slash-item${i === index ? ' on' : ''}`, role: 'option', onmousedown: (e) => (e.preventDefault(), choose(i)) },
          h('span', { class: 'cmd' }, `/${c.name}`),
          c.argumentHint ? h('span', { class: 'hint' }, c.argumentHint) : null,
          h('span', { class: 'desc' }, c.description || ''),
        ),
      ),
    );
    menu.querySelector('.slash-item.on')?.scrollIntoView({ block: 'nearest' });
  }

  // Commands that take arguments are inserted for you to finish; others run at once.
  function choose(i) {
    const command = matches[i];
    if (!command) return;
    hide();
    if (command.argumentHint) {
      input.value = `/${command.name} `;
      input.dispatchEvent(new Event('input'));
      input.focus();
    } else {
      input.value = `/${command.name}`;
      onRun();
    }
  }

  return {
    update,
    hide,
    isOpen: () => !menu.hidden,
    // Returns true when the key was used by the menu.
    handleKey(event) {
      if (menu.hidden || !matches.length) {
        if (!menu.hidden && event.key === 'Escape') return hide(), true;
        return false;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        index = (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
        render();
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') return choose(index), true;
      if (event.key === 'Escape') return hide(), true;
      return false;
    },
  };
}

// "@" file suggestions: while the word at the cursor starts with @, lists project files
// matching the rest of it; picking one inserts @relative/path so Claude reads that file.
export function createMentionMenu({ menu, input, getFiles }) {
  let matches = [];
  let index = 0;
  let token = 0;
  let range = null; // [start, end] of the @word being typed

  const hide = () => {
    menu.hidden = true;
    matches = [];
    range = null;
  };

  function rank(files, query) {
    const q = query.toLowerCase();
    if (!q) return files.slice().sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)).slice(0, 50);
    const scored = [];
    for (const file of files) {
      const lower = file.toLowerCase();
      const name = lower.slice(lower.lastIndexOf('/') + 1);
      const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : lower.includes(q) ? 2 : -1;
      if (score >= 0) scored.push([score, file]);
    }
    return scored.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length).slice(0, 50).map(([, file]) => file);
  }

  async function update() {
    const caret = input.selectionStart;
    const before = input.value.slice(0, caret);
    const match = /(^|\s)@([^\s@]*)$/.exec(before);
    if (!match || input.selectionEnd !== caret) return hide();
    range = [caret - match[2].length - 1, caret];
    const mine = ++token;
    const files = await getFiles();
    if (mine !== token) return;
    if (!files) {
      menu.hidden = false;
      menu.replaceChildren(h('div', { class: 'slash-empty' }, 'Choose a project folder to see its files.'));
      matches = [];
      return;
    }
    matches = rank(files, match[2]);
    index = 0;
    render();
  }

  function render() {
    menu.hidden = false;
    if (!matches.length) {
      menu.replaceChildren(h('div', { class: 'slash-empty' }, 'No matching files'));
      return;
    }
    menu.replaceChildren(
      ...matches.map((file, i) => {
        const cut = file.lastIndexOf('/');
        return h(
          'div',
          { class: `slash-item${i === index ? ' on' : ''}`, role: 'option', onmousedown: (e) => (e.preventDefault(), choose(i)) },
          h('span', { class: 'file-name' }, file.slice(cut + 1)),
          cut > 0 ? h('span', { class: 'desc' }, file.slice(0, cut)) : null,
        );
      }),
    );
    menu.querySelector('.slash-item.on')?.scrollIntoView({ block: 'nearest' });
  }

  function choose(i) {
    const file = matches[i];
    if (!file || !range) return;
    const [start, end] = range;
    const insert = `@${file} `;
    input.value = input.value.slice(0, start) + insert + input.value.slice(end);
    const caret = start + insert.length;
    input.setSelectionRange(caret, caret);
    hide();
    input.dispatchEvent(new Event('input'));
    input.focus();
  }

  return {
    update,
    hide,
    handleKey(event) {
      if (menu.hidden || !range) return false;
      if (event.key === 'Escape') return hide(), true;
      if (!matches.length) return false;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        index = (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
        render();
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') return choose(index), true;
      return false;
    },
  };
}
