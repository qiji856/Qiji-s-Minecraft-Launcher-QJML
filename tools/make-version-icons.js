'use strict';
/* 把用户提供的「版本通道图标」白底截图处理成透明 PNG，放进 src/renderer/assets/versions/。
 *
 * 用法： node tools/make-version-icons.js
 *
 * 源图（用户 2026-11-01 提供，剪贴板截图）：
 *   a_grass.png    → 正式版（草方块）
 *   b_furnace.png  → 旧版（熔炉）
 *   c_snapshot.png → 快照版
 *   d_april.png    → 愚人节版
 *   e_ancient.png  → 远古版
 */
const fs = require('fs');
const path = require('path');
const png = require('./png-icon');

const SRC = process.argv[2] || 'D:/AI/tmp/icontest';
const OUT = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'versions');

const JOBS = [
  { file: 'a_grass.png', out: 'release.png' },
  { file: 'b_furnace.png', out: 'old.png' },
  { file: 'c_snapshot.png', out: 'snapshot.png' },
  { file: 'd_april.png', out: 'april.png' },
  { file: 'e_ancient.png', out: 'ancient.png' },
];

fs.mkdirSync(OUT, { recursive: true });
for (const job of JOBS) {
  const src = path.join(SRC, job.file);
  if (!fs.existsSync(src)) { console.warn('缺少源图：' + src); continue; }
  let img = png.decode(src);
  const before = `${img.width}x${img.height}`;
  img = png.removeWhite(img, { threshold: 236, feather: 20 });
  img = png.trim(img);
  img = png.resize(img, 128);
  const dst = path.join(OUT, job.out);
  fs.writeFileSync(dst, png.encode(img.width, img.height, img.data));
  console.log(`${job.file} (${before}) → ${job.out} ${img.width}x${img.height} ${(fs.statSync(dst).size / 1024).toFixed(1)}KB`);
}
console.log('输出目录：' + OUT);
