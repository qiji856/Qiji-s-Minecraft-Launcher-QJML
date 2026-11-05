'use strict';
// 自定义模组清单模块测试：formatSize / 默认清单 / getMod。fetchManifest 为 async，整体 await。
const assert = require('assert');
const custommods = require('../src/core/custommods');

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); passed++; }

async function main() {
  // ---- formatSize ----
  ok('formatSize 512B', custommods.formatSize(512) === '512 B');
  ok('formatSize 1KB', custommods.formatSize(1024) === '1 KB');
  ok('formatSize 1.5KB', custommods.formatSize(1536) === '1.5 KB');
  ok('formatSize 1MB', custommods.formatSize(1048576) === '1 MB');
  ok('formatSize 31.59MB', custommods.formatSize(33128898) === '31.59 MB');
  ok('formatSize 2GB', custommods.formatSize(2 * 1024 * 1048576) === '2 GB');
  ok('formatSize null', custommods.formatSize(null) === '');
  ok('formatSize undefined', custommods.formatSize(undefined) === '');

  // ---- 默认清单（fetchManifest 为空 url 同步回退 default） ----
  const def = await custommods.fetchManifest('');
  ok('默认 source=default', def.source === 'default');
  ok('默认含 aeronautics', !!custommods.getMod(def, 'aeronautics'));
  const aero = custommods.getMod(def, 'aeronautics');
  // 3.0.0：航空学改为「内置组件」（作者的服务器不能提供直链下载），所以没有 fileUrl
  ok('aero 标记为内置组件', aero.bundled === 'aeronautics');
  ok('aero 无直链（走内置）', !aero.fileUrl);
  ok('aero 文件名正确', aero.fileName === 'aeronautics-bundled-1.20.1-v1.jar');
  ok('aero size 正确', aero.size === 33128898);
  ok('aero mc=1.20.1', aero.mc === '1.20.1');
  ok('aero loader=neoforge', aero.loader === 'neoforge');
  ok('aero 带依赖提示', Array.isArray(aero.requires) && aero.requires.length > 0);
  ok('getMod 不存在返回 null', custommods.getMod(def, 'nope') === null);
  ok('默认清单版本号', def.manifest.version === 1);

  console.log('custommod.test.js: ' + passed + ' 条断言全部通过');
}

main().catch((e) => { console.error(e); process.exit(1); });
