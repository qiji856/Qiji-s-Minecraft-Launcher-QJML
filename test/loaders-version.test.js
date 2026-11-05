'use strict';
/* 加载器版本列表：全量构建号解析、排序置顶规则、括号标注、最新标记、推荐/精简过滤 */
const assert = require('assert');
const loaders = require('../src/core/loaders');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

// 用假 fetch 拦截网络（无需真实联网）
function mockFetch(map) {
  global.fetch = async (url) => {
    const key = Object.keys(map).find((k) => String(url).includes(k));
    const body = key ? map[key] : '{}';
    return {
      ok: true, status: 200,
      json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };
}

console.log('\n[Forge · 全量构建号解析（maven-metadata.xml）]');
const fakeMeta = `<?xml version="1.0"?>
<metadata>
  <groupId>net.minecraftforge</groupId>
  <artifactId>forge</artifactId>
  <versioning>
    <versions>
      <version>1.20.1-47.0.1</version>
      <version>1.20.1-47.1.0</version>
      <version>1.20.1-47.4.28</version>
      <version>1.20.1-47.4.30</version>
      <version>1.19.2-43.4.0</version>
      <version>1.21.1-52.0.1</version>
    </versions>
  </versioning>
</metadata>`;
mockFetch({ 'maven-metadata.xml': fakeMeta });
(async () => {
  const builds = await loaders.fetchForgeBuilds('1.20.1');
  ok('只保留目标 MC（1.20.1）的构建', builds.length === 4 && !builds.some((b) => b.startsWith('43') || b.startsWith('52')));
  ok('构建号去重且为数字形态', builds.every((b) => /^\d[\d.]*$/.test(b)));

  console.log('\n[Forge · 排序与括号标注（orderForge）]');
  const list = loaders.orderForge('1.20.1', builds, '47.4.28', '47.4.30');
  ok('推荐/适配当前版本置顶', list[0].value === '47.4.28' && list[0].recommended === true);
  ok('第二个是最新版', list[1].value === '47.4.30' && list[1].latest === true);
  ok('其后按构建号降序（新→旧）', list[2].value === '47.1.0' && list[3].value === '47.0.1');
  ok('推荐版带「（推荐·适配当前版本）」括号', list[0].label.includes('（推荐·适配当前版本）'));
  ok('最新版带「（最新版）」括号', list[1].label.includes('（最新版）'));

  console.log('\n[Forge · 推荐==最新时合并标注]');
  const merged = loaders.orderForge('1.20.1', ['47.4.28'], '47.4.28', '47.4.28');
  ok('推荐与最新相同则只有一个条目且标注推荐', merged.length === 1 && merged[0].label.includes('（推荐·适配当前版本）') && !merged[0].label.includes('（最新版）'));

  console.log('\n[Forge · listForge 走全量 + promotions 标记]');
  mockFetch({
    'maven-metadata.xml': fakeMeta,
    'promotions_slim.json': JSON.stringify({ promos: { '1.20.1-recommended': '47.4.28', '1.20.1-latest': '47.4.30' } }),
  });
  const full = await loaders.listForge('1.20.1');
  ok('listForge 返回全部 4 个构建', full.length === 4);
  ok('推荐版仍然置顶', full[0].value === '47.4.28' && full[0].recommended === true);
  ok('最新版标记存在', full.some((v) => v.latest === true));

  console.log('\n[Forge · promotions 回退（元数据不可达）]');
  mockFetch({
    'maven-metadata.xml': '!!! 404 not found',
    'promotions_slim.json': JSON.stringify({ promos: { '1.20.1-recommended': '47.4.28', '1.20.1-latest': '47.4.30' } }),
  });
  const fb = await loaders.listForge('1.20.1');
  ok('元数据失败时回退到 promotions 两条', fb.length === 2);

  console.log('\n[parseForgeList · 向后兼容]');
  const p = loaders.parseForgeList({ promos: { '1.20.1-recommended': '47.4.28', '1.20.1-latest': '47.4.28' } }, '1.20.1');
  ok('标签仍为「（推荐）」', p[0].label === '1.20.1-47.4.28（推荐）' && p[0].recommended === true);

  console.log('\n[Fabric · 排序与最新标记]');
  // 注意：Fabric 官方 /v2/versions/loader 返回的每条是 { loader:{version,stable}, intermediary:{...} }
  // listFabric 现在是多源（BMCLAPI 镜像优先 → 官方兜底）。这里 mock 里没配镜像域名，
  // 镜像会拿到默认的 '{}'（结构不对）→ 代码应自动换源到官方，而不是把 {} 交给 .filter 崩掉。
  mockFetch({
    'meta.fabricmc.net': JSON.stringify([
      { loader: { version: '0.16.10', stable: true } },
      { loader: { version: '0.16.9', stable: true } },
      { loader: { version: '0.17.0', stable: false } },
    ]),
  });
  const fab = await loaders.listFabric();
  ok('镜像返回结构不对时自动换源，列表仍能拿到', Array.isArray(fab) && fab.length === 3);
  ok('稳定版优先于非稳定', fab[0].recommended === true && fab[0].value === '0.16.10');
  ok('同档按版本降序', fab[1].value === '0.16.9');
  ok('非稳定版在最后', fab[2].value === '0.17.0' && fab[2].recommended === false);
  ok('列表最上方标记 latest', fab[0].latest === true);

  console.log('\n[Quilt · 仅稳定 + 最新标记]');
  mockFetch({
    'meta.quiltmc.org': JSON.stringify([
      { version: '0.27.0', stable: true },
      { version: '0.26.0', stable: true },
      { version: '0.25.0', stable: false },
    ]),
  });
  const q = await loaders.listQuilt();
  ok('过滤掉非稳定版', q.length === 2 && q.every((v) => v.recommended));
  ok('按版本降序', q[0].value === '0.27.0' && q[1].value === '0.26.0');
  ok('最新稳定标记 latest', q[0].latest === true);

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
