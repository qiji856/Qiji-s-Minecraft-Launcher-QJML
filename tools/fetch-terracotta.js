'use strict';
// 构建前自动抓取「陶瓦联机 Terracotta」Windows x64 二进制，放入 resources/terracotta/，
// 使安装包自带组件，用户首次联机无需联网下载。
//
// 若网络失败 / 解析不到资产：仅打印警告并 exit 0，**不阻断构建**。
// 运行时仍可走「下载陶瓦联机」按钮（resolveRelease 已修复 .tar.gz 匹配）。
//
// 合规：陶瓦联机为 AGPL-3.0 + 例外条款。本启动器不链接其代码，仅通过 HTTP API
// 做进程间通信，并在界面标注版权。这里只是把独立二进制随包分发，符合例外条款。

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const terracotta = require('../src/core/terracotta');

// 下载到 src/core/bin/terracotta —— 该目录随 src/**/* 被打包进 app.asar（并被 asarUnpack 解出来），
// 因此无论是安装版（Setup）还是免解压绿色版（Green zip），都自带这个组件，
// 朋友拿到启动器无需任何额外步骤即可联机。源码仓库里不放二进制（.gitignore 忽略），
// 构建时由本脚本自动下载。
const OUT_DIR = path.join(__dirname, '..', 'src', 'core', 'bin', 'terracotta');
const EXE_NAME = process.platform === 'win32' ? 'terracotta.exe' : 'terracotta';

// 递归在解压目录里找第一个 .exe
function findExe(dir) {
  let found = null;
  const walk = (d) => {
    if (found) return;
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.exe$/i.test(e.name)) { found = p; return; }
    }
  };
  walk(dir);
  return found;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const existing = path.join(OUT_DIR, EXE_NAME);
  if (fs.existsSync(existing) && !process.argv.includes('--force')) {
    console.log('[fetch-terracotta] 已存在内置组件，跳过:', existing);
    return;
  }
  // 版本号优先走 GitHub API（可访问），再构造 Gitee 镜像源（国内可达）优先下载
  let rel = null;
  try { rel = await terracotta.resolveRelease(); } catch (_) { rel = null; }
  const tag = (rel && rel.version) || 'v0.4.2';
  const ver = String(tag).replace(/^v/i, '');
  const fileName = `terracotta-${ver}-windows-x86_64-pkg.tar.gz`;
  const sources = [
    { name: fileName, url: `https://gitee.com/burningtnt/Terracotta/releases/download/${tag}/${fileName}` },
  ];
  if (rel && Array.isArray(rel.assets)) {
    for (const a of rel.assets) {
      if (/windows/i.test(a.name) && /x86_64|amd64|win64|x64/i.test(a.name) && /\.(tar\.gz|zip|exe)$/i.test(a.name)) {
        sources.push({ name: a.name, url: a.url });
      }
    }
  }
  console.log('[fetch-terracotta] 版本', tag, '· 下载源:', sources.map((s) => s.url).join(' | '));
  const tmp = path.join(OUT_DIR, '_dl_' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  let archive = null;
  for (const s of sources) {
    const cand = path.join(tmp, s.name);
    try {
      await terracotta.downloadAsset(s.url, cand, {
        onProgress: (p) => process.stdout.write('\r  ' + tag + ' 下载 ' + (p.percent || 0) + '%'),
      });
      process.stdout.write('\n');
      archive = cand;
      break;
    } catch (e) {
      console.warn('[fetch-terracotta] 源失败:', s.url, '->', e.message);
    }
  }
  if (!archive) {
    console.warn('[fetch-terracotta] 所有下载源均失败，跳过内置组件（运行时仍可点「下载陶瓦联机」）');
    return;
  }
  try {
    if (/\.zip$/i.test(asset.name)) {
      const AdmZip = require('adm-zip');
      new AdmZip(archive).extractAllTo(tmp, true);
    } else {
      execSync('tar -xzf "' + archive + '" -C "' + tmp + '"', { stdio: 'ignore' });
    }
  } catch (e) {
    console.warn('[fetch-terracotta] 解压失败:', e.message);
    return;
  }
  // 把解压出的全部文件（exe + 依赖 DLL 等）一并复制，避免缺运行时依赖
  const copyAll = (srcDir, destDir) => {
    let ents;
    try { ents = fs.readdirSync(srcDir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const s = path.join(srcDir, e.name);
      const d = path.join(destDir, e.name);
      if (e.isDirectory()) copyAll(s, d);
      else fs.copyFileSync(s, d);
    }
  };
  copyAll(tmp, OUT_DIR);
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = fs.existsSync(path.join(OUT_DIR, EXE_NAME));
  console.log(ok ? '[fetch-terracotta] 已内置组件: ' + path.join(OUT_DIR, EXE_NAME) + ' (含依赖 DLL)' : '[fetch-terracotta] 未找到 exe，跳过');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.warn('[fetch-terracotta] 失败（不阻断构建）:', e.message);
    process.exit(0);
  });
