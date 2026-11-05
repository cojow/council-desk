// Full-text search over session transcripts (<config>/projects/<project>/<session>.jsonl).
// Only the conversation text is searched: your messages and Claude's replies, not tool
// output or metadata. Each file's text is cached until the file changes. Reading is async
// and yields between files, so a search never freezes the window; newest sessions first.
import fs from 'node:fs';
import path from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';

const MAX_RESULTS = 50;

function messageText(entry) {
  if (entry.isMeta || (entry.type !== 'user' && entry.type !== 'assistant')) return '';
  const content = entry.message?.content;
  if (typeof content === 'string') return content.startsWith('<') ? '' : content;
  if (!Array.isArray(content)) return '';
  return content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
}

function snippetAround(text, index, length) {
  const start = Math.max(0, index - 18);
  const end = Math.min(text.length, index + length + 90);
  return `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

export function createSearch(projectsDir) {
  const cache = new Map(); // file -> { mtimeMs, size, text, lower }

  async function textOf(file, stat) {
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit;
    const parts = [];
    for (const line of (await fs.promises.readFile(file, 'utf8')).split('\n')) {
      if (!line) continue;
      try {
        const text = messageText(JSON.parse(line));
        if (text) parts.push(text);
      } catch {}
    }
    const text = parts.join('\n');
    const entry = { mtimeMs: stat.mtimeMs, size: stat.size, text, lower: text.toLowerCase() };
    cache.set(file, entry);
    return entry;
  }

  // Every transcript with its stat, newest first.
  async function transcripts() {
    const files = [];
    for (const project of await fs.promises.readdir(projectsDir, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const dir = path.join(projectsDir, project.name);
      for (const name of await fs.promises.readdir(dir).catch(() => [])) {
        if (!name.endsWith('.jsonl')) continue;
        const file = path.join(dir, name);
        const stat = await fs.promises.stat(file).catch(() => null);
        if (stat?.isFile()) files.push({ file, name, stat });
      }
    }
    return files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  }

  return async function search(query) {
    const needle = String(query || '').trim().toLowerCase();
    if (needle.length < 2 || !fs.existsSync(projectsDir)) return [];
    const results = [];
    for (const { file, name, stat } of await transcripts()) {
      try {
        const { text, lower } = await textOf(file, stat);
        const index = lower.indexOf(needle);
        if (index >= 0) results.push({ sessionId: name.slice(0, -6), snippet: snippetAround(text, index, needle.length) });
      } catch {}
      if (results.length >= MAX_RESULTS) break;
      await nextTurn();
    }
    return results;
  };
}
