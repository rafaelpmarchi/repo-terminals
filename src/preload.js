const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Repos
  loadRepos: () => ipcRenderer.invoke('repos:load'),
  saveRepos: (repos) => ipcRenderer.invoke('repos:save', repos),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  openFolder: (path) => ipcRenderer.invoke('shell:openPath', path),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  gitInfo: (dir) => ipcRenderer.invoke('git:info', dir),
  gitBranches: (dir) => ipcRenderer.invoke('git:branches', dir),
  aiUsage: () => ipcRenderer.invoke('ai:usage'),
  pasteImage: () => ipcRenderer.invoke('clipboard:saveImage'),
  saveImageBuffer: (bytes) => ipcRenderer.invoke('clipboard:saveImageBuffer', bytes),

  // Terminais (via daemon)
  daemonSend: (msg) => ipcRenderer.send('daemon:send', msg),
  onDaemonMsg: (cb) => ipcRenderer.on('daemon:msg', (_e, msg) => cb(msg)),
});
