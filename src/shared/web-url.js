// Turns what's typed in the Browser pane's address bar (or given to Claude's navigate
// tool) into an http(s) address, or null for anything else. Used by the window and the
// main process. No imports.

// Schemes written without "//" that must not be mistaken for "host:port".
const SCHEME_ONLY = /^(about|data|file|javascript|mailto|blob|view-source):/i;
// This Mac: plain http, with or without a port.
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)(?=[:/?#]|$)/i;

export function toWebUrl(typed) {
  const t = String(typed || '').trim();
  if (!t) return null;
  // A scheme only counts when followed by "//", so "localhost:3000" is a host and port.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return /^https?:\/\//i.test(t) ? t : null;
  if (SCHEME_ONLY.test(t)) return null;
  return `${LOCAL.test(t) ? 'http' : 'https'}://${t}`;
}
