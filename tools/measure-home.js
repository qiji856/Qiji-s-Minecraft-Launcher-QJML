'use strict';
/* 开发辅助：测量首页各容器实际宽度，找出右侧留白的根因
 * 用法： npx electron tools/measure-home.js [窗口宽]
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

const W = parseInt(process.argv[2] || '1920', 10);
const H = parseInt(process.argv[3] || '1000', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W, height: H, show: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await sleep(2500);

  const js = `(()=>{
    const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; };
    const tiles = document.querySelector('.tiles');
    const cs = tiles ? getComputedStyle(tiles) : null;
    return {
      win: { innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth },
      content: q('.content'),
      homeHead: q('.home-head'),
      tiles: q('.tiles'),
      tilesCols: cs ? cs.gridTemplateColumns : null,
      tilesMaxW: cs ? cs.maxWidth : null,
      tilesDisplay: cs ? cs.display : null,
      scrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      tileCount: document.querySelectorAll('.tile').length
    };
  })()`;
  const out = await win.webContents.executeJavaScript(js, true);
  console.log(JSON.stringify(out, null, 2));
  win.destroy();
  app.quit();
});
