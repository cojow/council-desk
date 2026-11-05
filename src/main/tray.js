// The menu bar icon, shown only while "Keep running when the window is closed" is on, so
// there's a way back to the window and a way to quit.
import { Menu, nativeImage, Tray } from 'electron';

export function createTray({ store, iconPath, onOpen }) {
  let tray = null;

  function render() {
    if (!store.get().keepRunning) {
      tray?.destroy();
      tray = null;
      return;
    }
    if (tray) return;
    const icon = nativeImage.createFromPath(iconPath);
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip('Council Desk');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Council Desk', click: onOpen },
        { type: 'separator' },
        { label: 'Quit Council Desk', role: 'quit' },
      ]),
    );
  }

  return {
    render,
    stop() {
      tray?.destroy();
      tray = null;
    },
  };
}
