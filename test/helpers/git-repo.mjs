import { createHash } from 'node:crypto';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

// Minimal SHA-1 repository fixture, including an index and one commit. Writing the
// fixture directly avoids running init/add/commit or any other Git mutation.
export function seedRepo(s, files) {
  const gitDir = path.join(s.project, '.git');
  const hash = (bytes) => createHash('sha1').update(bytes).digest();
  function object(type, content) {
    const bytes = Buffer.concat([Buffer.from(`${type} ${content.length}\0`), content]);
    const id = hash(bytes);
    const hex = id.toString('hex');
    s.write(path.join(gitDir, 'objects', hex.slice(0, 2), hex.slice(2)), deflateSync(bytes));
    return id;
  }
  const tree = [], entries = [];
  const sorted = Object.entries(files).sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  for (const [name, content] of sorted) {
    const bytes = Buffer.from(content);
    s.write(path.join(s.project, name), bytes);
    const id = object('blob', bytes);
    tree.push(Buffer.from(`100644 ${name}\0`), id);
    const filename = Buffer.from(name);
    const entry = Buffer.alloc(Math.ceil((62 + filename.length + 1) / 8) * 8);
    entry.writeUInt32BE(0o100644, 24);
    entry.writeUInt32BE(bytes.length, 36);
    id.copy(entry, 40);
    entry.writeUInt16BE(filename.length, 60);
    filename.copy(entry, 62);
    entries.push(entry);
  }
  const treeId = object('tree', Buffer.concat(tree)).toString('hex');
  const timestamp = 1_700_000_000;
  const commit = object('commit', Buffer.from(
    `tree ${treeId}\nauthor Test <test@example.com> ${timestamp} +0000\ncommitter Test <test@example.com> ${timestamp} +0000\n\nFixture\n`,
  )).toString('hex');
  s.write(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
  s.write(path.join(gitDir, 'refs/heads/main'), commit + '\n');
  s.write(path.join(gitDir, 'config'), '[core]\nrepositoryformatversion = 0\nbare = false\nfilemode = false\n');
  const header = Buffer.alloc(12);
  header.write('DIRC');
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(entries.length, 8);
  const index = Buffer.concat([header, ...entries]);
  s.write(path.join(gitDir, 'index'), Buffer.concat([index, hash(index)]));
}
