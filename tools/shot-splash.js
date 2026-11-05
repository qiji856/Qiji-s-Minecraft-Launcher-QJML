'use strict';
/* 开发辅助：单独预览启动动画（碎片拼图），用于检查视觉效果 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const out = path.join(__dirname, '..', 'shots', 'splash.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 560, height: 340, show: true, frame: false, backgroundColor: '#0e1014' });
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'splash.html'), { search: 'static=1' });
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await sleep(2500);
  // 直接从 canvas 取图（capturePage 在无显示器 / 被遮挡环境会返回空图）
  const dataUrl = await win.webContents.executeJavaScript(`document.getElementById('cv').toDataURL('image/png')`);
  const b64 = String(dataUrl || '').split(',')[1] || '';
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('SAVED ' + out + ' (' + b64.length + ' b64)');
  app.quit();
});
