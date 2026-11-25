/* ============================================================
   electron/ipc.cjs — 存档与 LLM 代理的 IPC 实现
   ------------------------------------------------------------
   从 main.cjs 抽出来，好处是能用 scripts/electron-smoke.cjs
   单独跑一遍端到端测试（不依赖真实窗口交互）。
   ============================================================ */

const { ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DEFAULT_CONFIG = {
  enabled: false,
  baseUrl: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-chat',
  apiKey: '',
  maxWords: 12
};

/**
 * @param {{ saveDir: string, configPath: string }} paths
 */
function registerIpc(paths) {
  const { saveDir, configPath } = paths;
  fs.mkdirSync(saveDir, { recursive: true });

  /* ---------------- 配置（含 API key） ---------------- */

  const readConfig = () => {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  };

  const writeConfig = (cfg) => {
    const merged = { ...DEFAULT_CONFIG, ...cfg };
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  };

  /** 给渲染进程看的配置：**不含 apiKey** */
  const publicConfig = () => {
    const c = readConfig();
    return {
      enabled: c.enabled,
      model: c.model,
      baseUrl: c.baseUrl,
      hasKey: !!c.apiKey,
      maxWords: c.maxWords
    };
  };

  /* ---------------- 存档 ---------------- */

  const keyToFile = (key) => {
    const safe = String(key).replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(saveDir, safe + '.json');
  };

  ipcMain.on('storage:get', (e, key) => {
    try {
      e.returnValue = fs.readFileSync(keyToFile(key), 'utf8');
    } catch {
      e.returnValue = null;
    }
  });

  ipcMain.on('storage:set', (e, key, value) => {
    try {
      const file = keyToFile(key);
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, String(value), 'utf8');
      fs.renameSync(tmp, file);   // 先写临时文件再改名，避免写一半崩溃留下坏档
      e.returnValue = true;
    } catch {
      e.returnValue = false;
    }
  });

  ipcMain.on('storage:remove', (e, key) => {
    try {
      fs.unlinkSync(keyToFile(key));
      e.returnValue = true;
    } catch {
      e.returnValue = false;
    }
  });

  /* ---------------- LLM 代理 ---------------- */

  ipcMain.on('llm:available', (e) => {
    const c = readConfig();
    e.returnValue = !!(c.enabled && c.apiKey);
  });

  ipcMain.handle('llm:getConfig', () => publicConfig());

  ipcMain.handle('llm:setConfig', (_e, patch) => {
    const next = readConfig();
    if (typeof patch?.enabled === 'boolean') next.enabled = patch.enabled;
    if (typeof patch?.baseUrl === 'string' && patch.baseUrl.trim()) next.baseUrl = patch.baseUrl.trim();
    if (typeof patch?.model === 'string' && patch.model.trim()) next.model = patch.model.trim();
    // 只有显式传 apiKey 才覆盖；空字符串表示清除
    if (typeof patch?.apiKey === 'string') next.apiKey = patch.apiKey.trim();
    writeConfig(next);
    return publicConfig();
  });

  /**
   * 真正发请求的地方。渲染进程只传约束，永远不碰 key。
   * 超时 12 秒——NPC 说话等不了更久，超时就退回预置台词。
   */
  ipcMain.handle('llm:ask', async (_e, payload) => {
    const cfg = readConfig();
    if (!cfg.enabled) return { ok: false, error: 'disabled' };
    if (!cfg.apiKey) return { ok: false, error: 'no-key' };

    const system = String(payload?.system ?? '');
    const user = String(payload?.user ?? '');
    if (!system || !user) return { ok: false, error: 'bad-request' };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(cfg.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + cfg.apiKey
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.9,
          max_tokens: 220,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        }),
        signal: ctrl.signal
      });
      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: 'http-' + res.status, detail: text.slice(0, 300) };
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') return { ok: false, error: 'empty' };
      return { ok: true, content };
    } catch (err) {
      clearTimeout(timer);
      return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : 'network' };
    }
  });

  return { readConfig, publicConfig };
}

module.exports = { registerIpc, DEFAULT_CONFIG };
