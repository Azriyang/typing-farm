/* ============================================================
   electron/preload.cjs — 主进程与渲染进程之间的桥
   ------------------------------------------------------------
   只暴露白名单接口。渲染进程拿不到 require、拿不到 fs、
   也拿不到 API key（key 只存在主进程的 llm.json 里）。
   ============================================================ */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__FARM_DESKTOP__', {
  /** 真实存档文件（platform.ts 的 DesktopFileAdapter 用） */
  storage: {
    get: (key) => ipcRenderer.sendSync('storage:get', key),
    set: (key, value) => ipcRenderer.sendSync('storage:set', key, value),
    remove: (key) => ipcRenderer.sendSync('storage:remove', key)
  },

  /** LLM 代理：只说需求，不碰 key */
  llm: {
    available: () => ipcRenderer.sendSync('llm:available'),
    ask: (payload) => ipcRenderer.invoke('llm:ask', payload),
    getConfig: () => ipcRenderer.invoke('llm:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('llm:setConfig', patch)
  }
});
