// Replace only the external boundaries exercised by schedules/account tests.
// Production modules are imported unchanged; no installed SDK or CLI is executed.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: new URL('./electron.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (specifier === '@anthropic-ai/claude-agent-sdk') {
    return { url: new URL('./sdk.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (specifier === './env.js' && context.parentURL?.endsWith('/src/main/account.js')) {
    return {
      url: 'data:text/javascript,export const CLAUDE_BIN = process.env.TEST_CLAUDE_BIN;',
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
