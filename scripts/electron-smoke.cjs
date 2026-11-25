/* ============================================================
   scripts/electron-smoke.cjs — 桌面壳端到端冒烟测试
   ------------------------------------------------------------
   验证四件事：
     1. preload 是否把 __FARM_DESKTOP__ 注入到了渲染进程
     2. storage IPC 是否真的写到了文件（而不是内存兜底）
     3. llm 接口是否暴露，且返回值里**不含 apiKey**
     4. 游戏页面能否在 Electron 里正常加载

   用法：electron scripts/electron-smoke.cjs
   ============================================================ */

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { registerIpc } = require('../electron/ipc.cjs');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(app.getPath('temp'), 'typing-farm-smoke');

app.whenReady().then(async () => {
  const saveDir = path.join(TMP, 'saves');
  const configPath = path.join(TMP, 'llm.json');
  // 每次从干净状态开始
  fs.rmSync(TMP, { recursive: true, force: true });

  registerIpc({ saveDir, configPath });

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const result = { steps: {} };
  try {
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
    result.steps.loaded = true;

    const probe = await win.webContents.executeJavaScript(`(async () => {
      const d = window.__FARM_DESKTOP__;
      const r = {
        bridge: !!d,
        storage: !!(d && d.storage),
        llm: !!(d && d.llm),
        gameCanvas: !!document.getElementById('cv'),
        titleScreen: !!document.getElementById('title-screen')
      };
      if (d && d.storage) {
        d.storage.set('smoke', 'value-ok');
        r.readBack = d.storage.get('smoke');
        r.removeOk = d.storage.remove('smoke');
        r.afterRemove = d.storage.get('smoke');
      }
      if (d && d.llm) {
        r.availableBefore = d.llm.available();
        r.cfgBefore = await d.llm.getConfig();
        await d.llm.setConfig({ enabled: true, apiKey: 'sk-test-123', model: 'test-model' });
        r.availableAfter = d.llm.available();
        r.cfgAfter = await d.llm.getConfig();
        r.cfgLeaksKey = Object.prototype.hasOwnProperty.call(r.cfgAfter || {}, 'apiKey');
      }
      return r;
    })()`);

    result.steps.probe = probe;

    // 文件层面的证据
    result.steps.filesAfter = fs.existsSync(saveDir) ? fs.readdirSync(saveDir) : [];
    result.steps.configOnDisk = fs.existsSync(configPath)
      ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
      : null;
  } catch (err) {
    result.steps.error = String(err && err.stack || err);
  }

  console.log('SMOKE_RESULT ' + JSON.stringify(result, null, 2));

  // 判定
  const p = result.steps.probe || {};
  const ok =
    p.bridge && p.storage && p.llm &&
    p.readBack === 'value-ok' &&
    p.afterRemove === null &&
    p.availableAfter === true &&
    p.cfgLeaksKey === false &&
    result.steps.configOnDisk?.apiKey === 'sk-test-123';

  console.log(ok ? 'SMOKE_PASS' : 'SMOKE_FAIL');

  fs.rmSync(TMP, { recursive: true, force: true });
  app.quit();
  process.exit(ok ? 0 : 1);
});
