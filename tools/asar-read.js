'use strict';
/* 开发辅助：从 app.asar 里读出一个文件（对比打包内容与源码）
 * 用法： node tools/asar-read.js <asar路径> <asar内文件路径> [输出文件]
 * asar 格式：4 字节(总头长度) + 4 字节(字符串长度) + 4 字节(4) + JSON 头 + 文件内容
 */
const fs = require('fs');
const path = require('path');

const asarPath = process.argv[2];
const inner = process.argv[3];
const out = process.argv[4];

const fd = fs.openSync(asarPath, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(4);
const jsonSize = head.readUInt32LE(12);
const jsonBuf = Buffer.alloc(jsonSize);
fs.readSync(fd, jsonBuf, 0, jsonSize, 16);
const header = JSON.parse(jsonBuf.toString('utf8'));
const dataStart = 8 + headerSize;

function find(node, parts) {
  let cur = node;
  for (const p of parts) {
    if (!cur.files || !cur.files[p]) return null;
    cur = cur.files[p];
  }
  return cur;
}

const parts = inner.replace(/\\/g, '/').split('/').filter(Boolean);
const file = find(header, parts);
if (!file) { console.log('NOT FOUND ' + inner); process.exit(1); }
if (file.files) { console.log('IS DIRECTORY'); process.exit(1); }
const buf = Buffer.alloc(Number(file.size));
fs.readSync(fd, buf, 0, Number(file.size), dataStart + Number(file.offset));
fs.closeSync(fd);
if (out) { fs.writeFileSync(path.resolve(out), buf); console.log('SAVED ' + out + ' (' + buf.length + ' bytes)'); }
else { process.stdout.write(buf.toString('utf8')); }
