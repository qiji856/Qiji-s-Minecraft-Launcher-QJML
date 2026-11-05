'use strict';
/* 极简 PNG 编解码（零依赖）：用于处理版本通道图标。
 *
 * 背景：用户给的图标是「白底截图 PNG」（colorType 2，无 alpha），直接塞进界面
 * 在深色主题下就是一块白方块，很难看。这里做三件事：
 *   ① 解码 → ② 裁掉白边 + 去白底（近白像素转透明，带边缘羽化） → ③ 重新编码成 RGBA PNG
 *
 * 只支持 8bit 的 colorType 2(RGB) / 6(RGBA)，够用且不易出错。
 * 编码时每行用 filter 0（None），体积略大但实现简单可靠。
 */
const zlib = require('zlib');
const fs = require('fs');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// 解码 PNG → { width, height, data: RGBA Buffer }
function decode(file) {
  const buf = fs.readFileSync(file);
  if (!buf.slice(0, 8).equals(SIG)) throw new Error('不是 PNG 文件：' + file);
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let palette = null, trns = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('暂不支持非 8bit PNG：' + bitDepth);
  if (interlace) throw new Error('暂不支持隔行扫描 PNG');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('未知 colorType：' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let pos = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = Buffer.from(raw.slice(pos, pos + stride));
    pos += stride;
    // 反滤波
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      switch (filter) {
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          v = (v + pr) & 0xff;
          break;
        }
        default: break;
      }
      line[x] = v;
    }
    // 展开成 RGBA
    for (let x = 0; x < width; x++) {
      const s = x * bpp, d = (y * width + x) * 4;
      if (colorType === 2) { out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2]; out[d + 3] = 255; }
      else if (colorType === 6) { out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2]; out[d + 3] = line[s + 3]; }
      else if (colorType === 0) { out[d] = out[d + 1] = out[d + 2] = line[s]; out[d + 3] = 255; }
      else if (colorType === 4) { out[d] = out[d + 1] = out[d + 2] = line[s]; out[d + 3] = line[s + 1]; }
      else if (colorType === 3) {
        const idx = line[s];
        out[d] = palette[idx * 3]; out[d + 1] = palette[idx * 3 + 1]; out[d + 2] = palette[idx * 3 + 2];
        out[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
    prev = line;
  }
  return { width, height, data: out };
}

// 编码 RGBA → PNG
function encode(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* 去白底：把「接近白色且与周围连通」的像素变透明。
 * 判定：某像素亮度高于阈值（默认 238），且它的上下左右邻居中至少有一个也高于阈值
 *      —— 这样白色背景会整片被抹掉，而图标内部的浅色高光（被深色包围）不会被误伤。
 * 羽化：亮度在 [阈值-18, 阈值] 之间的像素按比例给半透明，边缘不生硬。
 */
function removeWhite(img, { threshold = 238, feather = 18 } = {}) {
  const { width, height, data } = img;
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const hi = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) hi[i] = lum[i] >= threshold ? 1 : 0;
  // 与边缘连通的白色才算背景（避免误删图标内部的白色）
  const bg = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (bg[i] || !hi[i]) return;
    bg[i] = 1; stack.push(i);
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % width, y = (i / width) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  for (let i = 0; i < width * height; i++) {
    if (!bg[i]) continue;
    const l = lum[i];
    if (l >= threshold) data[i * 4 + 3] = 0;
    else data[i * 4 + 3] = Math.round(255 * (1 - (l - (threshold - feather)) / feather));
  }
  return img;
}

// 裁掉四周完全透明的边
function trim(img) {
  const { width, height, data } = img;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 4) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return img;
  const nw = maxX - minX + 1, nh = maxY - minY + 1;
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    data.copy(out, y * nw * 4, ((y + minY) * width + minX) * 4, ((y + minY) * width + minX + nw) * 4);
  }
  return { width: nw, height: nh, data: out };
}

// 缩放到目标尺寸（盒式采样，保持比例，透明底）
function resize(img, size) {
  const { width, height, data } = img;
  const scale = Math.min(size / width, size / height);
  const nw = Math.max(1, Math.round(width * scale));
  const nh = Math.max(1, Math.round(height * scale));
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const sy = Math.min(height - 1, Math.floor(y / scale));
      data.copy(out, (y * nw + x) * 4, (sy * width + sx) * 4, (sy * width + sx) * 4 + 4);
    }
  }
  return { width: nw, height: nh, data: out };
}

module.exports = { decode, encode, removeWhite, trim, resize };
