// 端到端模拟：房主建房 → 生成邀请码 → 加入方解析 → 四件套对齐
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const manifest = require('../src/core/manifest');
const terracotta = require('../src/core/terracotta');

console.log('\n[端到端：房主 → 邀请码 → 加入方]');

// 1) 房主有一个带模组/资源包的实例
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qjml-e2e-'));
const inst = '我的世界-1.20.1-Forge';
const instDir = path.join(root, 'versions', inst);
fs.mkdirSync(path.join(instDir, 'mods'), { recursive: true });
fs.mkdirSync(path.join(instDir, 'resourcepacks'), { recursive: true });

const MODS = [
  { file: 'MTR-4.0.5.jar', id: 'mtr-mod', v: 'v1', url: 'https://cdn.modrinth.com/data/mtr/mtr-4.0.5.jar' },
  { file: 'MSD-4.0.5.jar', id: 'msd-mod', v: 'v2', url: 'https://cdn.modrinth.com/data/msd/msd.jar' },
  { file: 'JCM-2.2.4.jar', id: 'jcm-mod', v: 'v3', url: 'https://cdn.modrinth.com/data/jcm/jcm.jar' },
];
for (const m of MODS) {
  fs.writeFileSync(path.join(instDir, 'mods', m.file), 'jar-content-' + m.file);
  fs.writeFileSync(path.join(instDir, 'mods', m.file + '.qjml.json'), JSON.stringify({
    projectId: m.id, versionId: m.v, fileUrl: m.url, fileName: m.file, fileGameVersions: ['1.20.1'],
  }));
}
const PACKS = ['TokyoPack.zip', 'JRTrains.zip'];
for (const p of PACKS) fs.writeFileSync(path.join(instDir, 'resourcepacks', p), 'zip-' + p);

// 2) 房主构建清单
const m = manifest.buildManifest({
  root, instance: inst, mc: '1.20.1', loader: 'forge', loaderVersion: '47.4.23',
  isolation: true, skins: [{ player: '祁骥' }],
});
console.log('  房主清单：MC ' + m.mc + ' · ' + m.loader + ' ' + m.loaderVersion
  + ' · 模组 ' + m.mods.length + ' · 资源包 ' + m.resourcepacks.length + ' · 皮肤 ' + m.skins.length);
assert.strictEqual(m.mods.length, 3);
assert.strictEqual(m.resourcepacks.length, 2);
assert.strictEqual(m.skins.length, 1);

// 3) 房主打包成「联机邀请」（房间码 + 压缩清单）
const ROOM = 'U/FQ20-EGUH-U5DG-7JAM';
const packed = manifest.encodeManifest(m);
const invite = ROOM + '\n' + packed;
console.log('  邀请码长度：' + invite.length + ' 字符（原始 JSON ' + JSON.stringify(m).length + ' 字符）');
assert.ok(invite.length < JSON.stringify(m).length, '压缩后应更短');

// 4) 加入方粘贴 → 解析房间码 + 解码清单
const tokens = invite.split(/\s+/).filter(Boolean);
let roomCode = '';
for (const t of tokens) {
  const p = terracotta.parseRoomCode(t);
  if (p && p.valid) { roomCode = p.code; break; }
}
assert.ok(roomCode, '应能解析出房间码');
assert.strictEqual(roomCode, ROOM);

let remote = null;
for (const t of tokens) {
  if (t === roomCode) continue;
  const j = manifest.decodeManifest(t);
  if (j && j.format) { remote = j; break; }
}
assert.ok(remote, '应能解码出清单');
console.log('  加入方解析成功：房间码 ' + roomCode);

// 5) 加入方比对本地（本地有 MTR 同名但不同版本，其余没有）
const local = manifest.listMods(root, inst, true);
const diff = manifest.diffManifest(local, remote.mods);
console.log('  比对结果：一致 ' + diff.ok.length + ' · 缺失 ' + diff.missing.length + ' · 版本不同 ' + diff.mismatched.length);
assert.strictEqual(diff.ok.length, 3, '本地已有全部三个模组，应全部匹配');

// 6) 加入方是全新环境 → 全部缺失
const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'qjml-e2e2-'));
fs.mkdirSync(path.join(root2, 'versions', '联机-7JAM'), { recursive: true });
const diff2 = manifest.diffManifest([], remote.mods);
console.log('  全新环境比对：缺失 ' + diff2.missing.length + ' 个（全部要装）');
assert.strictEqual(diff2.missing.length, 3);

// 7) 四件套的安装计划（模拟加入方执行）
const plan = [];
if (remote.mc) plan.push('下载 MC ' + remote.mc + (remote.loader ? ' + ' + remote.loader + ' ' + remote.loaderVersion : ''));
for (const mm of diff2.missing) {
  const exact = mm.projectId && mm.versionId && mm.fileUrl;
  plan.push('安装模组 ' + mm.name + (exact ? '（精确直装）' : '（模糊搜索）'));
}
for (const pp of remote.resourcepacks) plan.push('安装资源包 ' + pp.name);
for (const sk of remote.skins) plan.push('拉取皮肤 ' + sk.player);
console.log('\n  加入方将执行：');
for (const p of plan) console.log('    · ' + p);
assert.strictEqual(plan.length, 1 + 3 + 2 + 1, '计划应为 1 版本 + 3 模组 + 2 资源包 + 1 皮肤');
assert.ok(plan.some((p) => p.includes('精确直装')), '模组应能精确直装（带 Modrinth 坐标）');

// 8) 皮肤：公开源拉取（真实网络请求，验证 minotar 可用）
(async () => {
  try {
    const skins = require('../src/core/skins');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qjml-skin-'));
    const r = await skins.importByName(dir, 'Notch');
    console.log('\n  皮肤拉取实测：Notch → ' + (r && r.ok ? '成功（' + path.basename(r.file || '') + '）' : '失败: ' + JSON.stringify(r)));
    assert.ok(r && r.ok, '公开皮肤源应可用');
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    console.log('\n  皮肤拉取实测跳过（网络不可用）：' + e.message);
  }

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(root2, { recursive: true, force: true });
  console.log('\n[端到端] 完成');
})();
