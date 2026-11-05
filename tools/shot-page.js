'use strict';
/* 开发辅助：打开指定页面并截图，便于自查排版
 * 用法： npx electron tools/shot-page.js <输出名> <页面>
 * 页面： home | download | advanced | convert | convert-online | instances | settings | mod-manage
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
const outDir = path.join(__dirname, '..', 'shots');
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: parseInt(process.env.QJML_W||'1180',10), height: parseInt(process.env.QJML_H||'760',10), show: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await sleep(1200);
  // 本机是无头/被遮挡环境，CSS 动画的时间轴不推进 → 强制关掉入场动画，否则截图永远是 opacity:0
  await win.webContents.executeJavaScript(`(()=>{window.__QJML_FROZEN=${'true'};const s=document.createElement('style');s.textContent=(window.__QJML_FROZEN?'#main.page-enter{animation:pageEnter .26s cubic-bezier(.22,.61,.36,1) -0.13s paused !important}':'#main.page-enter{animation:none !important}');document.head.appendChild(s);return 'ok';})()`);
  await sleep(300);

  const run = (js) => win.webContents.executeJavaScript(js, true);
  const clickTop = async (t) => {
    const okc = await run(`(()=>{const b=document.querySelector('.topbtn[data-top="${t}"]'); if(!b) return 'no-btn'; b.click(); return 'ok';})()`);
    console.log('top ' + t + ' -> ' + okc);
    await sleep(700);
  };
  const clickSide = async (label) => {
    const r = await run(`(()=>{const s=[...document.querySelectorAll('.sideitem')].find(x=>x.textContent.includes(${JSON.stringify(label)})); if(!s) return 'no-item'; s.click(); return 'ok';})()`);
    console.log('side ' + label + ' -> ' + r);
    await sleep(700);
  };

  if (page === 'home') { /* 首页默认 */ }
  else if (page === 'download') await clickTop('download');
  else if (page === 'advanced') await clickTop('advanced');
  else if (page === 'convert') { await clickTop('advanced'); await clickSide('模组版本转换'); }
  else if (page === 'convert-online') { await clickTop('advanced'); await clickSide('模组版本转换'); await run(`(()=>{const b=[...document.querySelectorAll('#convModeSeg .seg-btn')].find(x=>x.textContent.includes('在线')); if(b) b.click(); return 'ok';})()`); await sleep(700); }
  else if (page === 'instances') { await clickTop('advanced'); await clickSide('实例管理'); }
  else if (page === 'settings') { await clickTop('advanced'); await clickSide('设置'); }
  else if (page === 'mod-manage') { await clickTop('advanced'); await clickSide('模组管理'); }
  else if (page === 'room') { await run(`(()=>{const t=[...document.querySelectorAll('.tile[data-go]')].find(x=>x.dataset.go==='multiplayer'); if(t) t.click(); return 'ok';})()`); await sleep(2500); }
  else if (page === 'room-lan') {
    // 模拟「MC 已对局域网开放」：直接调 terracotta:lanStatus 注入 open=true
    await run(`(()=>{const t=[...document.querySelectorAll('.tile[data-go]')].find(x=>x.dataset.go==='multiplayer'); if(t) t.click(); return 'ok';})()`);
    await sleep(1200);
    await run(`(()=>{const b=document.getElementById('tcLanTip'); if(b){b.style.display='block'; b.innerHTML='⚠️ <b>还没有检测到 Minecraft 正在「对局域网开放」</b><br><span style="font-size:12px">房间码<b>生成不出来</b>就是这个原因：陶瓦联机要靠 Minecraft 开世界时发的局域网广播来找到你的游戏端口。<br>请先：启动 Minecraft → 进入单人存档 → 按 <b>ESC</b> → 点「<b>对局域网开放</b>」 → 保持游戏开着，再回来创建房间。</span>';} return 'ok';})()`);
    await sleep(400);
  }
  else if (page === 'skin') { await clickTop('home'); await run(`(()=>{const t=[...document.querySelectorAll('.tile[data-go]')].find(x=>x.dataset.go==='skin'); if(t) t.click(); return 'ok';})()`); }

  const info = await run(`(()=>{const m=document.getElementById('main'); if(!m) return 'no-main';
    const cs=getComputedStyle(m); const r=m.getBoundingClientRect();
    const kids=[...m.children].slice(0,6).map(c=>{const cr=c.getBoundingClientRect(); return c.tagName+'.'+(c.className||'')+' ['+Math.round(cr.x)+','+Math.round(cr.y)+' '+Math.round(cr.width)+'x'+Math.round(cr.height)+']';});
    return JSON.stringify({len:m.innerHTML.length, rect:[r.x,r.y,r.width,r.height], opacity:cs.opacity, transform:cs.transform, display:cs.display, anim:cs.animationName, kids, html:m.innerHTML.slice(0,200)});})()`);
  console.log('STATE ' + info);
  if (process.env.DUMP_HTML) {
    const html = await run(`document.getElementById('main').innerHTML`);
    fs.writeFileSync(path.join(outDir, outName + '.html'), String(html || ''));
    console.log('HTML ' + path.join(outDir, outName + '.html'));
  }

  const img = await win.webContents.capturePage();
  const out = path.join(outDir, outName + '.png');
  fs.writeFileSync(out, img.toPNG());
  console.log('SAVED ' + out);
  app.quit();
});
