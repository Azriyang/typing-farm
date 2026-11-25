/* ============================================================
   scripts/package-win.mjs — 生成 Windows 便携包
   ------------------------------------------------------------
   不做安装器，只出一个解压即玩的文件夹 + zip：
     release/TypingFarm-win32-x64/      ← 文件夹
     release/TypingFarm-win32-x64.zip   ← 发给别人这个

   结构就是把 electron 运行时和打包好的 dist 拼在一起：
     TypingFarm.exe
     resources/app/package.json
     resources/app/electron/*.cjs
     resources/app/dist/*
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'release', 'TypingFarm-win32-x64');
const ZIP = path.join(ROOT, 'release', 'TypingFarm-win32-x64.zip');

function die(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

/** 递归复制（Windows 上 robocopy 比 fs.cp 快得多） */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (process.platform === 'win32') {
    // robocopy 成功码是 0~7，8 以上才是真失败
    try {
      execFileSync('robocopy', [src, dest, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { stdio: 'ignore' });
    } catch (e) {
      if ((e.status ?? 0) >= 8) die('robocopy 失败: ' + src);
    }
    return;
  }
  fs.cpSync(src, dest, { recursive: true });
}

function mb(n) {
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function dirSize(dir) {
  let sum = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    sum += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return sum;
}

/* ---------------- 前置检查 ---------------- */

const electronDist = path.join(ROOT, 'node_modules', 'electron', 'dist');
if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
  die('找不到 electron 运行时。先跑：node node_modules/electron/install.js');
}
if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  die('找不到 dist/index.html。先跑：pnpm build');
}

/* ---------------- 组装 ---------------- */

console.log('→ 清理旧产物');
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.rmSync(ZIP, { force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

console.log('→ 复制 electron 运行时');
copyDir(electronDist, OUT_DIR);

// 主程序改名（Electron 允许直接改 exe 名字）
fs.renameSync(path.join(OUT_DIR, 'electron.exe'), path.join(OUT_DIR, 'TypingFarm.exe'));

// 语言包只留中英文，省十几 MB
const locales = path.join(OUT_DIR, 'locales');
if (fs.existsSync(locales)) {
  for (const f of fs.readdirSync(locales)) {
    if (!['zh-CN.pak', 'en-US.pak'].includes(f)) {
      fs.rmSync(path.join(locales, f), { force: true });
    }
  }
}

console.log('→ 放入应用本体');
const appDir = path.join(OUT_DIR, 'resources', 'app');
fs.mkdirSync(path.join(appDir, 'electron'), { recursive: true });
for (const f of ['main.cjs', 'ipc.cjs', 'preload.cjs']) {
  fs.copyFileSync(path.join(ROOT, 'electron', f), path.join(appDir, 'electron', f));
}
copyDir(path.join(ROOT, 'dist'), path.join(appDir, 'dist'));

// 应用清单：不要带 "type": "module"，主进程是 .cjs 自己就是 CommonJS
fs.writeFileSync(
  path.join(appDir, 'package.json'),
  JSON.stringify({
    name: 'typing-farm',
    productName: 'Typing Farm',
    version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
    description: '牧场打字物语',
    main: 'electron/main.cjs'
  }, null, 2),
  'utf8'
);

// 玩家说明
const readme = path.join(ROOT, 'release', '玩家说明.txt');
if (fs.existsSync(readme)) {
  fs.copyFileSync(readme, path.join(OUT_DIR, '先看这里.txt'));
}

/* ---------------- 压缩 ---------------- */

console.log('→ 打包 zip（这一步比较慢）');
execFileSync('powershell.exe', [
  '-NoProfile', '-Command',
  `Compress-Archive -Path '${OUT_DIR}' -DestinationPath '${ZIP}' -CompressionLevel Optimal -Force`
], { stdio: 'inherit' });

/* ---------------- 结果 ---------------- */

console.log('');
console.log('✓ 完成');
console.log('  文件夹  ' + OUT_DIR);
console.log('  zip     ' + ZIP + '  (' + mb(fs.statSync(ZIP).size) + ')');
console.log('  解压后  ' + mb(dirSize(OUT_DIR)));
console.log('');
console.log('发给别人直接用 zip，解压后双击 TypingFarm.exe。');
