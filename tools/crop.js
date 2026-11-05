'use strict';
/* 开发辅助：把截图裁剪并放大，便于细看排版问题
 * 用法： npx electron tools/crop.js <图片> <输出前缀> [x y w h 放大倍数]
 */
const { app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');

const src = process.argv[2];
const prefix = process.argv[3] || 'crop';
const x = parseInt(process.argv[4] || '0', 10);
const y = parseInt(process.argv[5] || '0', 10);
const w = parseInt(process.argv[6] || '400', 10);
const h = parseInt(process.argv[7] || '300', 10);
const scale = parseFloat(process.argv[8] || '2');

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(path.resolve(src));
  const size = img.getSize();
  console.log('size ' + size.width + 'x' + size.height);
  const cropped = img.crop({ x, y, width: w, height: h }).resize({
    width: Math.round(w * scale), height: Math.round(h * scale), quality: 'best',
  });
  const out = path.join(__dirname, '..', 'shots', prefix + '.png');
  fs.writeFileSync(out, cropped.toPNG());
  console.log('SAVED ' + out);
  app.quit();
});
