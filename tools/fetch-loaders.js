'use strict';
/* 构建前自动抓取「常用加载器安装器」到 src/core/bin/loaders/，
 * 让用户装 Forge / NeoForge 时不用等 maven 下载（国内 maven 常超时）。
 *
 * 为什么要做：
 *   装加载器的第一步是下载 installer.jar（8~10MB）。国内访问
 *   maven.minecraftforge.net 经常几十秒甚至超时失败 —— PCL 等主流启动器都做了缓存/内置。
 *   把常用几个版本的 installer 随包分发，常用版本就是「秒装」。
 *
 * 只内置**常用**版本（下面 TARGETS 里那几个），不是全量历史版本 ——
 *   全量有几千个、几十 GB，既不现实也没必要。
 *
 * 若网络失败：仅打印警告，**不阻断构建**；运行时仍会走联网下载（同以前）。
 *
 * 用法： node tools/fetch-loaders.js [--force]
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'src', 'core', 'bin', 'loaders');

const BMCLAPI = 'https://bmclapi2.bangbang93.com/maven';
const FORGE_MAVEN = 'https://maven.minecraftforge.net';
const NEOFORGE_MAVEN = 'https://maven.neoforged.net';

// 要内置的加载器版本（用户实际会用到的那些）
const TARGETS = [
  { mc: '1.20.1', loader: 'forge', version: '47.4.28' },
  { mc: '1.20.1', loader: 'neoforge', version: '47.1.106' },
  { mc: '1.21.1', loader: 'forge', version: '52.0.40' },
  { mc: '1.21.1', loader: 'neoforge', version: '21.1.209' },
];

// 每个目标的可选下载源（按顺序尝试）
function sourcesFor(t) {
  if (t.loader === 'forge') {
    const rel = `/net/minecraftforge/forge/${t.mc}-${t.version}/forge-${t.mc}-${t.version}-installer.jar`;
    return [
      BMCLAPI + rel,          // 国内镜像（实测最稳）
      FORGE_MAVEN + rel,      // 官方
    ];
  }
  if (t.loader === 'neoforge') {
    // 1.20.1 用旧坐标 net.neoforged:forge；1.20.2+ 用 net.neoforged:neoforge
    const legacy = t.mc === '1.20.1';
    const rels = legacy
      ? [
        `/releases/net/neoforged/forge/${t.mc}-${t.version}/forge-${t.mc}-${t.version}-installer.jar`,
        `/net/neoforged/forge/${t.mc}-${t.version}/forge-${t.mc}-${t.version}-installer.jar`,
      ]
      : [
        `/releases/net/neoforged/neoforge/${t.version}/neoforge-${t.version}-installer.jar`,
        `/net/neoforged/neoforge/${t.version}/neoforge-${t.version}-installer.jar`,
      ];
    const out = [];
    for (const r of rels) out.push(BMCLAPI + r);
    for (const r of rels) out.push(NEOFORGE_MAVEN + r);
    return out;
  }
  return [];
}

async function download(url, dest) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error('文件过小（' + buf.length + ' 字节），可能不是安装器');
    // 校验：是 zip（jar）而不是错误页
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('不是有效的 jar 文件');
    fs.writeFileSync(dest, buf);
    return buf.length;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const force = process.argv.includes('--force');
  let ok = 0, fail = 0;
  for (const t of TARGETS) {
    const name = `${t.mc}-${t.loader}-${t.version}.jar`;
    const dest = path.join(OUT_DIR, name);
    if (fs.existsSync(dest) && !force) {
      const sz = fs.statSync(dest).size;
      if (sz > 1000) { console.log(`[fetch-loaders] 已存在 ${name} (${(sz / 1048576).toFixed(1)}MB)`); ok++; continue; }
    }
    let done = false;
    for (const u of sourcesFor(t)) {
      try {
        const sz = await download(u, dest);
        console.log(`[fetch-loaders] ✓ ${name} (${(sz / 1048576).toFixed(1)}MB) ← ${u.replace(/^https?:\/\//, '')}`);
        ok++; done = true; break;
      } catch (e) {
        console.warn(`[fetch-loaders] 源失败 ${u.replace(/^https?:\/\//, '')} -> ${e.message}`);
      }
    }
    if (!done) {
      console.warn(`[fetch-loaders] ✗ ${name} 全部源失败（运行时仍会联网下载）`);
      fail++;
    }
  }
  console.log(`[fetch-loaders] 完成：成功 ${ok}，失败 ${fail}，目录 ${OUT_DIR}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.warn('[fetch-loaders] 失败（不阻断构建）:', e.message);
    process.exit(0);
  });
