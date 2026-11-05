'use strict';
// 构建前同步：把 src/core/version.js 里的显示版本号（1.00 / 2.00 …）写进 package.json。
//
// 为什么需要：npm / electron-builder 要求 package.json 的 version 是合法 semver，
// 而我们的显示版本号用两位小数（1.00、1.01、2.00），semver 不接受前导零（1.00 会被当成 1.0）。
// 所以这里：package.json 存合法 semver（1.0.0），显示版本号只存在于 version.js，
// 安装包文件名则由 artifactName 里的 QJML-Setup-${ext} 形式在构建时生成。
//
// 用法：node tools/sync-version.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const verPath = path.join(root, 'src', 'core', 'version.js');

const src = fs.readFileSync(verPath, 'utf8');
const m = src.match(/const APP_VERSION\s*=\s*'([^']+)'/);
if (!m) {
  console.error('在 src/core/version.js 里找不到 APP_VERSION');
  process.exit(1);
}
const display = m[1]; // 例如 1.00 / 3.0.0 / 3.0.1
// 显示版本号 → 合法 semver：1.00 → 1.0.0；3.0.0 → 3.0.0；3.0.1 → 3.0.1
// （三段式也要正确映射，否则 3.0.1 会被算成 3.0.0）
const parts = display.split('.');
const num = (v) => parseInt(v, 10) || 0;
const semver = parts.length === 1
  ? `${parts[0]}.0.0`
  : parts.length === 2
    ? `${parts[0]}.${num(parts[1])}.0`
    : `${parts[0]}.${num(parts[1])}.${num(parts[2])}`;

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.version !== semver) {
  pkg.version = semver;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`package.json version: ${semver}（显示版本号 ${display}）`);
} else {
  console.log(`package.json version 已是 ${semver}（显示版本号 ${display}）`);
}

// artifactName 里嵌入显示版本号，保证安装包文件名跟界面一致
// （从此版本起只保留 Setup 安装版；绿色版不再叫 Portable，改由 make-zip.js 产出 QJML-Green-<版本>.zip）
const setupName = `QJML-Setup-${display}.\${ext}`;
if (pkg.build.nsis.artifactName !== setupName) {
  pkg.build.nsis.artifactName = setupName;
  // 兼容：旧字段 portable.artifactName 若存在则一并清掉
  if (pkg.build.portable && pkg.build.portable.artifactName) delete pkg.build.portable.artifactName;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`安装包文件名已同步为 ${setupName.replace('${ext}', 'exe')}（绿色版由 make-zip.js 生成 QJML-Green-${display}.zip）`);
}
