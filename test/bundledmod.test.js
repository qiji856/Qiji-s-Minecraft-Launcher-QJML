'use strict';
// 内置模组（随软件分发的二进制）测试：路径解析 / 校验 / 释放到实例 mods 目录。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bundled = require('../src/core/bundledMods');
const custommods = require('../src/core/custommods');

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); passed++; }

function rmtree(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }
function mkfile(p, n) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.alloc(n, 1)); }

async function main() {
  // ---- 登记表 ----
  const m = bundled.BUNDLED_MODS.aeronautics;
  ok('登记了 aeronautics', !!m);
  ok('标注 mc=1.20.1', m.mc === '1.20.1');
  ok('标注 loader=neoforge', m.loader === 'neoforge');
  ok('记录了体积', m.size === 33128898);
  ok('记录了 sha256', /^[0-9a-f]{64}$/.test(m.sha256));

  // ---- 路径解析 ----
  const p = bundled.bundledFilePath('aeronautics');
  ok('路径指向 bin/mods 下的 jar', /bin[\\/]mods[\\/]aeronautics-bundled-1\.20\.1-v1\.jar$/.test(p));
  ok('内置文件真实存在（已随包分发）', fs.existsSync(p));
  ok('未知 id 返回空串', bundled.bundledFilePath('不存在') === '');

  // ---- 清单条目指向内置组件 ----
  const res = await custommods.fetchManifest('');
  const cm = custommods.getMod(res, 'aeronautics');
  ok('清单条目标记为内置组件', cm.bundled === 'aeronautics');
  ok('清单条目没有直链（服务器不可用）', !cm.fileUrl);
  ok('清单条目带 loader=neoforge', cm.loader === 'neoforge');
  ok('清单条目补上了依赖提示', Array.isArray(cm.requires) && cm.requires.length > 0);
  ok('清单条目体积正确', cm.size === 33128898);

  // ---- 释放到实例 mods 目录 ----
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'qjml-bm-'));
  const root = path.join(base, 'mc');
  const inst = 'test-1.20.1';
  const events = [];
  const r = await bundled.installBundled({
    root, instance: inst, isolation: true, id: 'aeronautics',
    onProgress: (stage, info) => events.push({ stage, info }),
  });
  const dest = path.join(root, 'versions', inst, 'mods', 'aeronautics-bundled-1.20.1-v1.jar');
  ok('jar 已写入实例 mods 目录', fs.existsSync(dest));
  ok('写入的字节数一致', fs.statSync(dest).size === 33128898);
  ok('返回的 sha256 与登记一致', r.sha256 === m.sha256);
  ok('有进度事件', events.length >= 2 && events.some((e) => e.stage === 'progress'));
  ok('进度事件带百分比', events.some((e) => e.stage === 'progress' && e.info.percent >= 100));
  ok('isInstalled 能识别', bundled.isInstalled(root, inst, true, 'aeronautics') === true);
  ok('isInstalled 对其他实例返回 false', bundled.isInstalled(root, '别的实例', true, 'aeronautics') === false);

  // ---- 关闭隔离时落在根 mods 目录 ----
  const r2 = await bundled.installBundled({ root, instance: inst, isolation: false, id: 'aeronautics' });
  ok('关闭隔离时写入根 mods 目录', fs.existsSync(path.join(root, 'mods', 'aeronautics-bundled-1.20.1-v1.jar')));
  ok('返回目标路径', !!r2.dest);

  // ---- 未知 id 报错 ----
  let threw = false;
  try { await bundled.installBundled({ root, instance: inst, isolation: true, id: '不存在' }); } catch (_) { threw = true; }
  ok('未知内置模组抛错', threw);

  rmtree(base);
  console.log('bundledmod.test.js: ' + passed + ' 条断言全部通过');
}

main().catch((e) => { console.error(e); process.exit(1); });
