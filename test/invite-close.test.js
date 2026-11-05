'use strict';
// 联机邀请解析 + 关闭按钮（游戏进程管理）的单元测试
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const invite = require('../src/core/invite');
const manifest = require('../src/core/manifest');
const terracotta = require('../src/core/terracotta');
const gameproc = require('../src/core/gameproc');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + ' —— ' + e.message); fail++; }
}

// ---------- 造一个校验位正确的房间码 ----------
const ALPHA = terracotta.ROOM_ALPHABET;
function makeRoomCode() {
  for (let i = 0; i < 200000; i++) {
    let s = '';
    for (let k = 0; k < 16; k++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    let v = 0n, base = 1n;
    for (const ch of s) { v += BigInt(ALPHA.indexOf(ch)) * base; base *= 34n; }
    if (v % 7n === 0n) {
      return 'U/' + s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16);
    }
  }
  throw new Error('生成房间码失败');
}

const ROOM = makeRoomCode();
const SAMPLE = {
  format: 'qjml-manifest/2',
  mc: '1.20.1',
  loader: 'forge',
  mods: [{ name: 'Create' }, { name: 'MTR' }],
  resourcepacks: [],
  skins: [],
};
const PACKED = manifest.encodeManifest(SAMPLE);

console.log('\n[邀请解析 · 房间码]');
test('生成的房间码本身合法', () => {
  assert.strictEqual(terracotta.parseRoomCode(ROOM).valid, true);
});

console.log('\n[邀请解析 · 带清单的完整邀请]');
test('标准两行（房间码\\n载荷）', () => {
  const r = invite.parseInvite(ROOM + '\n' + PACKED);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.code, ROOM);
  assert.ok(r.manifest, '应解出清单');
  assert.strictEqual(r.manifest.mods.length, 2);
});
test('换行被聊天软件换成空格也能认', () => {
  const r = invite.parseInvite(ROOM + ' ' + PACKED);
  assert.strictEqual(r.ok, true);
  assert.ok(r.manifest);
});
test('前后夹带中文说明文字也能认', () => {
  const r = invite.parseInvite('房间码：' + ROOM + ' 这是清单 ' + PACKED + ' 快来玩');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.code, ROOM);
  assert.ok(r.manifest);
});
test('载荷紧贴中文（前后无空格）也能认', () => {
  const r = invite.parseInvite(ROOM + '\n清单' + PACKED + '结束');
  assert.strictEqual(r.ok, true);
  assert.ok(r.manifest, '说明文字不能污染载荷头部');
});
test('带自定义标记前缀也能认', () => {
  const r = invite.parseInvite('QJML-INVITE:' + ROOM + '\n' + PACKED);
  assert.strictEqual(r.ok, true);
  assert.ok(r.manifest);
});
test('小写房间码也能认（内部会转大写）', () => {
  const r = invite.parseInvite(ROOM.toLowerCase());
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.code, ROOM);
});

console.log('\n[邀请解析 · 只有房间码]');
test('纯房间码 → ok，manifest 为 null', () => {
  const r = invite.parseInvite(ROOM);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.code, ROOM);
  assert.strictEqual(r.manifest, null);
});

console.log('\n[邀请解析 · 错误处理]');
test('空输入 → 明确报错', () => {
  const r = invite.parseInvite('');
  assert.strictEqual(r.ok, false);
  assert.ok(/请输入/.test(r.reason));
});
test('垃圾输入 → 明确报错', () => {
  const r = invite.parseInvite('hello world 你好');
  assert.strictEqual(r.ok, false);
  assert.ok(/房间码/.test(r.reason));
});
test('只有清单没有房间码 → 报错但仍能解出清单', () => {
  const r = invite.parseInvite(PACKED);
  assert.strictEqual(r.ok, false);
  assert.ok(r.manifest, '清单仍应解出来，便于提示用户');
});
test('房间码校验位不对 → 报校验错误（不是"没找到房间码"）', () => {
  // 找一个校验位错的房间码（保持 U/ 前缀不变，只换后面的字符）
  let bad = null;
  const body = 'AAAA-BBBB-CCCC-DDDD';
  for (let i = 0; i < 2000 && !bad; i++) {
    const c = 'U/' + body.replace(/[A-Z]/g, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]);
    if (!terracotta.parseRoomCode(c).valid) bad = c;
  }
  if (!bad) return; // 随机没撞上就跳过
  const r = invite.parseInvite(bad + '\n' + PACKED);
  assert.strictEqual(r.ok, false);
  assert.ok(/校验位/.test(r.reason), '应提示校验位问题，实际：' + r.reason);
});

console.log('\n[关闭按钮 · 未保存世界检测]');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qjml-gp-'));
const gameDir = path.join(tmpRoot, 'game');
const saves = path.join(gameDir, 'saves');
fs.mkdirSync(saves, { recursive: true });

test('没有 saves 目录 → 没有最近打开过的世界', () => {
  const r = gameproc.recentWorlds(path.join(tmpRoot, 'nonexistent'));
  assert.strictEqual(r.length, 0);
});

test('saves 里没有 session.lock → 没有最近打开过的世界', () => {
  fs.mkdirSync(path.join(saves, '世界A'), { recursive: true });
  fs.writeFileSync(path.join(saves, '世界A', 'level.dat'), 'x');
  const r = gameproc.recentWorlds(gameDir);
  assert.strictEqual(r.length, 0);
});

test('有 session.lock → 列出该世界（仅作辅助信号）', () => {
  fs.writeFileSync(path.join(saves, '世界A', 'session.lock'), 'lock');
  const r = gameproc.recentWorlds(gameDir);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].world, '世界A');
  assert.ok(r[0].ageSec >= 0);
});

test('多个世界时按时间倒序', () => {
  fs.mkdirSync(path.join(saves, '世界B'), { recursive: true });
  const lockB = path.join(saves, '世界B', 'session.lock');
  fs.writeFileSync(lockB, 'lock');
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(lockB, future, future);
  const r = gameproc.recentWorlds(gameDir);
  assert.strictEqual(r[0].world, '世界B');
});

test('启动器自己的 .qjml- 目录被忽略', () => {
  fs.mkdirSync(path.join(saves, '世界A.qjml-2026'), { recursive: true });
  fs.writeFileSync(path.join(saves, '世界A.qjml-2026', 'session.lock'), 'lock');
  const r = gameproc.recentWorlds(gameDir);
  assert.ok(!r.some((x) => x.world === '世界A.qjml-2026'), '不应把安全重命名目录当成打开的世界');
});

console.log('\n[关闭按钮 · 风险评估（基于游戏日志）]');
test('游戏没在跑 → safe', () => {
  gameproc.trackExit();
  const r = gameproc.closingRisk();
  assert.strictEqual(r.safe, true);
  assert.strictEqual(r.gameRunning, false);
});

test('游戏在跑但还在主菜单（没进世界）→ safe', () => {
  gameproc.trackSpawn({ pid: 12345, kill() {} }, { instance: 'test', gameDir });
  const r = gameproc.closingRisk();
  assert.strictEqual(r.gameRunning, true);
  assert.strictEqual(r.safe, true, '没进世界就不算有风险');
  gameproc.trackExit();
});

test('游戏进过世界 → 不 safe', () => {
  gameproc.trackSpawn({ pid: 12345, kill() {} }, { instance: 'test', gameDir });
  gameproc.trackLog('[11:01:59] [Server thread/INFO]: Starting integrated minecraft server version 1.20.1');
  const r = gameproc.closingRisk();
  assert.strictEqual(r.safe, false);
  assert.ok(/未保存/.test(r.reason), '应提示未保存风险，实际：' + r.reason);
  gameproc.trackExit();
});

test('从日志里能提取世界名', () => {
  gameproc.trackSpawn({ pid: 12345, kill() {} }, { instance: 'test', gameDir });
  gameproc.trackLog('[Server thread/INFO]: Starting integrated minecraft server version 1.20.1 (saves\\我的城市)');
  const r = gameproc.closingRisk();
  assert.ok(/我的城市/.test(r.reason), '应报出世界名，实际：' + r.reason);
  gameproc.trackExit();
});

test('退出世界（Stopping singleplayer server）→ 恢复 safe', () => {
  gameproc.trackSpawn({ pid: 12345, kill() {} }, { instance: 'test', gameDir });
  gameproc.trackLog('[Server thread/INFO]: Starting integrated minecraft server version 1.20.1');
  assert.strictEqual(gameproc.closingRisk().safe, false);
  gameproc.trackLog('[Server thread/INFO]: Stopping singleplayer server as player logged out');
  const r = gameproc.closingRisk();
  assert.strictEqual(r.safe, true, '退出世界后（MC 已自动保存）应可安全关闭');
  gameproc.trackExit();
});

test('游戏进程退出后 → 恢复 safe（陈年 session.lock 不该误报）', () => {
  // 造一个"游戏早关了但 session.lock 还在"的场景
  gameproc.trackSpawn({ pid: 12345, kill() {} }, { instance: 'test', gameDir });
  gameproc.trackLog('[Server thread/INFO]: Starting integrated minecraft server version 1.20.1');
  gameproc.trackExit();
  const r = gameproc.closingRisk();
  assert.strictEqual(r.safe, true, '游戏已退出就不该因残留 session.lock 报未保存');
});

console.log('\n[关闭按钮 · 进程状态]');
test('status 在没游戏时 running=false', () => {
  gameproc.trackExit();
  const s = gameproc.status();
  assert.strictEqual(s.running, false);
});

test('trackSpawn 后 status 能拿到 pid 与实例', () => {
  gameproc.trackSpawn({ pid: 4242, kill() {} }, { instance: '我的实例', gameDir, mc: '1.20.1' });
  const s = gameproc.status();
  assert.strictEqual(s.running, true);
  assert.strictEqual(s.pid, 4242);
  assert.strictEqual(s.instance, '我的实例');
  assert.strictEqual(s.mc, '1.20.1');
  assert.ok(s.uptimeMs >= 0);
  gameproc.trackExit();
});

test('forceKill 在没有游戏时返回失败而不是崩', async () => {
  gameproc.trackExit();
  const r = await gameproc.forceKill();
  assert.strictEqual(r.ok, false);
  assert.ok(/没有正在运行/.test(r.reason));
});

// 清理
try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}

console.log('\n' + (fail === 0 ? `全部通过 ✅（${pass} 项）` : `有 ${fail} 项失败 ❌（通过 ${pass} 项）`));
if (fail > 0) process.exit(1);
