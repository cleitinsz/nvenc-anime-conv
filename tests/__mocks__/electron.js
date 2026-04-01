module.exports = {
  app: {
    getPath: jest.fn(() => "/tmp/fake-userData"),
    whenReady: jest.fn(() => Promise.resolve()),
    on: jest.fn(),
    quit: jest.fn(),
  },
  BrowserWindow: jest.fn().mockImplementation(() => ({
    loadFile: jest.fn(),
    webContents: { on: jest.fn(), send: jest.fn() },
  })),
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
  },
  dialog: { showOpenDialog: jest.fn() },
  shell:  { openPath: jest.fn() },
  Notification: Object.assign(
    jest.fn().mockImplementation(() => ({ show: jest.fn() })),
    { isSupported: jest.fn(() => false) }
  ),
};
