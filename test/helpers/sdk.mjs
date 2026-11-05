export function query(input) {
  (globalThis.sdkCalls ??= []).push(input);
  return (async function* () {
    if (globalThis.sdkWait) await globalThis.sdkWait;
    if (globalThis.sdkError) throw globalThis.sdkError;
    for (const message of globalThis.sdkMessages || []) yield message;
  })();
}
export const createSdkMcpServer = () => ({});
export const tool = () => ({});
