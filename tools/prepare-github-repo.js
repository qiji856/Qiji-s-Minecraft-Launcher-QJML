'use strict';
/* 把「要上传 GitHub 的源码」按目录结构整理到一个干净的仓库文件夹里。
 *
 * 用法： node tools/prepare-github-repo.js [目标目录]
 *   默认目标：D:\AI\QJML-GitHub
 *
 * 做什么：
 *   1. 按目录树复制源码（src/ tools/ test/ build/ + 根目录若干文件）
 *   2. 跳过不该进 Git 的东西（node_modules / dist / shots / 二进制 bin/）
 *   3. 保留 .gitignore
 *   4. 写一份「仓库说明.txt」告诉用户怎么提交
 *   5. git init（如果目标里还没有 .git）
 *
 * ★ 二进制（Forge/NeoForge 安装器、航空学 jar、陶瓦联机 exe）**不复制**：
 *   它们体积大且有版权，构建时由 tools/fetch-*.js 自动下载（.gitignore 已忽略）。
 *   这样仓库只有几百 KB，推送很快。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SRC = path.join(__dirname, '..');
const DEST = process.argv[2] || 'D:\\AI\\QJML-GitHub';

// 要复制的顶层项
const INCLUDE = [
  'main.js',
  'preload.js',
  'package.json',
  'package-lock.json',
  'LICENSE',
  'README.md',
  '.gitignore',
  'build',
  'src',
  'test',
  'tools',
];

// 复制的过程中要跳过的路径（相对仓库根）
const EXCLUDE = [
  path.join('src', 'core', 'bin'),   // 二进制：构建时自动下载
];

// 不复制的目录名
const SKIP_DIRS = new Set(['node_modules', 'dist', 'shots', '.git']);

let fileCount = 0;
let dirCount = 0;
let totalBytes = 0;

function copyTree(srcDir, destDir, relBase) {
  fs.mkdirSync(destDir, { recursive: true });
  dirCount++;
  const ents = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of ents) {
    if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
    const s = path.join(srcDir, e.name);
    const d = path.join(destDir, e.name);
    const rel = path.join(relBase, e.name);
    if (EXCLUDE.includes(rel)) {
      console.log('  ⊘ 跳过（二进制，构建时自动下载）:', rel);
      continue;
    }
    if (e.isDirectory()) copyTree(s, d, rel);
    else {
      fs.copyFileSync(s, d);
      fileCount++;
      totalBytes += fs.statSync(s).size;
    }
  }
}

function main() {
  console.log('源目录  :', SRC);
  console.log('目标目录:', DEST);
  console.log('');

  // 目标已存在 → 先清掉「要复制的那几项」（保留 .git 与其它文件），避免残留上次的旧文件
  if (fs.existsSync(DEST)) {
    for (const item of INCLUDE) {
      const d = path.join(DEST, item);
      if (!fs.existsSync(d)) continue;
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch (e) {
        console.warn('  ! 无法清理旧文件（可能被占用）：' + item + ' → ' + e.message);
      }
    }
  }
  fs.mkdirSync(DEST, { recursive: true });

  for (const item of INCLUDE) {
    const s = path.join(SRC, item);
    if (!fs.existsSync(s)) { console.log('  ! 不存在，跳过:', item); continue; }
    const d = path.join(DEST, item);
    if (fs.statSync(s).isDirectory()) {
      console.log('  + 目录', item + '/');
      copyTree(s, d, item);
    } else {
      fs.copyFileSync(s, d);
      fileCount++;
      totalBytes += fs.statSync(s).size;
      console.log('  + 文件', item);
    }
  }

  // 仓库说明
  const readme = [
    'QJML · Qiji\'s Minecraft Launcher —— GitHub 仓库说明',
    '=================================================',
    '',
    '这个文件夹就是要上传到 GitHub 的全部内容。',
    '',
    '一、怎么提交',
    '------------',
    '方式 A（网页上传，最简单）：',
    '  1. 在 GitHub 新建一个仓库（名字随便，比如 QJML）',
    '  2. 仓库建好后点 "uploading an existing file"',
    '  3. 把这个文件夹里的所有内容拖进网页（bin/ 这种被忽略的目录不在这里）',
    '  4. 填个提交说明，点 Commit',
    '',
    '方式 B（命令行）：',
    '  cd 这个文件夹',
    '  git init',
    '  git add .',
    '  git commit -m "init: QJML 3.0.5 源码"',
    '  git branch -M main',
    '  git remote add origin https://github.com/你的用户名/QJML.git',
    '  git push -u origin main',
    '',
    '二、哪些东西故意不在这里',
    '------------------------',
    '  src/core/bin/     —— 二进制文件（Forge/NeoForge 安装器 28.5MB、航空学 jar 31.6MB、',
    '                        陶瓦联机 exe 9.1MB）。体积大且有版权，所以不提交。',
    '                        构建时由 tools/fetch-loaders.js 等脚本自动下载。',
    '  node_modules/     —— 依赖，执行 npm install 就能装回来',
    '  dist/ shots/      —— 构建产物与开发截图',
    '',
    '三、以后每次更新要传什么',
    '----------------------',
    '  只传「改动过的代码文件」。git push 只会传差异部分，仓库不会越攒越大。',
    '  打包出来的成品（Setup / Green zip）不要传仓库，',
    '  单独放到 GitHub 的 Releases 页面当附件。',
    '',
    '  完整发版流程见 README.md 的「发一个版本要做什么」一节。',
    '',
    '四、克隆下来怎么构建',
    '--------------------',
    '  npm install',
    '  npm test          （跑全部测试）',
    '  npm run dist      （打包；会自动下载内置二进制）',
    '',
    '注意：构建机上 npm run dist 会自动抓取 ~70MB 二进制；',
    '      构建前把 TEMP/TMP 指向非 C 盘（见 README「运行 / 打包」一节）。',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(DEST, '仓库说明.txt'), readme, 'utf8');

  // git init（目标里还没有 .git 时才做；已有则只确保分支叫 main）
  const gitDir = path.join(DEST, '.git');
  if (!fs.existsSync(gitDir)) {
    try {
      execFileSync('git', ['init'], { cwd: DEST, stdio: 'pipe' });
      console.log('\n已执行 git init');
    } catch (e) {
      console.log('\ngit init 失败（不影响你手动提交）:', e.message);
    }
  }
  try {
    execFileSync('git', ['branch', '-M', 'main'], { cwd: DEST, stdio: 'pipe' });
    console.log('分支已设为 main');
  } catch (e) {
    console.log('分支重命名跳过（可能还没提交过）：', e.message);
  }

  console.log('');
  console.log('完成：' + dirCount + ' 个目录，' + fileCount + ' 个文件，' + (totalBytes / 1024).toFixed(0) + ' KB');
  console.log('目标目录：' + DEST);
}

main();
