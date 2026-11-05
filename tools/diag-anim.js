'use strict';
/* 诊断：检查 #main 的 page-enter 动画是否真的跑完 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1180, height: 760, show: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await sleep(2000);

  const run = (js) => win.webContents.executeJavaScript(js, true);

  await run(`document.querySelector('.topbtn[data-top="advanced"]').click()`);
  await sleep(800);
  await run(`(()=>{const s=[...document.querySelectorAll('.sideitem')].find(x=>x.textContent.includes('模组版本转换')); if(s) s.click();})()`);

  for (const t of [50, 200, 400, 800, 1500, 3000]) {
    await sleep(t === 50 ? 50 : 0);
    const s = await run(`(()=>{const m=document.getElementById('main'); const cs=getComputedStyle(m);
      const anims=(document.getAnimations?document.getAnimations():[]).map(a=>a.animationName+':'+a.playState+':'+Math.round(a.currentTime||0));
      return JSON.stringify({t:${t}, op:cs.opacity, tf:cs.transform, anims});})()`);
    console.log('T' + t + ' ' + s);
    if (t !== 3000) await sleep(t === 50 ? 150 : (t === 200 ? 200 : (t === 400 ? 400 : (t === 800 ? 700 : 1500))));
  }
  app.quit();
});
