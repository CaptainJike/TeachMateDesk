// Sandboxed Electron preload scripts must use CommonJS. ESM imports are not
// evaluated in the sandbox, which would leave the renderer without its IPC
// bridge and make model configuration appear unavailable.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("teachmate", {
  getModelConfig: () => ipcRenderer.invoke("teachmate:get-model-config"),
  saveModelConfig: (config) => ipcRenderer.invoke("teachmate:save-model-config", config),
  onOpenModelConfig: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("teachmate:open-model-config", listener);
    return () => ipcRenderer.removeListener("teachmate:open-model-config", listener);
  }
});
