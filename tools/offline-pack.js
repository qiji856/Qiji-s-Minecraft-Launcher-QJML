'use strict';
/* 离线打包（Windows）：用本地已下载的 electron 二进制 + 项目源码，
 * 拼出一个可直接双击运行的绿色版目录。
 * 不需要下载 nsis / winCodeSign（electron-builder 在慢速网络下会长时间卡住）。
 *
 * 用法： node tools/offline-pack.js
 * 产物： dist/launcher-v1/QJML.exe（双击即用）
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const electronDir = path.join(root, 'node_modules', 'electron');
const electronDist = path.join(electronDir, 'dist');
const electronExe = path.join(electronDist, 'electron.exe');
const outDir = path.join(root, 'dist', 'QJML');
const appDir = path.join(outDir, 'resources', 'app');

function log(s) { console.log(s); }
function sh(cmd, args) {
  try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; }
  catch (e) { return false; }
}
// robocopy 返回码 <8 表示成功
function copyDir(src, dst, file) {
  const args = [src, dst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'];
  if (file) args.push(file);
  try { execFileSync('robocopy', args, { stdio: 'ignore' }); } catch (e) {
    if (e.status === undefined || e.status >= 8) log('  [警告] robocopy ' + src + ' 状态码 ' + e.status);
  }
}

if (!fs.existsSync(electronExe)) {
  console.error('找不到本地 electron.exe：' + electronExe);
  console.error('请先在项目目录执行： npm install');
  process.exit(1);
}

// 1. 准备目录（增量覆盖；不做递归删除，避免沙箱里 rm 被劫持成回收站操作）
fs.mkdirSync(appDir, { recursive: true });
fs.mkdirSync(path.join(appDir, 'node_modules'), { recursive: true });

// 2. electron 运行时（除 resources 外全部拷过去）
copyDir(electronDist, outDir);
log('已拷贝 electron 运行时');

// 3. 应用源码
for (const f of ['main.js', 'preload.js']) {
  fs.copyFileSync(path.join(root, f), path.join(appDir, f));
}
copyDir(path.join(root, 'src'), path.join(appDir, 'src'));
log('已拷贝应用源码');

// 4. 生产依赖（递归解析传递依赖，避免漏掉 setimmediate / immediate 这类间接依赖）
const pkgJson = require(path.join(root, 'package.json'));
const prodDeps = Object.keys(pkgJson.dependencies || {});
const depSet = new Set();
function collectDeps(name) {
  if (depSet.has(name)) return;
  const dir = path.join(root, 'node_modules', name);
  if (!fs.existsSync(path.join(dir, 'package.json'))) return;
  depSet.add(name);
  let deps = {};
  try { deps = require(path.join(dir, 'package.json')).dependencies || {}; } catch (_) {}
  for (const d of Object.keys(deps)) collectDeps(d);
}
for (const d of prodDeps) collectDeps(d);
for (const dep of depSet) {
  const src = path.join(root, 'node_modules', dep);
  copyDir(src, path.join(appDir, 'node_modules', dep));
}
log('已打包依赖（含传递依赖，共 ' + depSet.size + ' 个）：' + [...depSet].join(', '));

// 5. 精简 package.json
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
  name: pkgJson.name, version: pkgJson.version, description: pkgJson.description,
  main: 'main.js', author: pkgJson.author, license: pkgJson.license,
  dependencies: pkgJson.dependencies,
}, null, 2));

// 6. 启动 exe（用 electron.exe 复制并重命名为 QJML.exe）
const exeSrc = path.join(electronDist, 'electron.exe');
const exeDst = path.join(outDir, 'QJML.exe');
if (fs.existsSync(exeSrc)) {
  fs.copyFileSync(exeSrc, exeDst);
  log('已生成启动器：' + exeDst);
} else {
  log('[警告] 找不到 electron.exe：' + exeSrc);
}

// 7. 说明
fs.writeFileSync(path.join(outDir, '使用说明.txt'), [
  'QJML（绿色免安装版）', '',
  '使用方法：双击「QJML.exe」即可运行，无需安装、无需配置环境。', '',
  '目录说明：',
  '  resources/app/                应用源码（main.js / preload.js / src/）',
  '  resources/app/node_modules/   运行时依赖',
  '  其余 electron.exe 与 dll 为运行时文件，请勿删除', '',
  '首次运行会在 exe 同级目录创建 .minecraft 作为游戏目录；',
  '你也可以在「高级 → 设置 → 游戏存放路径」里指向别处（例如 HMCL/PCL 的目录），',
  '这样别的启动器下过的游戏能直接复用。', '',
  '如需生成 NSIS 安装版 exe，在网络正常的机器上执行：',
  '  npm install',
  '  npm run dist',
].join('\n'), 'utf8');

log('\n打包完成：' + outDir);
log('双击 ' + path.join(outDir, 'QJML.exe') + ' 即可运行');
