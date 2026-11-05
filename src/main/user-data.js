// Test runs can set COUNCIL_DESK_USER_DATA to use their own settings folder, Browser pane
// cookies and logs, so they never touch the real app's while it is open. Imported before
// anything reads app paths.
import path from 'node:path';
import { app } from 'electron';

if (process.env.COUNCIL_DESK_USER_DATA) {
  app.setPath('userData', process.env.COUNCIL_DESK_USER_DATA);
  app.setAppLogsPath(path.join(process.env.COUNCIL_DESK_USER_DATA, 'logs'));
}
