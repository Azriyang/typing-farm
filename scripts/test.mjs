/* ============================================================
   test.mjs — 跑单元测试
   ------------------------------------------------------------
   为什么不用 vitest / node:test：
     项目没有 @types/node，引入测试框架就得再加依赖；
     而这里只需要"编译一遍、跑一遍、失败就非零退出"。

   流程：
     1. tsc 把 src 与 tests 一起编译成 CommonJS 到 .test-build
     2. 写入 {"type":"commonjs"}（package.json 是 module，否则会按 ESM 解析报错）
     3. node 运行 .test-build/tests/all.js
   ============================================================ */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const node = process.execPath;
const outDir = path.join(root, '.test-build');

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
}

console.log('[test] 清理旧产物');
fs.rmSync(outDir, { recursive: true, force: true });

console.log('[test] 编译 src + tests');
run(node, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.test.json']);

// 输出目录内没有 package.json，Node 会按上层（type:module）解析，CommonJS 会报错
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

console.log('[test] 运行');
run(node, [path.join(outDir, 'tests', 'all.js')]);

console.log('[test] 通过');
