// 联机自动同步的逻辑测试：清单编解码、局域网检测、四件套对齐流程
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

// ---------- 1) manifest 模块 ----------
console.log('\n[清单模块]');
const manifest = require('../src/core/manifest');
const terracotta = require('../src/core/terracotta');

ok('清单格式为 qjml-manifest/2', manifest.FORMAT === 'qjml-manifest/2');

// 建一个临时游戏目录，模拟带模组 + 资源包的实例
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qjml-mf-'));
const instDir = path.join(tmp, 'versions', 'test-inst');
fs.mkdirSync(path.join(instDir, 'mods'), { recursive: true });
fs.mkdirSync(path.join(instDir, 'resourcepacks'), { recursive: true });
fs.writeFileSync(path.join(instDir, 'mods', 'ExampleMod-1.0.0.jar'), 'fake-jar');
fs.writeFileSync(path.join(instDir, 'mods', 'ExampleMod-1.0.0.jar.qjml.json'), JSON.stringify({
  projectId: 'AAAA', versionId: 'BBBB', fileUrl: 'https://cdn.modrinth.com/x.jar',
  fileName: 'ExampleMod-1.0.0.jar', fileGameVersions: ['1.20.1'],
}));
fs.writeFileSync(path.join(instDir, 'resourcepacks', 'CoolPack.zip'), 'fake-zip');

const m = manifest.buildManifest({
  root: tmp, instance: 'test-inst', mc: '1.20.1', loader: 'forge',
  isolation: true, loaderVersion: '47.4.23',
  skins: [{ player: 'Steve' }],
});

ok('清单带上 MC 版本', m.mc === '1.20.1');
ok('清单带上加载器', m.loader === 'forge');
ok('清单带上加载器具体版本', m.loaderVersion === '47.4.23');
ok('清单带 1 个模组', m.mods.length === 1);
ok('模组带 Modrinth 精确坐标', m.mods[0].projectId === 'AAAA' && m.mods[0].versionId === 'BBBB');
ok('清单带 1 个资源包', m.resourcepacks.length === 1);
ok('资源包名字正确', m.resourcepacks[0].name === 'CoolPack');
ok('清单带皮肤', m.skins.length === 1 && m.skins[0].player === 'Steve');

// 编解码往返
const packed = manifest.encodeManifest(m);
ok('清单压缩后是字符串', typeof packed === 'string' && packed.length > 0);
ok('压缩后不含 base64 非法字符（base64url）', /^[A-Za-z0-9_-]+$/.test(packed));
const back = manifest.decodeManifest(packed);
ok('解码后格式正确', back && back.format === 'qjml-manifest/2');
ok('解码后模组数一致', back && back.mods.length === 1);
ok('解码后资源包数一致', back && back.resourcepacks.length === 1);
ok('解码后皮肤一致', back && back.skins[0].player === 'Steve');
ok('解码后 loaderVersion 一致', back && back.loaderVersion === '47.4.23');

// 压缩率：大清单应该被压得很小
const big = { format: manifest.FORMAT, mods: [], resourcepacks: [] };
for (let i = 0; i < 300; i++) {
  big.mods.push({ name: 'Mod-' + i, file: 'Mod-' + i + '.jar', size: 123456, sha1: 'a'.repeat(40), projectId: 'P' + i, versionId: 'V' + i, fileUrl: 'https://cdn/' + i });
}
const bigRaw = JSON.stringify(big).length;
const bigPacked = manifest.encodeManifest(big).length;
ok('大清单压缩率 < 30%', bigPacked < bigRaw * 0.3);
ok('300 个模组的清单压到 30KB 内', bigPacked < 30000);

// 解码失败返回 null 而不是抛异常
ok('垃圾输入解码返回 null', manifest.decodeManifest('!!!not-base64!!!') === null);
ok('空输入解码返回 null', manifest.decodeManifest('') === null);

// diff
const diff = manifest.diffManifest(
  [{ name: 'ExampleMod-1.0.0', sha1: 'x' }],
  [{ name: 'ExampleMod-1.0.0', sha1: 'x' }, { name: 'OtherMod', sha1: 'y' }]
);
ok('diff 认出已存在的模组', diff.ok.length === 1);
ok('diff 认出缺失的模组', diff.missing.length === 1 && diff.missing[0].name === 'OtherMod');

fs.rmSync(tmp, { recursive: true, force: true });

// ---------- 2) 房间码解析 ----------
console.log('\n[房间码解析]');
const valid = terracotta.parseRoomCode('U/FQ20-EGUH-U5DG-7JAM');
ok('实测拿到的真实房间码能解析', valid.valid === true);
ok('解析出网络名', valid.networkName === 'scaffolding-mc-FQ20-EGUH');
ok('解析出密钥', valid.secret === 'U5DG-7JAM');
ok('缺少前缀时无效', terracotta.parseRoomCode('FQ20-EGUH-U5DG-7JAM').valid === false);
ok('含字母 I 时无效', terracotta.parseRoomCode('U/FQI0-EGUH-U5DG-7JAM').valid === false);
// 注意：AAAA/BBBB/1111 这类对称串恰好 %7==0（base-34 的巧合），别拿它们当反例
ok('校验位不对时无效', terracotta.parseRoomCode('U/1234-5678-9ABC-DEF0').valid === false);
ok('对称串恰好合法时可接受（记录真实行为）',
  terracotta.parseRoomCode('U/AAAA-AAAA-AAAA-AAAA').valid === true);
ok('空输入无效', terracotta.parseRoomCode('').valid === false);

// ---------- 3) 局域网开放检测 ----------
console.log('\n[局域网开放检测]');
(async () => {
  const r1 = await terracotta.detectLanOpen(800);
  ok('没开 MC 世界时返回 open=false', r1.open === false);

  // 模拟 Minecraft 开世界：往 224.0.2.60:4445 广播 [MOTD]...[AD]25565[/AD]
  const dgram = require('dgram');
  const sender = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sender.bind(0, '0.0.0.0', () => {
    const payload = Buffer.from('[MOTD]Test World[/MOTD][AD]25565[/AD][PORT]25565[/PORT]', 'utf8');
    try { sender.setMulticastTTL(1); sender.setMulticastLoopback(true); } catch (_) {}
    sender.send(payload, 4445, '224.0.2.60');
  });

  const r2 = await terracotta.detectLanOpen(2000);
  ok('检测到广播时返回 open=true', r2.open === true);
  ok('解析出 MC 端口 25565', r2.port === 25565);
  ok('解析出 MOTD', /Test World/.test(r2.motd || ''));

  try { sender.close(); } catch (_) {}

  console.log('\n结果：通过 ' + pass + '，失败 ' + fail);
  process.exit(fail ? 1 : 0);
})();
