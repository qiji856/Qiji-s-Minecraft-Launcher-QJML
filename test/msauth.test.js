'use strict';
// 微软正版登录链路单测（全部用假 fetch，不联网、不需要真实账号）
const msauth = require('../src/core/msauth');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

// 假的 fetch：按 URL 关键字返回预设响应
function mockFetch(routes) {
  global.fetch = async (url, opts = {}) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
    const r = routes[key];
    const body = typeof r.body === 'function' ? r.body(opts) : r.body;
    const status = r.status || 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}

(async () => {
  console.log('\n[① 设备码授权]');
  {
    mockFetch({
      'devicecode': {
        body: {
          device_code: 'DEV123', user_code: 'ABCD-EFGH',
          verification_uri: 'https://microsoft.com/devicelogin',
          verification_uri_complete: 'https://microsoft.com/devicelogin?code=ABCD-EFGH',
          interval: 5, expires_in: 900,
        },
      },
    });
    const dev = await msauth.requestDeviceCode('CLIENT-ID-123');
    ok('拿到 device_code', dev.deviceCode === 'DEV123');
    ok('拿到用户代码', dev.userCode === 'ABCD-EFGH');
    ok('拿到授权页地址', dev.verificationUri === 'https://microsoft.com/devicelogin');
    ok('拿到免输入的完整链接', /code=ABCD-EFGH/.test(dev.verificationUriComplete));
    ok('轮询间隔取到', dev.interval === 5);
  }
  {
    mockFetch({ 'devicecode': { status: 400, body: { error: 'invalid_client', error_description: 'AADSTS7000218: bad client' } } });
    let msg = '';
    try { await msauth.requestDeviceCode('BAD'); } catch (e) { msg = e.message; }
    ok('clientId 无效时给出可读错误', /AADSTS7000218|bad client/.test(msg));
  }
  {
    // clientId 已内置（用户无需任何配置）：传空应回退到内置 ID，而不是报错。
    // 早期版本这里断言「没配就报错」，但产品已改为完全内置，故更新为断言回退行为。
    mockFetch({
      'devicecode': {
        body: {
          device_code: 'DEV123', user_code: 'ABCD-EFGH',
          verification_uri: 'https://microsoft.com/devicelogin',
          verification_uri_complete: 'https://microsoft.com/devicelogin?code=ABCD-EFGH',
          interval: 5, expires_in: 900,
        },
      },
    });
    let err = null, dev = null;
    try { dev = await msauth.requestDeviceCode(''); } catch (e) { err = e; }
    ok('未传 clientId 时回退到内置 ID', !err && dev && dev.deviceCode === 'DEV123');
  }
  {
    // 复用已有设备码（修复「展示的码与轮询的码不一致」）：不应再请求一次设备码
    const hitUrls = [];
    global.fetch = async (url) => {
      hitUrls.push(String(url));
      if (String(url).includes('devicecode')) {
        return { ok: false, status: 500, json: async () => ({}), text: async () => 'should not be called' };
      }
      // token 端点直接报错，让流程立刻结束（不必等轮询超时）
      return {
        ok: true, status: 200,
        json: async () => ({ error: 'invalid_client', error_description: 'stop' }),
        text: async () => '{"error":"invalid_client"}',
      };
    };
    try {
      await msauth.loginWithDeviceCode('CLIENT-ID-123', {
        device: { deviceCode: 'REUSED', userCode: 'ZZZZ', interval: 1, expiresIn: 900 },
      });
    } catch (_) { /* 预期抛错，忽略 */ }
    ok('复用传入的设备码（未再次请求 devicecode）', !hitUrls.some((u) => u.includes('devicecode')));
    ok('轮询用的是传入的 device_code', hitUrls.some((u) => u.includes('token')));
  }

  console.log('\n[② 轮询换令牌]');
  {
    mockFetch({ 'token': { status: 400, body: { error: 'authorization_pending' } } });
    const r = await msauth.pollDeviceToken('C', 'DEV');
    ok('用户还没授权 → pending', r.done === false && r.pending === true);
  }
  {
    mockFetch({ 'token': { status: 400, body: { error: 'slow_down' } } });
    const r = await msauth.pollDeviceToken('C', 'DEV');
    ok('slow_down 也算 pending', r.done === false && r.pending === true);
  }
  {
    mockFetch({ 'token': { status: 400, body: { error: 'expired_token' } } });
    const r = await msauth.pollDeviceToken('C', 'DEV');
    ok('过期给出「重新发起」', r.done === false && /重新发起/.test(r.error || ''));
  }
  {
    mockFetch({ 'token': { status: 400, body: { error: 'authorization_declined' } } });
    const r = await msauth.pollDeviceToken('C', 'DEV');
    ok('被拒绝时明确告知', r.done === false && /拒绝/.test(r.error || ''));
  }
  {
    mockFetch({ 'token': { body: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 } } });
    const r = await msauth.pollDeviceToken('C', 'DEV');
    ok('授权成功 → 拿到 access_token', r.done === true && r.accessToken === 'AT');
    ok('同时拿到 refresh_token', r.refreshToken === 'RT');
  }

  console.log('\n[③ Xbox Live / XSTS / Minecraft]');
  {
    mockFetch({ 'user.auth.xboxlive.com': { body: { Token: 'XBL', DisplayClaims: { xui: [{ uhs: 'UHS1' }] } } } });
    const xbl = await msauth.xboxLiveAuth('AT');
    ok('拿到 XBL 令牌', xbl.Token === 'XBL');
    ok('拿到用户哈希 uhs', xbl.DisplayClaims.xui[0].uhs === 'UHS1');
  }
  {
    mockFetch({ 'user.auth.xboxlive.com': { status: 401, body: { XErr: 2148916233 } } });
    let msg = '';
    try { await msauth.xboxLiveAuth('BAD'); } catch (e) { msg = e.message; }
    ok('XBL 失败时给出错误', /Xbox Live 认证失败/.test(msg));
  }
  {
    // XErr 2148916233 = 账号没有 Minecraft
    mockFetch({
      'user.auth.xboxlive.com': { body: { Token: 'XBL', DisplayClaims: { xui: [{ uhs: 'UHS1' }] } } },
      'xsts.auth.xboxlive.com': { status: 401, body: { XErr: 2148916233 } },
    });
    let msg = '';
    try { await msauth.xboxSecureAuth(await msauth.xboxLiveAuth('AT')); } catch (e) { msg = e.message; }
    ok('没买 Java 版 → 明确提示', /没有购买 Minecraft/.test(msg));
  }
  {
    mockFetch({
      'user.auth.xboxlive.com': { body: { Token: 'XBL', DisplayClaims: { xui: [{ uhs: 'UHS1' }] } } },
      'xsts.auth.xboxlive.com': { status: 401, body: { XErr: 2148916238 } },
    });
    let msg = '';
    try { await msauth.xboxSecureAuth(await msauth.xboxLiveAuth('AT')); } catch (e) { msg = e.message; }
    ok('儿童账号 → 明确提示', /儿童账号/.test(msg));
  }
  {
    mockFetch({
      'user.auth.xboxlive.com': { body: { Token: 'XBL', DisplayClaims: { xui: [{ uhs: 'UHS1' }] } } },
      'xsts.auth.xboxlive.com': { body: { Token: 'XSTS', DisplayClaims: { xui: [{ uhs: 'UHS1' }] } } },
      'authentication/login_with_xbox': { body: { access_token: 'MCTOKEN' } },
      'minecraftservices.com/minecraft/profile': {
        body: { id: 'uuid-1234', name: 'Steve', skins: [{ url: 'https://textures/skin.png' }], capes: [] },
      },
    });
    const p = await msauth.completeSignIn('AT');
    ok('完整链路拿到角色 UUID', p.id === 'uuid-1234');
    ok('完整链路拿到角色名', p.name === 'Steve');
    ok('完整链路拿到皮肤地址', p.skinUrl === 'https://textures/skin.png');
    ok('完整链路拿到 Minecraft 令牌', p.accessToken === 'MCTOKEN');
  }
  {
    // 防回归：XSTS 的用户标识字段是 DisplayClaims（大写 D）。
    // 旧代码读的是 UserDisplayClaims（小写 u）→ 恒为 undefined → 报
    // 「Cannot read properties of undefined (reading 'xui'/'url')」，登录永远走不完。
    mockFetch({
      'user.auth.xboxlive.com': { body: { Token: 'XBL', DisplayClaims: { xui: [{ uhs: 'UHS1' }] } } },
      'xsts.auth.xboxlive.com': { body: { Token: 'XSTS', UserDisplayClaims: { xui: [{ uhs: 'UHS1' }] } } },
      'authentication/login_with_xbox': { body: { access_token: 'MCTOKEN' } },
      'minecraftservices.com/minecraft/profile': { body: { id: 'x', name: 'Steve', skins: [], capes: [] } },
    });
    let msg = '';
    try { await msauth.completeSignIn('AT'); } catch (e) { msg = e.message; }
    ok('XSTS 字段名错误时给出中文提示而非裸 TypeError', /未能从 Xbox 安全令牌中取得用户标识/.test(msg));
    ok('不再抛 "Cannot read properties of undefined"', !/Cannot read properties/.test(msg));
  }

  console.log('\n[④ 刷新令牌]');
  {
    mockFetch({ 'token': { body: { access_token: 'AT2', refresh_token: 'RT2' } } });
    const r = await msauth.refreshAccessToken('C', 'RT');
    ok('刷新得到新令牌', r.accessToken === 'AT2' && r.refreshToken === 'RT2');
  }
  {
    mockFetch({ 'token': { status: 400, body: { error: 'invalid_grant', error_description: 'expired' } } });
    let msg = '';
    try { await msauth.refreshAccessToken('C', 'RT'); } catch (e) { msg = e.message; }
    ok('刷新失败给出可读错误', /刷新登录状态失败/.test(msg));
  }
  {
    let msg = '';
    try { await msauth.refreshAccessToken('', ''); } catch (e) { msg = e.message; }
    ok('缺参数时直接报错', /clientId|refresh_token/.test(msg));
  }

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  process.exit(failed ? 1 : 0);
})();
