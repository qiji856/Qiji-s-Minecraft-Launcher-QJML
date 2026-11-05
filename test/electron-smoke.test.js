'use strict';
/**
 * Electron 渲染端冒烟测试：真启动一次 Electron，加载首页，断言内容真的渲染出来了。
 *
 * 为什么需要它（历史教训）：
 * 曾经出现过「打包后首页全白、按钮全失效」的故障，根因是 app.js 顶层写了
 *   const api = window.api;
 * 而 preload 通过 contextBridge.exposeInMainWorld('api', ...) 注入的 window.api
 * 是不可删除的全局属性 —— Chromium 不允许全局词法声明与同名不可删除属性共存，
 * 于是整个脚本在解析阶段就被拒绝，一行都没执行。
 *
 * 这类问题：
 *   - node --check 查不出来（它不做运行时全局环境检查）
 *   - 对比 asar 与源码也查不出来（文件确实是最新的）
 *   - 浏览器 demo 模式还复现不了（那里 window.api 是普通赋值，属性可删除）
 * 只有真正跑一次 Electron 渲染进程，才能抓到。
 *
 * 运行：node test/electron-smoke.test.js
 * 依赖：node_modules 里的 electron（未安装则跳过，不算失败）
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

// 定位 electron 可执行文件（优先用项目内安装的）
function findElectron() {
  const pkg = path.join(__dirname, '..', 'node_modules', 'electron');
  const cli = path.join(pkg, 'cli.js');
  // 用官方的 cli.js 启动（它负责解析路径并 spawn 真正的 electron 二进制），
  // 直接 spawn electron.exe 在 Windows 上会缺少参数处理导致进程挂住
  if (fs.existsSync(cli)) return { cmd: process.execPath, args: [cli] };
  const bin = path.join(pkg, 'dist');
  const exe = path.join(bin, 'electron.exe');
  if (fs.existsSync(exe)) return { cmd: exe, args: [] };
  const mac = path.join(bin, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  if (fs.existsSync(mac)) return { cmd: mac, args: [] };
  const linux = path.join(bin, 'electron');
  if (fs.existsSync(linux)) return { cmd: linux, args: [] };
  return null;
}

const electron = findElectron();
if (!electron) {
  console.log('\n[Electron 渲染端冒烟测试]');
  console.log('  ⚠ 未找到 electron，跳过（不影响其它测试）');
  process.exit(0);
}

// 生成一次性探针脚本：加载首页 → 采集状态 → 写文件 → 退出
// 注意：探针必须放在项目目录内（Electron 以脚本所在目录作为 app 路径，
// 放到系统临时目录会以异常码 0x80000003 崩溃），用完即删。
const tmpDir = path.join(__dirname, '.smoke-tmp');
try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (_) {}
const probePath = path.join(tmpDir, 'probe.js');
const outPath = path.join(tmpDir, 'out.txt');

fs.writeFileSync(probePath, `
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const ROOT = ${JSON.stringify(path.join(__dirname, '..'))};

// 无 GPU 的服务器/沙箱环境里 GPU 进程会反复崩溃，导致整个 Electron 进程异常退出，
// 这里关掉 GPU 加速（对渲染逻辑验证无影响，只是不走硬件加速）
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

// 注册与主进程一致的 IPC 处理器：渲染端要真的能拿到配置 / 实例 / 预设列表，
// 否则首页会因为 IPC 被拒而渲染不完整（这部分逻辑同样需要被验证）
const { ipcMain } = require('electron');
const presetsMod = require(path.join(ROOT, 'src', 'core', 'presets.js'));
ipcMain.handle('config:get', () => ({
  theme: 'light', simpleHome: false, activeAccount: 'Player', accounts: [],
  versionIsolation: true, downloadTargetMode: 'auto-version', memory: { auto: true },
}));
ipcMain.handle('config:set', (_e, key, value) => ({ theme: 'light', simpleHome: false, [key]: value }));
ipcMain.handle('instances:list', () => []);
ipcMain.handle('preset:list', () => presetsMod.presetSummary());
// 开机 boot() 还会调这些 IPC；若不注册，ipcRenderer.invoke 在 Electron 31 下会挂起，
// 导致 renderMain 永远跑不到、首页空白（与产品代码无关，纯属本探针不完整）。补齐它们。
ipcMain.handle('app:info', () => ({ dataDir: path.join(ROOT, '.smoke-tmp', 'datadir') }));
ipcMain.handle('custommod:manifest', () => null);
ipcMain.handle('curseforge:status', () => null);
ipcMain.handle('zh:names', () => ({}));
ipcMain.handle('zh:dict', () => ({}));
ipcMain.handle('theme:get', () => 'light');
ipcMain.handle('gameoptions:get', () => ({ enabled: false, preset: '' }));
ipcMain.handle('gameoptions:save', () => ({}));
ipcMain.handle('gameoptions:reset', () => ({}));

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1100, height: 720, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const logs = [];
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    // level 3 = error
    if (level === 3) logs.push('[error] ' + message + ' @ ' + sourceId + ':' + line);
  });
  win.webContents.on('preload-error', (_e, p, err) => logs.push('[preload-error] ' + p + ' :: ' + (err && err.stack || err)));
  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));

  setTimeout(async () => {
    let probe = {};
    try {
      probe = await win.webContents.executeJavaScript(\`(function(){
        var main = document.getElementById('main');
        var btns = document.querySelectorAll('.topbtn');
        return {
          apiType: typeof window.api,
          apiKeys: window.api ? Object.keys(window.api).length : 0,
          mainLen: main ? main.innerHTML.length : -1,
          mainText: main ? main.innerHTML.slice(0, 400) : '',
          bodyClass: document.body.className,
          topButtons: btns.length,
          hasLaunch: !!(main && main.querySelector('#btnLaunch')),
          hasPresetSection: !!(main && main.querySelector('.preset-section')),
          scriptCount: document.querySelectorAll('script').length,
        };
      })()\`);
    } catch (e) {
      probe = { error: String(e && e.stack || e) };
    }
    fs.writeFileSync(${JSON.stringify(outPath)}, JSON.stringify({ logs, probe }, null, 2), 'utf8');
    app.quit();
  }, 9000);
});
`, 'utf8');

// 注意：ELECTRON_RUN_AS_NODE=1 会让 electron 以纯 Node 模式启动（拿不到 app 对象），必须剔除
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

// Electron 是 GUI 子系统程序，不一定干净退出；这里不依赖退出码，
// 而是「启动后轮询结果文件，超时则强杀」，保证测试在任何环境下都能跑完。
const { spawn } = require('child_process');
const child = spawn(electron.cmd, electron.args.concat([probePath]), {
  env,
  stdio: 'ignore',
  windowsHide: true,
  detached: false,
});

const WAIT_MS = 45000;
const started = Date.now();
let done = false;

function killTree() {
  try { child.kill('SIGKILL'); } catch (_) {}
  try {
    if (process.platform === 'win32') {
      require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' });
    }
  } catch (_) {}
}

(async function waitForResult() {
  while (Date.now() - started < WAIT_MS) {
    if (fs.existsSync(outPath)) { done = true; break; }
    await new Promise((r) => setTimeout(r, 300));
  }
  killTree();
  // 给操作系统一点时间回收进程
  await new Promise((r) => setTimeout(r, 500));
  report();
})();

function report() {
  let data = { logs: [], probe: {} };
  if (fs.existsSync(outPath)) {
    try { data = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch (_) {}
  } else {
    data.logs = ['探针未产出结果文件（Electron 未能在 ' + WAIT_MS + 'ms 内完成渲染），' +
      '通常是沙箱/无显示环境导致 Electron 无法创建窗口'];
  }

console.log('\n[Electron 渲染端冒烟测试]');
ok('Electron 渲染进程正常启动并产出结果', fs.existsSync(outPath));
ok('渲染端无 JS 报错（无 SyntaxError / 未捕获异常）',
  (data.logs || []).filter((l) => l.startsWith('[error]') || l.startsWith('[preload-error]')).length === 0);
ok('window.api 已被 preload 注入（contextBridge 生效）', data.probe && data.probe.apiType === 'object');
ok('preload 暴露了完整能力（>20 个方法）', (data.probe.apiKeys || 0) > 20);
ok('首页内容已渲染（#main 非空）', (data.probe.mainLen || 0) > 100);
ok('首页渲染出「启动游戏」板块', !!data.probe.hasLaunch);
ok('首页渲染出新手预设区', !!data.probe.hasPresetSection);
ok('顶栏页面按钮齐全（首页 / 下载 / 高级 / 更多）', data.probe.topButtons >= 4);
ok('Electron 模式标记已生效（body.electron）', String(data.probe.bodyClass || '').indexOf('electron') >= 0);

if ((data.logs || []).length) {
  console.log('\n  渲染端日志：');
  data.logs.forEach((l) => console.log('    ' + l));
}

// 清理临时目录
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

console.log('\n结果：通过 ' + passed + '，失败 ' + failed);
process.exit(failed ? 1 : 0);
}
