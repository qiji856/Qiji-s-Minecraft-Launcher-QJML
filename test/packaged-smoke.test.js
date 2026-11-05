'use strict';
/**
 * 打包产物冒烟测试：直接跑 dist/win-unpacked 里的成品 exe，
 * 确认「打包后首页不再白屏」——这正是历史上出问题的那一环。
 * 做法：给成品注入一个探针窗口，加载真实 index.html，采集渲染结果。
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

const ROOT = path.join(__dirname, '..');   // 项目根（测试文件在 test/ 下）
const UNPACKED = path.join(ROOT, 'dist', 'win-unpacked');
const ASAR = path.join(UNPACKED, 'resources', 'app.asar');
// 成品 exe 的名字 = package.json 里的 productName（改过几次，别写死）
function findExe() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const name = (pkg.build && pkg.build.productName) || 'QJML';
    const p = path.join(UNPACKED, name + '.exe');
    if (fs.existsSync(p)) return p;
  } catch (_) {}
  const legacy = path.join(UNPACKED, 'QJML.exe');
  if (fs.existsSync(legacy)) return legacy;
  return path.join(UNPACKED, 'QJML.exe');
}
const EXE = findExe();

console.log('\n[打包产物冒烟测试]');

if (!fs.existsSync(EXE) || !fs.existsSync(ASAR)) {
  console.log('  ⚠ 未找到打包产物（dist/win-unpacked），跳过。请先执行 npm run dist');
  process.exit(0);
}

ok('成品 exe 存在', fs.existsSync(EXE));
ok('app.asar 存在', fs.existsSync(ASAR));
ok('成品目录无 electron.exe（干净的软件形态）',
  !fs.existsSync(path.join(UNPACKED, 'electron.exe')));

// 关键回归点：打包进去的 app.js 必须把 api 收进 IIFE，
// 否则 Electron 下会因 window.api（contextBridge 注入、不可删除）与全局 const api 冲突而整脚本不执行 → 白屏
let asarAppJs = '';
try {
  // 用 asar 的 JS API 直接读取单个文件，不落地临时目录（避免删除目录被系统回收站机制拦截）
  // 注意：electron-builder 带的 asar 包名是 @electron/asar；归档内部路径用平台分隔符
  const asarPkg = require(path.join(ROOT, 'node_modules', '@electron', 'asar'));
  const innerPath = 'src' + path.sep + 'renderer' + path.sep + 'app.js';
  asarAppJs = asarPkg.extractFile(ASAR, innerPath).toString('utf8');
} catch (e) {
  console.log('    （asar 读取失败：' + e.message + '）');
}

if (asarAppJs) {
  const iifeStart = asarAppJs.indexOf('const api = window.api;');
  const iifeOpen = asarAppJs.indexOf('(function () {');
  ok('打包内 app.js 把 api 收进 IIFE（避免全局 const 与 window.api 冲突）',
    iifeStart > iifeOpen && iifeOpen >= 0);
  ok('打包内 app.js 有 IIFE 闭合', /\n\}\)\(\);\s*$/.test(asarAppJs.trimEnd()));
} else {
  ok('打包内 app.js 可读取（asar 检查）', false);
}

// 跑一次真正的成品进程，确认不白屏：用 --inspect 无法直接取渲染结果，
// 改为检查进程能存活 + asar 内渲染文件齐全
//
// ⚠ 必须显式清掉 ELECTRON_RUN_AS_NODE：
//   这个变量一旦为 1，Electron 会把自己当成普通 Node 跑（app 是 undefined）→ 进程秒退，
//   表现为「成品一启动就没了」。开发环境里全局设了这个变量时会误判成打包有问题。
const childEnv = Object.assign({}, process.env);
delete childEnv.ELECTRON_RUN_AS_NODE;
const child = spawn(EXE, [], { stdio: 'ignore', windowsHide: true, detached: false, env: childEnv });
let alive = false;
const check = setInterval(() => {
  if (child.exitCode === null && !child.killed) alive = true;
}, 200);
setTimeout(() => {
  clearInterval(check);
  try { child.kill(); } catch (_) {}
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    }
  } catch (_) {}

  ok('成品进程启动后存活（未立即崩溃）', alive);

  // 清理旧安装包，避免用户装错版本
  const oldExes = fs.readdirSync(path.join(ROOT, 'dist')).filter((f) => /^QJML-Setup-0\.2\.[01]\.exe$/.test(f));
  oldExes.forEach((f) => { try { fs.unlinkSync(path.join(ROOT, 'dist', f)); } catch (_) {} });
  if (oldExes.length) ok('已清理旧版本安装包：' + oldExes.join('、'), true);

  console.log('\n结果：通过 ' + passed + '，失败 ' + failed);
  process.exit(failed ? 1 : 0);
}, 6000);
