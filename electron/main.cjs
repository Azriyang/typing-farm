/* ============================================================
   electron/main.cjs — 桌面壳主进程
   ------------------------------------------------------------
   只负责：建窗口、加载 dist、调用 ipc.cjs 注册接口。
   存档与 LLM 代理的实现都在 ipc.cjs（便于单独做冒烟测试）。
   ============================================================ */

const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const { registerIpc } = require('./ipc.cjs');

const DIST = path.join(__dirname, '..', 'dist');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#2d2016',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // 游戏是 ES module，必须走 file:// 下的 dist/index.html；
  // 相对路径资源由 vite 的 base: './' 保证
  win.loadFile(path.join(DIST, 'index.html'));

  // 外链交给系统浏览器，不在游戏窗口里跑
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(() => {
  const userDir = app.getPath('userData');
  registerIpc({
    saveDir: path.join(userDir, 'saves'),
    configPath: path.join(userDir, 'llm.json')
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
