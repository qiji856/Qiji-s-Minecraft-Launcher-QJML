'use strict';
// 世界管理 / 备份管理 核心逻辑测试
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const w = require('../src/core/worlds');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

function mkfile(p, size) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'x'.repeat(size));
}
function rmtree(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('worlds.js 测试：');

// 1. duDir 递归统计
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qjml-du-'));
  mkfile(path.join(tmp, 'a.txt'), 100);
  mkfile(path.join(tmp, 'sub', 'b.txt'), 250);
  const total = w.duDir(tmp);
  ok('duDir 统计目录大小 (100+250+目录自身)', total >= 350);
  ok('duDir 单文件', w.duDir(path.join(tmp, 'a.txt')) === 100);
  ok('duDir 不存在返回 0', w.duDir(path.join(tmp, 'nope')) === 0);
  rmtree(tmp);
}

// 2. formatSize 人类可读
{
  ok('formatSize 0', w.formatSize(0) === '0 B');
  ok('formatSize B', w.formatSize(512) === '512 B');
  ok('formatSize KB', w.formatSize(2048) === '2 KB');
  ok('formatSize MB 取整', w.formatSize(5 * 1024 * 1024) === '5 MB');
}

// 3. backupNameForDate 中文日期格式（无前导零，与用户约定一致）
{
  const d = new Date(2026, 10, 1, 9, 5); // 2026-11-01
  ok('备份名格式 2026年-11月1号', w.backupNameForDate(d) === '2026年-11月1号');
  const d2 = new Date(2026, 0, 9, 0, 0); // 2026-01-09
  ok('备份名格式 2026年-1月9号', w.backupNameForDate(d2) === '2026年-1月9号');
}

// 4. 端到端：listWorlds / backupWorld / listBackups / restoreBackup
{
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'qjml-wb-'));
  const gameDir = path.join(base, 'gamedir');
  const userData = path.join(base, 'userdata');
  fs.mkdirSync(gameDir, { recursive: true });
  // 两个世界
  mkfile(path.join(gameDir, 'saves', '生存世界', 'level.dat'), 300);
  mkfile(path.join(gameDir, 'saves', '生存世界', 'region', 'r.0.0.mca'), 500);
  mkfile(path.join(gameDir, 'saves', '创造世界', 'level.dat'), 120);

  const wl = w.listWorlds(gameDir);
  ok('listWorlds 列出两个世界', wl.length === 2);
  const surv = wl.find((x) => x.name === '生存世界');
  ok('世界含大小文本', surv && /B|KB|MB/.test(surv.sizeText));
  ok('世界大小 = 300+500+目录', surv && surv.size >= 800);

  // 备份生存世界（第二次同日备份应追加时间，不冲突）
  const b1 = w.backupWorld(userData, gameDir, '生存世界');
  ok('首次备份名 2026年-11月1号 风格', /^\d{4}年-\d+月\d+号/.test(b1.name));
  const b2 = w.backupWorld(userData, gameDir, '生存世界');
  ok('同日二次备份名不同（追加时间）', b1.name !== b2.name);

  // 列出备份（不过滤）
  const all = w.listBackups(userData, '');
  ok('listBackups 含 2 条生存世界备份', all.filter((x) => x.world === '生存世界').length === 2);

  // 列出备份（按世界名过滤）
  const filtered = w.listBackups(userData, '生存世界');
  ok('过滤只返回生存世界', filtered.length === 2 && filtered.every((x) => x.world === '生存世界'));
  const filtered2 = w.listBackups(userData, '创造');
  ok('过滤创造世界为空（未备份）', filtered2.length === 0);

  // 恢复备份：默认应放回「备份来源目录」（而不是当前实例目录），避免存错地方
  const gameDir2 = path.join(base, 'gamedir2');
  fs.mkdirSync(path.join(gameDir2, 'saves', '生存世界'), { recursive: true });
  mkfile(path.join(gameDir2, 'saves', '生存世界', 'level.dat'), 999); // 旧内容
  const r = w.restoreBackup(userData, gameDir2, '生存世界', b1.name);
  ok('restoreBackup 返回成功', r.world === '生存世界' && r.name === b1.name);
  ok('默认恢复到备份来源目录(而不是传入的目录)',
    fs.existsSync(path.join(gameDir, 'saves', '生存世界', 'level.dat'))
    // 传入目录里的旧内容应原封不动（没被这次恢复动过）
    && fs.readFileSync(path.join(gameDir2, 'saves', '生存世界', 'level.dat'), 'utf8').length === 999);
  ok('恢复后 level.dat 为备份内容(300)', fs.readFileSync(path.join(gameDir, 'saves', '生存世界', 'level.dat'), 'utf8').length === 300);
  ok('恢复后 region 文件存在', fs.existsSync(path.join(gameDir, 'saves', '生存世界', 'region', 'r.0.0.mca')));
  // 元数据文件不该被拷进存档目录
  ok('存档目录里没有混入备份元数据文件', !fs.existsSync(path.join(gameDir, 'saves', '生存世界', w.BACKUP_META_FILE)));
  // 备份列表里应带上来源实例
  const listed = w.listBackups(userData, '生存世界');
  ok('备份列表带来源实例', listed.length >= 2 && listed[0].instance === '');

  // 显式指定目标目录：可以故意恢复到别的目录
  const r2 = w.restoreBackup(userData, gameDir2, '生存世界', b1.name, { targetDir: gameDir2 });
  ok('显式指定目标目录时恢复到该目录', r2.gameDir === gameDir2);
  ok('显式目标目录下 level.dat 为备份内容(300)', fs.readFileSync(path.join(gameDir2, 'saves', '生存世界', 'level.dat'), 'utf8').length === 300);
  // 旧内容被安全重命名（.qjml- 前缀目录）
  const remaining = fs.readdirSync(path.join(gameDir2, 'saves'));
  ok('旧世界被安全重命名为 .qjml- 目录', remaining.some((x) => x.startsWith('生存世界.qjml-')));

  rmtree(base);
}

// 5. 恢复不存在的备份应抛错
{
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'qjml-wb2-'));
  let threw = false;
  try { w.restoreBackup(base, base, '不存在', '也不存在'); } catch (_) { threw = true; }
  ok('恢复不存在的备份抛错', threw);
  rmtree(base);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
