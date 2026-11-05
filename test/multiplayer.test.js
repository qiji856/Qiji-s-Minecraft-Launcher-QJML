'use strict';
// 联机相关单测：Scaffolding 房间码校验 + 模组清单比对
const tc = require('../src/core/terracotta');
const manifest = require('../src/core/manifest');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

console.log('\n[Scaffolding 房间码]');
{
  // 官方示例：U/YNZE-U61D-2206-HXRG → 网络名 scaffolding-mc-YNZE-U61D，密钥 2206-HXRG
  const r = tc.parseRoomCode('U/YNZE-U61D-2206-HXRG');
  ok('官方示例房间码校验通过', r.valid === true);
  ok('网络名 = scaffolding-mc-YNZE-U61D', r.networkName === 'scaffolding-mc-YNZE-U61D');
  ok('网络密钥 = 2206-HXRG', r.secret === '2206-HXRG');
}
{
  ok('小写也能解析并归一化', tc.parseRoomCode('u/ynze-u61d-2206-hxrg').code === 'U/YNZE-U61D-2206-HXRG');
  ok('缺前缀的码判为无效', tc.parseRoomCode('YNZE-U61D-2206-HXRG').valid === false);
  ok('含字母 I 的码判为无效', tc.parseRoomCode('U/YNZE-U61D-2206-HXRI').valid === false);
  ok('含字母 O 的码判为无效', tc.parseRoomCode('U/YNZE-U61D-2206-HXRO').valid === false);
  ok('空输入判为无效', tc.parseRoomCode('').valid === false);
  ok('长度不对判为无效', tc.parseRoomCode('U/YNZE-U61D-2206').valid === false);
}
{
  // 校验位：随便改一个字符，应导致不被 7 整除 → 无效
  const bad = tc.parseRoomCode('U/YNZE-U61D-2206-HXRA');
  ok('篡改校验位后判为无效', bad.valid === false);
  ok('无效原因有说明', typeof bad.reason === 'string' && bad.reason.length > 0);
}
{
  // 中心发现：hostname → port
  ok('合法中心 hostname 解析出端口', tc.isCenterHostname('scaffolding-mc-server-33768') === 33768);
  ok('端口过小判为非法', tc.isCenterHostname('scaffolding-mc-server-1024') === 0);
  ok('端口过大判为非法', tc.isCenterHostname('scaffolding-mc-server-65536') === 0);
  ok('非数字端口判为非法', tc.isCenterHostname('scaffolding-mc-server-n8') === 0);
  ok('非中心 hostname 判为非法', tc.isCenterHostname('my-pc') === 0);
}

console.log('\n[模组清单比对]');
{
  const local = [
    { name: 'sodium-fabric-0.6.0', sha1: 'aaa', size: 1 },
    { name: 'lithium-fabric-0.10.3', sha1: 'bbb', size: 2 },
    { name: 'different-mod-1.0', sha1: 'ccc', size: 3 },
  ];
  const remote = [
    { name: 'sodium-fabric-0.6.0', sha1: 'aaa', size: 1 },   // 一致
    { name: 'lithium-fabric-0.10.3', sha1: 'ZZZ', size: 2 },   // 版本不一致
    { name: 'jei-1.0.0', sha1: 'ddd', size: 4 },              // 缺失
  ];
  const d = manifest.diffManifest(local, remote);
  ok('一致的算 1 个', d.ok.length === 1 && d.ok[0].name === 'sodium-fabric-0.6.0');
  ok('版本不一致算 1 个', d.mismatched.length === 1 && d.mismatched[0].remote.name === 'lithium-fabric-0.10.3');
  ok('缺失算 1 个', d.missing.length === 1 && d.missing[0].name === 'jei-1.0.0');
  ok('空清单不会报错', manifest.diffManifest(local, []).missing.length === 0);
  ok('远端 undefined 安全', manifest.diffManifest(local, undefined).missing.length === 0);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
