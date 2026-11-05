import test from 'node:test';
import assert from 'node:assert/strict';
import { toWebUrl } from '../src/shared/web-url.js';
import { PRESETS, THEME_VOICES, voiceText, voicePrompt } from '../src/shared/voices.js';

test('web URLs normalize hosts and loopback ports while rejecting executable and non-web schemes', () => {
  for (const [input, expected] of [
    ['', null], [null, null], ['   ', null],
    [' example.com/path?q=1 ', 'https://example.com/path?q=1'],
    ['https://example.com', 'https://example.com'], ['HTTP://example.com', 'HTTP://example.com'],
    ['localhost:3000', 'http://localhost:3000'], ['localhost/path', 'http://localhost/path'],
    ['127.0.0.1:8080', 'http://127.0.0.1:8080'], ['[::1]:3000', 'http://[::1]:3000'],
    ['0.0.0.0:8080', 'http://0.0.0.0:8080'],
    ['localhost.example.com', 'https://localhost.example.com'],
    ['example.com:8443', 'https://example.com:8443'],
    ['javascript:alert(1)', null], ['DATA:text/html,hello', null], ['file:///tmp/test', null],
    ['about:blank', null], ['blob:https://example.com/id', null], ['mailto:reader@example.com', null],
    ['view-source:https://example.com', null], ['ftp://example.com', null], ['custom://example.com', null],
  ]) assert.equal(toWebUrl(input), expected, String(input));
});

test('voices contain only descriptive presets; removed character presets fall back to the default', () => {
  assert.deepEqual(PRESETS.map((voice) => voice.id), ['default', 'concise', 'teacher', 'academic', 'colleague']);
  assert.deepEqual(Object.keys(THEME_VOICES).sort(), ['warm', 'midnight', 'nord', 'forest', 'dusk', 'red-neon', 'cyan-neon', 'terminal', 'paper', 'sandstone'].sort());
  assert.doesNotMatch(JSON.stringify([PRESETS, THEME_VOICES]), /\b(?:yoda|gandalf|sherlock|pirate|shakespeare|spock)\b/i);
  assert.equal(voiceText(), '');
  assert.equal(voicePrompt({ voice: { mode: 'preset', preset: 'removed-character' } }), '');
  for (const preset of PRESETS) assert.equal(voiceText({ voice: { mode: 'preset', preset: preset.id } }), preset.text);
});

test('custom and theme voices trim text and limit the prompt to conversation with the user', () => {
  assert.equal(voiceText({ voice: { mode: 'custom', custom: '  Plain and clear.  ' } }), 'Plain and clear.');
  assert.equal(voiceText({ voice: { mode: 'theme' }, theme: 'warm' }), THEME_VOICES.warm);
  assert.equal(voiceText({ voice: { mode: 'theme' }, theme: 'unknown' }), '');
  const settings = { voice: { mode: 'theme' }, theme: 'mine', customThemes: [{ id: 'mine', voice: '  Calm.  ' }] };
  assert.equal(voiceText(settings), 'Calm.');
  const prompt = voicePrompt(settings);
  assert.match(prompt, /use this voice: Calm\./);
  assert.match(prompt, /Keep code, comments, commit messages, file contents/);
  assert.match(prompt, /drop the voice if the user asks/);
  assert.equal(voicePrompt({ voice: { mode: 'custom', custom: '  ' } }), '');
});
