const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  selectFolder:       ()       => ipcRenderer.invoke("select-folder"),
  selectOutputFolder: ()       => ipcRenderer.invoke("select-output-folder"),
  scanFolder:      (folder)  => ipcRenderer.invoke("scan-folder", folder),
  getConfig:       ()        => ipcRenderer.invoke("get-config"),

  setConfig:       (cfg)     => ipcRenderer.send("set-config", cfg),
  startConversion: (files)   => ipcRenderer.send("start-conversion", files),
  stopConversion:  ()        => ipcRenderer.send("stop-conversion"),
  retryErrors:     (files)   => ipcRenderer.send("retry-errors", files),
  openLogFolder:   ()        => ipcRenderer.send("open-log-folder"),

  on: (channel, cb) => {
    const allowed = [
      "log", "file-status", "slot-update", "slot-clear",
      "stats", "conversion-done", "scan-progress",
      "reset-converting", "config-loaded", "output-folder-changed",
    ];
    if (allowed.includes(channel))
      ipcRenderer.on(channel, (_, data) => cb(data));
  },
  off: (channel) => ipcRenderer.removeAllListeners(channel),
});
