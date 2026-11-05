'use strict';
// 本轮新增功能测试：
//  ① msauth：Mojang 官方客户端 ID + 老端点授权码流（403 兜底通道）
//  ② mirror：下载源偏好（auto / bmclapi / official）
//  ③ loaders：安装器 jar 内 maven URL 改写到 BMCLAPI
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const msauth = require('../src/core/msauth');
const mirror = require('../src/core/mirror');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

console.log('本轮新增功能测试');

// ---------- ① 微软登录：授权码兜底通道 ----------
ok('导出 Mojang 官方客户端 ID', msauth.MOJANG_CLIENT_ID === '00000000402b5328');

const authUrl = msauth.buildLiveAuthUrl();
ok('授权页 URL 用 login.live.com 老端点', authUrl.indexOf('https://login.live.com/oauth20_authorize.srf') === 0);
ok('授权页 URL 带 Mojang 官方 client_id', authUrl.indexOf('00000000402b5328') > 0);
ok('授权页 URL 带 redirect_uri（微软注册的那个）', authUrl.indexOf(encodeURIComponent('https://login.live.com/oauth20_desktop.srf')) > 0);
ok('授权页 URL 带 Xbox Live scope', authUrl.indexOf(encodeURIComponent('service::user.auth.xboxlive.com::MBI_SSL')) > 0);

// 从各种形态里抠 code
ok('从完整 URL 抠出 code', msauth.extractLiveCode('https://login.live.com/oauth20_desktop.srf?code=ABC123DEF456&lc=1033') === 'ABC123DEF456');
ok('从带 # 的 URL 抠出 code', msauth.extractLiveCode('https://login.live.com/oauth20_desktop.srf?code=XYZ789&lc=1033#') === 'XYZ789');
ok('直接给纯 code 也能认', msauth.extractLiveCode('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345') === 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
ok('空输入返回空', msauth.extractLiveCode('') === '');
ok('无关文本返回空', msauth.extractLiveCode('随便一段话') === '');

// ---------- ② 下载源偏好 ----------
ok('偏好：缺省归一到 bmclapi', mirror.normalizePref(undefined) === 'bmclapi');
ok('偏好：空串归一到 bmclapi', mirror.normalizePref('') === 'bmclapi');
ok('偏好：保留 auto', mirror.normalizePref('auto') === 'auto');
ok('偏好：保留 official', mirror.normalizePref('official') === 'official');
ok('偏好：保留 bmclapi', mirror.normalizePref('bmclapi') === 'bmclapi');
ok('偏好：非法值归一到 bmclapi', mirror.normalizePref('乱填') === 'bmclapi');

(async () => {
  // chooseChannel：bmclapi / official 直接按偏好，不测速
  const c1 = await mirror.chooseChannel('bmclapi');
  ok('chooseChannel(bmclapi) → bmclapi', c1 === 'bmclapi');
  const c2 = await mirror.chooseChannel('official');
  ok('chooseChannel(official) → mojang', c2 === 'mojang');
  const c3 = await mirror.chooseChannel(undefined);
  ok('chooseChannel(未设) → bmclapi（默认国内镜像）', c3 === 'bmclapi');
  const c4 = await mirror.chooseChannel('乱填');
  ok('chooseChannel(非法) → bmclapi', c4 === 'bmclapi');

  const m1 = await mirror.chooseModrinthChannel('official');
  ok('chooseModrinthChannel(official) → modrinth', m1 === 'modrinth');
  const m2 = await mirror.chooseModrinthChannel(undefined);
  ok('chooseModrinthChannel(未设) → mcim（默认国内镜像）', m2 === 'mcim');

  // ---------- ③ 安装器 jar 改写 ----------
  const loaders = require('../src/core/loaders');
  ok('loaders 导出 patchInstallerMirrors', typeof loaders.patchInstallerMirrors === 'function');
  if (typeof loaders.patchInstallerMirrors === 'function') {
    const AdmZip = require('adm-zip');
    const jarPath = path.join(require('os').tmpdir(), 'qjml-test-installer.jar');
    const zip = new AdmZip();
    zip.addFile('install_profile.json', Buffer.from(JSON.stringify({
      libraries: [{ downloads: { artifact: { url: 'https://maven.minecraftforge.net/a/b/c.jar' } } }],
      data: { X: { client: 'https://libraries.minecraft.net/x/y.jar' } },
    })));
    zip.addFile('version.json', Buffer.from(JSON.stringify({
      libraries: [{ downloads: { artifact: { url: 'https://maven.minecraftforge.net/d/e/f.jar' } } }],
    })));
    zip.writeZip(jarPath);
    const r = loaders.patchInstallerMirrors(jarPath);
    ok('改写成功', r.patched === true);
    ok('改写了 3 处 URL', r.count === 3);
    const after = new AdmZip(jarPath);
    const p1 = after.readAsText(after.getEntry('install_profile.json'));
    const p2 = after.readAsText(after.getEntry('version.json'));
    ok('install_profile 内已无官方 maven 域名', p1.indexOf('maven.minecraftforge.net') < 0);
    ok('install_profile 内已无 libraries.minecraft.net', p1.indexOf('libraries.minecraft.net') < 0);
    ok('version.json 内已无官方 maven 域名', p2.indexOf('maven.minecraftforge.net') < 0);
    ok('已改写为 BMCLAPI 镜像', p1.indexOf('bmclapi2.bangbang93.com') > 0);
    try { fs.unlinkSync(jarPath); } catch (_) {}
  }

  console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
