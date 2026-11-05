'use strict';
/* 开发辅助：用「离屏渲染」截图（普通 capturePage 在本机无显示器时会返回空图）
 * 用法： npx electron tools/shot-offscreen.js <输出名> <页面> [脚本]
 *   页面： home | room | settings ...
 *   脚本：可选，在截图前执行的 JS（用于伪造状态，如让关闭按钮变红）
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('force-device-scale-factor', process.env.QJML_DSF || '1');

const outName = process.argv[2] || 'shot';
const page = process.argv[3] || 'home';
const extraJs = process.argv[4] || '';
const outDir = path.join(__dirname, '..', 'shots');
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: parseInt(process.env.QJML_W || '1180', 10),
    height: parseInt(process.env.QJML_H || '760', 10),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      offscreen: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await sleep(1400);

  const run = (js) => win.webContents.executeJavaScript(js, true);
  // 关掉入场动画（无头环境时间轴不推进）
  await run(`(()=>{const s=document.createElement('style');s.textContent='#main.page-enter{animation:none !important}';document.head.appendChild(s);return 'ok';})()`);
  await sleep(200);

  const clickTop = async (t) => {
    await run(`(()=>{const b=document.querySelector('.topbtn[data-top="${t}"]'); if(b) b.click(); return 'ok';})()`);
    await sleep(800);
  };
  const clickSide = async (label) => {
    await run(`(()=>{const s=[...document.querySelectorAll('.sideitem')].find(x=>x.textContent.includes(${JSON.stringify(label)})); if(s) s.click(); return 'ok';})()`);
    await sleep(800);
  };

  if (page === 'download') await clickTop('download');
  else if (page === 'advanced') await clickTop('advanced');
  else if (page === 'settings') { await clickTop('advanced'); await clickSide('设置'); }
  else if (page === 'room') {
    await run(`(()=>{const t=[...document.querySelectorAll('.tile[data-go]')].find(x=>x.dataset.go==='multiplayer'); if(t) t.click(); return 'ok';})()`);
    await sleep(2500);
  }

  if (extraJs) { await run(extraJs); await sleep(500); }
  await sleep(400);

  const info = await run(`(()=>{const b=document.getElementById('fabClose');if(!b)return 'no-fab';const r=b.getBoundingClientRect();const cs=getComputedStyle(b);
    return JSON.stringify({rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],cls:b.className,bg:cs.backgroundColor,color:cs.color,vis:cs.visibility,disp:cs.display,z:cs.zIndex});})()`);
  console.log('FAB ' + info);

  const img = await win.webContents.capturePage();
  const out = path.join(outDir, outName + '.png');
  fs.writeFileSync(out, img.toPNG());
  console.log('SAVED ' + out + ' (' + fs.statSync(out).size + ' bytes)');
  app.exit(0);
});
