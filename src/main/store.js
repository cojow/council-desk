// Small JSON settings file: recent folders, last mode and model.
import fs from 'node:fs';
import path from 'node:path';

// Writes to a temp file next to the target, then renames it over, so a crash mid-write
// never leaves a half-written file.
export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

// Reads a JSON file; undefined if it doesn't exist. A file that won't parse is set aside
// as <name>.corrupt-<timestamp> (and reported through onCorrupt) rather than being
// overwritten by the next save.
export function readJsonFile(file, onCorrupt) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const aside = `${file}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(file, aside);
    } catch {}
    onCorrupt?.(`${path.basename(file)} couldn't be read (${error.message}); kept it as ${path.basename(aside)}`);
    return undefined;
  }
}

export function createStore(dir) {
  const file = path.join(dir, 'settings.json');
  const saved = readJsonFile(file, (message) => console.error(message));
  let data = { recentFolders: [], mode: 'default', model: '', ...(saved && typeof saved === 'object' ? saved : {}) };

  const save = () => writeJsonAtomic(file, data);

  return {
    get: () => data,
    set(patch) {
      data = { ...data, ...patch };
      save();
      return data;
    },
    addRecentFolder(folder) {
      data.recentFolders = [folder, ...data.recentFolders.filter((f) => f !== folder)].slice(0, 12);
      save();
      return data.recentFolders;
    },
  };
}
