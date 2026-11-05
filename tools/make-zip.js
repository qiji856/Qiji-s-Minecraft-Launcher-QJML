'use strict';
/* 把 dist/win-unpacked 打成 zip —— 「免解压绿色版」。
 * 为什么要这个：electron-builder 的单文件绿色版(NSIS portable)启动时会把整个程序
 * 解压到 %TEMP%（约 300MB）。C 盘空间紧张时就会解压一半 → 报「找不到 ffmpeg.dll」。
 * 直接给 zip 让用户解压一次，就完全绕开临时目录，启动也更快。
 *
 * 用法： node tools/make-zip.js [版本号]
 */
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'dist', 'win-unpacked');
const version = process.argv[2] || require('../src/core/version').APP_VERSION;
const outFile = path.join(root, 'dist', `QJML-Green-${version}.zip`);

function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else out.push({ full, rel: path.relative(base, full).split(path.sep).join('/') });
  }
  return out;
}

(async () => {
  if (!fs.existsSync(srcDir)) { console.error('没有 dist/win-unpacked，先跑 npm run dist'); process.exit(1); }
  const files = walk(srcDir, srcDir, []);
  console.log('待打包文件数：' + files.length);
  const zip = new JSZip();
  let total = 0;
  for (const f of files) {
    const buf = fs.readFileSync(f.full);
    total += buf.length;
    zip.file(f.rel, buf, { binary: true });
  }
  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'DOS',
  });
  fs.writeFileSync(outFile, out);
  console.log(`已生成 ${outFile}（${(out.length / 1048576).toFixed(1)} MB，原始 ${(total / 1048576).toFixed(1)} MB）`);
})().catch((e) => { console.error('失败：' + e.message); process.exit(1); });
