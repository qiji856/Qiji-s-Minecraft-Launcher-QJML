'use strict';
/* 开发辅助：多种窗口宽度下截图首页，验证「铺满全屏、无右侧留白」
 * 用法： npx electron tools/shot-responsive.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

const outDir = path.join(__dirname, '..', 'shots');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [[1920, 1080], [1440, 900], [1280, 800]];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1920, height: 1080, show: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await sleep(2200);
  await win.webContents.executeJavaScript(`(()=>{const s=document.createElement('style');s.textContent='#main.page-enter{animation:none !important}';document.head.appendChild(s);return 'ok';})()`);
  await sleep(400);

  for (const [w, h] of SIZES) {
    win.setSize(w, h);
    await sleep(900);
    const info = await win.webContents.executeJavaScript(`(()=>{
      const c = document.querySelector('.content');
      const t = document.querySelector('.tiles');
      const cr = c.getBoundingClientRect(), tr = t.getBoundingClientRect();
      const cs = getComputedStyle(c);
      const inner = cs.paddingLeft.replace('px','') + cs.paddingRight.replace('px','');
      return { win: window.innerWidth, contentW: Math.round(cr.width), tilesW: Math.round(tr.width),
               tilesRight: Math.round(tr.right), contentRight: Math.round(cr.right),
               gap: Math.round(cr.right - tr.right), cols: getComputedStyle(t).gridTemplateColumns };
    })()`, true);
    console.log(`窗口 ${w}x${h} → ` + JSON.stringify(info));
    const png = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `resp-${w}.png`), png.toPNG());
  }
  win.destroy();
  app.quit();
});
