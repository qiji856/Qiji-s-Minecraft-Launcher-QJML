'use strict';
/* 一键发版：改版本号 → 写更新日志 → 打包 → 打绿色版 → 放进版本号专属目录。
 *
 * 用法：
 *   node tools/release.js 3.0.2 "这次的更新说明（可省略）"   ← 详细模式：说明会拆成多条
 *   node tools/release.js 3.0.2 --simple                    ← 简略模式：只写一句概括
 *
 * ★ 更新日志策略（用户 2026-11-01 定，参照微信）：
 *   · 重大变更（新增功能 / API 改动 / 大改版）→ 详细模式，逐条说清
 *   · 琐碎改动（UI 小修小补 / 功能挪位置 / 零散 bug）→ 简略模式，一句「修复了一些已知问题」带过
 *   · 判断标准：普通用户能不能感知到。感知不到的就别一条条列。
 *
 * 特点：
 *   · 版本号只增不改 —— 每次发版用新号（3.0.1 → 3.0.2 → 3.0.3 …），旧产物原样保留
 *   · 产物放到 D:\AI\QJML-<版本>-Releases\（每个版本一个独立目录，互不覆盖）
 *   · 更新日志自动追加一条；写得更细的话可以直接改 src/core/version.js 的 CHANGELOG
 *
 * 依赖：TEMP/TMP 建议指到非 C 盘；ELECTRON_BUILDER_BINARIES_MIRROR 用 npmmirror（见 README）。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const version = String(process.argv[2] || '').trim();
const rawArg = String(process.argv[3] || '').trim();
// --simple（可带自定义文案）走简略模式；否则视为详细模式的说明文字
const isSimple = /^(--simple|--brief|-s)$/i.test(rawArg) || rawArg.startsWith('--simple=');
const simpleText = rawArg.includes('=') ? rawArg.split('=').slice(1).join('=').trim() : '';
const note = isSimple ? '' : rawArg;

// 版本号两段式（3.11）或三段式（3.0.2）都允许；两段式由 sync-version.js 自动映射成 semver
if (!/^\d+\.\d+(\.\d+)?$/.test(version)) {
  console.error('用法： node tools/release.js <版本号 如 3.0.2> ["更新说明" | --simple]');
  process.exit(1);
}

const verPath = path.join(root, 'src', 'core', 'version.js');
const pkgPath = path.join(root, 'package.json');

// ---- 1. 改 src/core/version.js 的 APP_VERSION + 追加更新日志 ----
let src = fs.readFileSync(verPath, 'utf8');
const cur = (src.match(/const APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
if (cur === version) {
  console.log(`版本号已是 ${version}，跳过改写`);
} else {
  src = src.replace(/const APP_VERSION\s*=\s*'[^']+'/, `const APP_VERSION = '${version}'`);
  console.log(`版本号：${cur} → ${version}`);
}

// 更新日志里没有这个版本就追加一条（已有则不动，避免覆盖你手写的说明）
if (!new RegExp(`version:\\s*'${version.replace(/\./g, '\\.')}'`).test(src)) {
  const today = new Date();
  const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  let highlights;
  if (isSimple) {
    // 简略模式：一句话概括（微信式）—— 琐碎改动不逐条列
    highlights = [`      '${(simpleText || '修复了一些已知问题，优化了部分使用体验').replace(/'/g, "\\'")}',`];
    console.log('已追加更新日志条目（简略模式：1 条概括）');
  } else if (note) {
    highlights = note.split(/\n|；|;/).map((s) => s.trim()).filter(Boolean).map((s) => `      '${s.replace(/'/g, "\\'")}',`);
    console.log(`已追加更新日志条目（${highlights.length} 条）`);
  } else {
    highlights = [`      '${version} 正式版。',`];
    console.log('已追加更新日志条目（未给说明，用默认文案）');
  }
  const entry = `  {\n    version: '${version}',\n    date: '${d}',\n    tag: '更新',\n    highlights: [\n${highlights.join('\n')}\n    ],\n  },\n`;
  // ★ marker 用宽松匹配（容忍 CRLF / 空格差异）：严格字符串在 CRLF 文件里匹配不到会静默跳过日志插入
  const markerRe = /const CHANGELOG\s*=\s*\[\r?\n/;
  if (!markerRe.test(src)) {
    console.error('⚠ 找不到 const CHANGELOG = [ 标记，更新日志没有写入 version.js');
  }
  src = src.replace(markerRe, (m) => m + entry);
}
fs.writeFileSync(verPath, src);

// ---- 2. 同步 package.json（semver + 安装包文件名）----
execSync(`node "${path.join(root, 'tools', 'sync-version.js')}"`, { stdio: 'inherit' });

// ---- 3. 打包（NSIS 安装版）----
console.log('\n开始打包（NSIS 安装版）…');
execSync('npm run dist', { stdio: 'inherit', cwd: root });

// ---- 4. 绿色版 zip ----
console.log('\n生成绿色版…');
execSync(`node "${path.join(root, 'tools', 'make-zip.js')}" ${version}`, { stdio: 'inherit', cwd: root });

// ---- 5. 放进版本号专属目录（不覆盖旧版本）----
const outDir = `D:\\AI\\QJML-${version}-Releases`;
fs.mkdirSync(outDir, { recursive: true });
for (const f of [`QJML-Setup-${version}.exe`, `QJML-Green-${version}.zip`]) {
  const src2 = path.join(root, 'dist', f);
  if (!fs.existsSync(src2)) { console.warn('缺少产物：' + f); continue; }
  fs.copyFileSync(src2, path.join(outDir, f));
  const mb = (fs.statSync(src2).size / 1048576).toFixed(1);
  console.log(`  ✓ ${f}（${mb} MB）→ ${outDir}`);
}
console.log(`\n完成：${version} 已发布到 ${outDir}`);

// ---- 6. 收尾提示：更新服务器上的 version.json ----
console.log('\n别忘了同步更新服务器（否则用户检查不到新版本）：');
console.log(`  把服务器 version.json 的 "latest" 改成 "${version}"`);
console.log('  （记得先把新安装包传上去，再改 version.json，顺序反了会引导用户去下载还不存在的版本）');
