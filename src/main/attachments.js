// Turns the composer's text and attachments into a user message's content.
// Images go in as image blocks (Claude sees them directly); other files are
// listed by path so Claude can open them with its Read tool.
import fs from 'node:fs';
import path from 'node:path';

const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const imageTypeFor = (file) => IMAGE_TYPES[path.extname(file).toLowerCase()] || null;

// attachments: [{ kind: 'image', path?, data?, mediaType?, name } | { kind: 'file', path, name }]
export function buildContent(text, attachments = []) {
  if (!attachments.length) return text;
  const images = [];
  const files = [];
  for (const a of attachments) {
    if (a.kind === 'image') {
      let data = a.data;
      let mediaType = a.mediaType;
      if (!data && a.path) {
        const size = fs.statSync(a.path).size;
        if (size > MAX_IMAGE_BYTES) {
          files.push(a.path);
          continue;
        }
        data = fs.readFileSync(a.path).toString('base64');
        mediaType = imageTypeFor(a.path);
      }
      if (data && mediaType) images.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
    } else if (a.path) {
      files.push(a.path);
    }
  }
  const fileNote = files.length ? `\n\nAttached files:\n${files.map((f) => `- ${f}`).join('\n')}` : '';
  return [{ type: 'text', text: `${text}${fileNote}`.trim() || 'See the attached image.' }, ...images];
}
