// Just enough of Electron for modules under test; nothing touches the real Keychain.
export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`sealed:${text}`),
  decryptString: (data) => String(data).replace(/^sealed:/, ''),
};
export const session = {};
export const webContents = {};
