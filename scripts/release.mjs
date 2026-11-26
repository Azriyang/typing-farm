/* ============================================================
   release.mjs — 发版脚本
   ------------------------------------------------------------
   用法：
     node scripts/release.mjs patch|minor|major [--push]

   做的事（顺序不可颠倒）：
     1. 检查工作区干净、在 main 分支
     2. **跑类型检查 + 单元测试**——不通过就直接退出，什么都不改
     3. 升 package.json 的版本号，并同步写入 src/version.ts
     4. 更新 README 里的版本徽标（如果有）
     5. 提交 chore(release): vX.Y.Z
     6. 打带注释的 tag vX.Y.Z
     7. 只有显式传 --push 才推送到远端（推 tag 会触发 Pages 部署）

   为什么不默认推送：部署是外部可见的动作，历史和规范都要求"一次发版只部署一次"，
   默认留在本地让人先确认 diff。
   ============================================================ */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const node = process.execPath;

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', ...opts }).trim();
}

function sh(cmd, args) {
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
}

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

/* ---------- 参数 ---------- */

const bump = process.argv[2];
if (!['patch', 'minor', 'major'].includes(bump)) {
  fail('用法：node scripts/release.mjs patch|minor|major [--push]');
}
const push = process.argv.includes('--push');

/* ---------- 1. 前置检查 ---------- */

const dirty = git(['status', '--porcelain']);
if (dirty) {
  fail(`工作区不干净，先提交或收起改动：\n${dirty}`);
}

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') {
  fail(`发版必须在 main 分支，当前是 ${branch}`);
}

/* ---------- 2. 测试闸门（先跑，不通过就什么都不改） ---------- */

console.log('[release] 类型检查');
sh(node, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit']);

console.log('[release] 单元测试');
sh(node, [path.join(root, 'scripts', 'test.mjs')]);

/* ---------- 3. 升版本 ---------- */

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const [maj, min, pat] = pkg.version.split('.').map(Number);
const next =
  bump === 'major' ? `${maj + 1}.0.0`
  : bump === 'minor' ? `${maj}.${min + 1}.0`
  : `${maj}.${min}.${pat + 1}`;

pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

const verPath = path.join(root, 'src', 'version.ts');
const verSrc = fs.readFileSync(verPath, 'utf8');
fs.writeFileSync(
  verPath,
  verSrc.replace(/export const VERSION = '[^']*';/, `export const VERSION = '${next}';`),
  'utf8'
);

console.log(`[release] 版本 ${pkg.version} → ${next}`);

/* ---------- 4. 提交 ---------- */

const tag = `v${next}`;
const existing = git(['tag', '--list', tag]);
if (existing) {
  fail(`tag ${tag} 已存在`);
}

git(['add', 'package.json', 'src/version.ts']);
git(['commit', '-m', `chore(release): ${tag}`]);
git(['tag', '-a', tag, '-m', `${tag}\n\n类型检查与单元测试均通过后打的发布标记。`]);

console.log(`[release] 已提交并打 tag ${tag}`);

/* ---------- 5. 推送（可选） ---------- */

if (push) {
  const remote = 'ssh://git@ssh.github.com:443/Azriyang/typing-farm.git';
  console.log('[release] 推送 main 与 tag（会触发 Pages 部署）');
  sh('git', ['push', remote, 'main']);
  sh('git', ['push', remote, tag]);
  console.log('[release] 已推送，部署见 Actions');
} else {
  console.log(`\n完成（仅本地）。确认无误后执行：`);
  console.log(`  git push ssh://git@ssh.github.com:443/Azriyang/typing-farm.git main`);
  console.log(`  git push ssh://git@ssh.github.com:443/Azriyang/typing-farm.git ${tag}`);
}
