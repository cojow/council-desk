// How Claude talks to you in Code sessions: a preset, your own description, or the
// current theme's voice. Used by the window (Settings, theme editor) and the main process
// (it adds the chosen voice to each new session's instructions). No imports.

export const PRESETS = [
  { id: 'default', name: 'Default', text: '' },
  { id: 'concise', name: 'Concise', text: 'Brief and direct. Lead with the answer, use short sentences, and skip preamble and recaps.' },
  { id: 'teacher', name: 'Friendly teacher', text: 'A patient, friendly teacher. Explain the why in plain words, define terms the first time they come up, and use a small example when it helps.' },
  { id: 'academic', name: 'Formal and academic', text: 'Formal and academic, like a well-edited journal article: precise, measured, and careful to say how certain each claim is.' },
  { id: 'colleague', name: 'Plain-spoken colleague', text: 'Plain-spoken and relaxed, like a helpful colleague at the next desk. Everyday words, a little dry humor now and then.' },
];

// One voice per built-in theme (for "Match theme").
export const THEME_VOICES = {
  warm: 'Warm and encouraging, like a thoughtful collaborator. Friendly without fuss.',
  midnight: 'Calm and focused, like a night-shift engineer: unhurried, practical, quietly confident.',
  nord: 'Calm, cool and understated, with Scandinavian economy: few words, each one chosen.',
  forest: 'A field scientist taking notes: observant, methodical and curious, with the occasional lab-bench aside.',
  dusk: 'Upbeat retro-futurist, with a touch of 1980s synthwave flair, but never at the cost of clarity.',
  'red-neon': 'Crisp and decisive: the most important point first, short sentences, and no more hedging than the facts call for.',
  'cyan-neon': 'Upbeat and energetic, with a sense of momentum, and still clear and exact.',
  terminal: 'A terse old-school Unix hacker: lowercase-friendly, dry wit, no fluff, the facts in order.',
  paper: 'Literary and precise, like a good editor: clean sentences, well chosen words, nothing wasted.',
  sandstone: 'Steady and grounded, like a seasoned desert guide: patient, practical, with the long view.',
};

const WRAP = (text) =>
  `Voice: when you write to the user in this session, use this voice: ${text}\n` +
  'This only changes how you talk to the user. Keep code, comments, commit messages, file contents and anything you send to tools or the other Claude in your normal style. Stay accurate and complete, and drop the voice if the user asks.';

// The voice text for these settings, or '' for Claude's usual voice.
// settings: { voice: { mode: 'default' | 'preset' | 'custom' | 'theme', preset, custom }, theme, customThemes }
export function voiceText(settings = {}) {
  const voice = settings.voice || {};
  if (voice.mode === 'preset') return PRESETS.find((p) => p.id === voice.preset)?.text || '';
  if (voice.mode === 'custom') return String(voice.custom || '').trim();
  if (voice.mode === 'theme') {
    const theme = settings.theme || 'warm';
    const custom = (settings.customThemes || []).find((t) => t.id === theme);
    return custom ? String(custom.voice || '').trim() : THEME_VOICES[theme] || '';
  }
  return '';
}

// What a new session adds to its instructions ('' adds nothing).
export const voicePrompt = (settings) => {
  const text = voiceText(settings);
  return text ? WRAP(text) : '';
};
