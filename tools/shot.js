'use strict';
/* 开发辅助：用 Electron 打开渲染层并截图，便于自查 UI
 * 用法： npx electron tools/shot.js <输出名> [初始动作]
 * 动作： home | download | advanced | search | online-convert
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// 沙箱无 GPU，强制软件渲染，否则启动即崩
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const outName = process.argv[2] || 'shot';
const action = process.argv[3] || 'home';
const outDir = path.join(__dirname, '..', 'shots');
fs.mkdirSync(outDir, { recursive: true });

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1100, height: 720, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await new Promise((r) => setTimeout(r, 900));

  const run = (js) => win.webContents.executeJavaScript(js, true);

  if (action === 'download') {
    await run(`document.querySelector('.topbtn[data-top="download"]').click()`);
    await new Promise((r) => setTimeout(r, 400));
  } else if (action === 'search') {
    await run(`document.querySelector('.topbtn[data-top="download"]').click()`);
    await new Promise((r) => setTimeout(r, 300));
    await run(`document.querySelector('#q').value='sodium'; document.querySelector('#searchBtn').click();`);
    await new Promise((r) => setTimeout(r, 2500));
  } else if (action === 'advanced') {
    await run(`document.querySelector('.topbtn[data-top="advanced"]').click()`);
    await new Promise((r) => setTimeout(r, 400));
  } else if (action === 'online-convert') {
    await run(`document.querySelector('.topbtn[data-top="advanced"]').click()`);
    await new Promise((r) => setTimeout(r, 300));
    await run(`(function(){const s=[...document.querySelectorAll('.sideitem')].find(x=>x.textContent.includes('模组版本转换')); if(s) s.click();})()`);
    await new Promise((r) => setTimeout(r, 400));
  }

  const img = await win.webContents.capturePage();
  const out = path.join(outDir, outName + '.png');
  fs.writeFileSync(out, img.toPNG());
  console.log('SAVED ' + out);
  app.quit();
});
