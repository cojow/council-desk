// Your Anthropic API key, when you enter it in the app rather than set ANTHROPIC_API_KEY in
// your environment. It is encrypted with Electron's safeStorage (the macOS Keychain holds
// the encryption key) and kept in the app's settings folder. It stays in this module's memory
// and is handed only to the Claude Code engine (engineEnv), so terminals, git and other
// helper processes don't inherit it. It never goes back to the window or into a log.
import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';

// A key set in your environment always wins; the app never replaces or removes it.
export function createApiKey({ dir }) {
  const file = path.join(dir, 'anthropic-api-key.bin');
  const fromEnvironment = Boolean(process.env.ANTHROPIC_API_KEY);
  let saved = null;
  const issued = new Set();

  // Call once the app is ready (safeStorage needs it).
  function load() {
    if (fromEnvironment || !fs.existsSync(file)) return;
    try {
      saved = safeStorage.decryptString(fs.readFileSync(file));
    } catch {
      // Unreadable (e.g. copied from another Mac): treat it as no key; saving a new one replaces it.
    }
  }

  function save(key) {
    if (fromEnvironment) throw new Error('ANTHROPIC_API_KEY is set in your environment, and that key is used. Remove it there to use a key saved here.');
    const value = String(key || '').trim();
    if (!value || /\s/.test(value) || value.length > 400) throw new Error("That doesn't look like an API key.");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("This Mac can't encrypt the key right now, so it wasn't saved. Set ANTHROPIC_API_KEY in your environment instead.");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, safeStorage.encryptString(value), { mode: 0o600 });
    saved = value;
    return status();
  }

  function clear() {
    fs.rmSync(file, { force: true });
    saved = null;
    return status();
  }

  // Where the key comes from: 'environment', 'saved' or null. Never the key itself.
  const status = () => ({ source: fromEnvironment ? 'environment' : saved ? 'saved' : null });

  // The environment for a Claude Code process, with a saved key added. Claude Code passes its
  // environment on to the commands and connectors it starts. Its setting to stop that
  // (CLAUDE_CODE_SUBPROCESS_ENV_SCRUB) also forces every session to the default permission
  // mode, so the app leaves that choice to you.
  function engineEnv(extra = {}) {
    if (fromEnvironment || !saved) return { ...process.env, ...extra };
    issued.add(saved);
    return { ...process.env, ANTHROPIC_API_KEY: saved, ...extra };
  }

  // Removes saved keys from text on its way to the log, including a replaced or removed key,
  // which a Claude Code process that's still running can hold.
  const redact = (text) => [...issued].reduce((out, key) => out.replaceAll(key, '[API key]'), String(text));

  return { load, save, clear, status, engineEnv, redact };
}
