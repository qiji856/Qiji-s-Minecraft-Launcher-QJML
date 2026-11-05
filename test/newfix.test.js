'use strict';
// 本轮新增功能测试：
//   ① 模组启用/禁用（原来只能禁用不能启用）
//   ② 模组转换时前置依赖一起转换
//   ③ 目录布局：游戏数据默认不落在启动器旁边
const path = require('path');
const fs = require('fs');
const os = require('os');
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

const { togglePack, listPacks } = require('../src/core/instances');
const { detectGameDirectory, findPortableGameDir } = require('../src/core/config');
const convert = require('../src/core/convert');
const modscan = require('../src/core/modscan');
const JSZip = require('jszip');
const AdmZip = require('adm-zip');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'newfix-'));

// ================= ① 模组启用/禁用 =================
console.log('\n[1] 模组启用/禁用');
const instDir = path.join(tmp, 'versions', '1.20.1');
const modsDir = path.join(instDir, 'mods');
fs.mkdirSync(modsDir, { recursive: true });
fs.writeFileSync(path.join(modsDir, 'aaa.jar'), 'x');
fs.writeFileSync(path.join(modsDir, 'bbb.jar'), 'x');

ok('禁用：xxx.jar → xxx.jar.disabled',
  togglePack(tmp, '1.20.1', 'mod', true, 'aaa.jar', false) === 'aaa.jar.disabled'
  && fs.existsSync(path.join(modsDir, 'aaa.jar.disabled'))
  && !fs.existsSync(path.join(modsDir, 'aaa.jar')));

// 关键回归：启用时前端传的是「去掉 .disabled 的逻辑名」，原来 from===to 直接跳过
ok('启用：用逻辑名也能启用（回归：原来无效）',
  togglePack(tmp, '1.20.1', 'mod', true, 'aaa.jar', true) === 'aaa.jar'
  && fs.existsSync(path.join(modsDir, 'aaa.jar'))
  && !fs.existsSync(path.join(modsDir, 'aaa.jar.disabled')));

ok('启用：用真实文件名也能启用',
  (function () {
    togglePack(tmp, '1.20.1', 'mod', true, 'aaa.jar', false);
    return togglePack(tmp, '1.20.1', 'mod', true, 'aaa.jar.disabled', true) === 'aaa.jar'
      && fs.existsSync(path.join(modsDir, 'aaa.jar'));
  })());

ok('文件不存在时报错而不是静默失败',
  (function () {
    try { togglePack(tmp, '1.20.1', 'mod', true, 'not-exist.jar', false); return false; }
    catch (_) { return true; }
  })());

ok('已是目标状态时跳过而不是报错',
  (function () {
    fs.writeFileSync(path.join(modsDir, 'ccc.jar'), 'x');
    fs.writeFileSync(path.join(modsDir, 'ccc.jar.disabled'), 'x');
    const r = togglePack(tmp, '1.20.1', 'mod', true, 'ccc.jar', true);
    return r === 'ccc.jar' && fs.existsSync(path.join(modsDir, 'ccc.jar'));
  })());

const packs = listPacks(tmp, '1.20.1', 'mod', true);
ok('列表里启用/禁用状态正确', packs.find((p) => p.name === 'bbb.jar') && packs.find((p) => p.name === 'bbb.jar').disabled === false);

async function main() {
// ================= ② 前置连带转换 =================
console.log('\n[2] 转换时前置依赖一起转换');
const cDir = path.join(tmp, 'versions', '1.20.1');
const cMods = path.join(cDir, 'mods');
fs.mkdirSync(cMods, { recursive: true });

// 前置 B：声明 1.21.1
const bMeta = {
  schemaVersion: 1, id: 'depmod', version: '1.0', name: 'Dep Mod',
  depends: { minecraft: '~1.21.1', java: '>=21' },
};
const bZip = new JSZip();
bZip.file('fabric.mod.json', JSON.stringify(bMeta));
const bBuf = await bZip.generateAsync({ type: 'nodebuffer' });
fs.writeFileSync(path.join(cMods, 'depmod-1.21.1.jar'), bBuf);

// 主模组 A：声明 1.21.1，依赖 B
const aMeta = {
  schemaVersion: 1, id: 'mainmod', version: '1.0', name: 'Main Mod',
  depends: { minecraft: '~1.21.1', depmod: '*' },
};
const aZip = new JSZip();
aZip.file('fabric.mod.json', JSON.stringify(aMeta));
const aBuf = await aZip.generateAsync({ type: 'nodebuffer' });

const r = await convert.convertWithDeps(aBuf, '1.20.1', () => {}, { gameDir: cDir, fileName: 'mainmod.jar' });

ok('主模组已转换', !!r.buffer);
const newA = JSON.parse(await (await JSZip.loadAsync(r.buffer)).file('fabric.mod.json').async('string'));
ok('主模组 minecraft 依赖已改写', newA.depends.minecraft === '>=1.20.1 <1.21');

ok('前置也被识别并转换', r.deps.some((d) => d.id === 'depmod' && d.status === 'converted'));
const newB = JSON.parse(await (await JSZip.loadAsync(fs.readFileSync(path.join(cMods, 'depmod-1.21.1.jar')))).file('fabric.mod.json').async('string'));
ok('前置 minecraft 依赖已改写', newB.depends.minecraft === '>=1.20.1 <1.21');
ok('原文件已备份为 .orig', fs.existsSync(path.join(cMods, 'depmod-1.21.1.jar.orig')));

// 已经是目标版本的前置不该被动
const cMeta2 = { schemaVersion: 1, id: 'depmod2', version: '1.0', name: 'Dep2', depends: { minecraft: '>=1.20.1 <1.21' } };
const cZip = new JSZip();
cZip.file('fabric.mod.json', JSON.stringify(cMeta2));
fs.writeFileSync(path.join(cMods, 'depmod2.jar'), await cZip.generateAsync({ type: 'nodebuffer' }));
const aMeta2 = { schemaVersion: 1, id: 'mainmod2', version: '1.0', name: 'Main2', depends: { minecraft: '~1.21.1', depmod2: '*' } };
const aZip2 = new JSZip();
aZip2.file('fabric.mod.json', JSON.stringify(aMeta2));
const r2 = await convert.convertWithDeps(await aZip2.generateAsync({ type: 'nodebuffer' }), '1.20.1', () => {}, { gameDir: cDir, fileName: 'm2.jar' });
ok('版本本来就对的前置不会被改动', r2.deps.some((d) => d.id === 'depmod2' && d.status === 'ok'));

// ================= ③ 目录布局 =================
console.log('\n[3] 目录布局');
const fakeExeDir = path.join(tmp, 'app');
fs.mkdirSync(path.join(fakeExeDir, '.minecraft', 'versions'), { recursive: true });

const appDataDir = path.join(tmp, 'appdata');
fs.mkdirSync(path.join(appDataDir, '.minecraft', 'versions'), { recursive: true });

// 通过环境变量模拟 %APPDATA%
const oldAppData = process.env.APPDATA;
process.env.APPDATA = appDataDir;
try {
  const gd = detectGameDirectory(fakeExeDir, false);
  ok('默认不把游戏目录放在启动器旁边', gd !== path.join(fakeExeDir, '.minecraft'));
  ok('默认使用 %APPDATA% 下的 .minecraft', gd === path.join(appDataDir, '.minecraft'));

  const gdPortable = detectGameDirectory(fakeExeDir, true);
  ok('便携模式下才用启动器旁边的 .minecraft', gdPortable === path.join(fakeExeDir, '.minecraft'));

  ok('能检测出启动器旁边的旧游戏目录', findPortableGameDir(fakeExeDir) === path.join(fakeExeDir, '.minecraft'));
  ok('没有旧目录时返回 null', findPortableGameDir(path.join(tmp, 'nope')) === null);
} finally {
  if (oldAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = oldAppData;
}

}

main().then(() => {
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
  console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('测试异常:', e); process.exit(1); });
