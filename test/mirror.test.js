'use strict';
/* 双通道下载模块测试：URL 重写、sha1 校验、通道切换策略（不联网，纯逻辑） */
const assert = require('assert');
const crypto = require('crypto');
const mirror = require('../src/core/mirror');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

console.log('\n[通道定义]');
ok('存在 mojang 官方通道', !!mirror.CHANNELS.mojang);
ok('存在国内公益通道 bmclapi', !!mirror.CHANNELS.bmclapi);
ok('通道列表含两个通道', mirror.CHANNEL_IDS.length === 2);
ok('官方通道名称可读', mirror.channelName('mojang') === 'Mojang 官方');
ok('未知通道回退到官方', mirror.channelName('unknown') === 'Mojang 官方');

console.log('\n[URL 重写]');
ok('官方通道原样返回', mirror.rewriteUrl('https://piston-data.mojang.com/x', 'mojang') === 'https://piston-data.mojang.com/x');
ok('元数据地址重写到公益通道',
  mirror.rewriteUrl('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json', 'bmclapi')
  === 'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json');
ok(' piston-data 重写正确',
  mirror.rewriteUrl('https://piston-data.mojang.com/v1/objects/abc', 'bmclapi')
  === 'https://bmclapi2.bangbang93.com/v1/objects/abc');
ok('libraries 重写到 maven 路径',
  mirror.rewriteUrl('https://libraries.minecraft.net/net/x/y.jar', 'bmclapi')
  === 'https://bmclapi2.bangbang93.com/maven/net/x/y.jar');
ok('resources 重写到 assets 路径',
  mirror.rewriteUrl('https://resources.download.minecraft.net/ab/abcdef', 'bmclapi')
  === 'https://bmclapi2.bangbang93.com/assets/ab/abcdef');
ok('非 Mojang 域名不被误改',
  mirror.rewriteUrl('https://example.com/foo.jar', 'bmclapi') === 'https://example.com/foo.jar');
ok('未知通道视为官方（不改写）',
  mirror.rewriteUrl('https://piston-data.mojang.com/a', 'nope') === 'https://piston-data.mojang.com/a');

console.log('\n[sha1 校验]');
const sample = Buffer.from('hello minecraft launcher');
const goodSha1 = crypto.createHash('sha1').update(sample).digest('hex');
ok('sha1Hex 计算正确', mirror.sha1Hex(sample) === goodSha1);
ok('校验通过（大小写不敏感）', mirror.verifySha1(sample, goodSha1.toUpperCase()) === true);
ok('内容不符时校验失败', mirror.verifySha1(sample, 'deadbeef') === false);
ok('期望值为空时跳过校验', mirror.verifySha1(sample, '') === true);
ok('期望值为 undefined 时跳过校验', mirror.verifySha1(sample, undefined) === true);

let threw = false;
try { mirror.verifyOrThrow(sample, 'deadbeef', '客户端 jar'); } catch (e) {
  threw = true;
  ok('校验失败时抛错且提示文件名', e.message.includes('客户端 jar'));
}
if (!threw) ok('校验失败时抛错且提示文件名', false);
threw = false;
try { mirror.verifyOrThrow(sample, goodSha1, '客户端 jar'); } catch (_) { threw = true; }
ok('校验通过时不抛错', !threw);

console.log('\n[通道互备]');
ok('mojang 的备用是 bmclapi', mirror.otherChannel('mojang') === 'bmclapi');
ok('bmclapi 的备用是 mojang', mirror.otherChannel('bmclapi') === 'mojang');

console.log('\n结果：通过 ' + passed + '，失败 ' + failed);
process.exit(failed ? 1 : 0);
