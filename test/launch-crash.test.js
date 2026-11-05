'use strict';
// 启动崩溃诊断增强测试：分辨率过高 / 硬盘不足 / 游戏未安装完全 三类新增原因，
// 以及确认它们不会盖掉已有的 内存不足 / 模组不兼容 判定。
const launch = require('../src/core/launch');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

console.log('启动崩溃诊断增强测试');

const ctx = { instance: 'test', javaPath: 'java', gameDir: undefined, hasCrash: false, crashReportPath: null };

// ---- 分辨率过高 / 显卡或 OpenGL 不支持 ----
const r1 = launch.diagnoseCrash('GLFW error 65542: WGL: The driver does not support OpenGL', 1, ctx);
ok('分辨率/OpenGL：识别为「分辨率过高或显卡 / OpenGL 不支持」',
  r1.title.indexOf('分辨率过高') >= 0 || r1.title.indexOf('OpenGL') >= 0);
ok('分辨率/OpenGL：给出降低分辨率的建议', r1.suggestions.some((s) => s.indexOf('分辨率') >= 0));

const r1b = launch.diagnoseCrash('Exception: Could not create window: ... ', 1, ctx);
ok('分辨率/OpenGL：Could not create window 也能识别', r1b.title.indexOf('分辨率过高') >= 0);

// ---- 硬盘空间不足（日志中出现写盘失败）----
const d1 = launch.diagnoseCrash('Caused by: java.io.IOException: No space left on device', 1, ctx);
ok('硬盘不足：识别为「硬盘空间不足」', d1.title.indexOf('硬盘空间不足') >= 0);
ok('硬盘不足：建议清理磁盘', d1.suggestions.some((s) => s.indexOf('清理') >= 0));

const d1b = launch.diagnoseCrash('There is not enough space on the disk', 1, ctx);
ok('硬盘不足：英文「There is not enough space」也能识别', d1b.title.indexOf('硬盘空间不足') >= 0);

// ---- 游戏未安装完全（资源 / 原版 jar / 运行库缺失）----
const g1 = launch.diagnoseCrash('ERROR Failed to download file minecraft.jar', 1, ctx);
ok('未安装完全：识别为「游戏未安装完全」', g1.title.indexOf('游戏未安装完全') >= 0);
ok('未安装完全：建议重新安装原版游戏', g1.suggestions.some((s) => s.indexOf('原版游戏') >= 0));

const g1b = launch.diagnoseCrash('java.io.FileNotFoundException: assets/indexes/1.20.1.json', 1, ctx);
ok('未安装完全：资源索引缺失也能识别', g1b.title.indexOf('游戏未安装完全') >= 0);

// ---- 不盖掉已有的 内存不足 ----
const m1 = launch.diagnoseCrash('java.lang.OutOfMemoryError: Java heap space', 1, ctx);
ok('内存不足：仍正确识别（未被新增原因盖掉）', m1.title.indexOf('内存不足') >= 0);

// ---- 内存设置无效（JVM 起不来：Too small maximum heap）----
const h1 = launch.diagnoseCrash(
  'Picked up JAVA_TOOL_OPTIONS: -Dfile.encoding=UTF-8\nError occurred during initialization of VM\nToo small maximum heap',
  1, ctx);
ok('内存设置无效：识别为「内存设置无效」', h1.title.indexOf('内存设置无效') >= 0);
ok('内存设置无效：提示最小内存不得大于最大内存', h1.suggestions.some((s) => s.indexOf('最小内存') >= 0));
ok('内存设置无效：提示补 M / G 单位', h1.suggestions.some((s) => s.indexOf('单位') >= 0));

const h1b = launch.diagnoseCrash('Error occurred during initialization of VM\nCould not reserve enough space for object heap', 1, ctx);
ok('内存设置无效：Could not reserve enough space 也能识别', h1b.title.indexOf('内存设置无效') >= 0);

// ---- 内存清洗函数：无效值必须回退默认，正常值必须原样保留 ----
const sm = launch.sanitizeMemory;
ok('内存清洗：0 被判为无效', sm({ min: '1G', max: '0' }).changed === true);
ok('内存清洗：过小值（64M）被判为无效', sm({ min: '1G', max: '64M' }).changed === true);
ok('内存清洗：最小>最大被判为无效', sm({ min: '2G', max: '1G' }).changed === true);
ok('内存清洗：无法解析被判为无效', sm({ min: '1G', max: 'abc' }).changed === true);
ok('内存清洗：正常值（4G/2G）原样保留', sm({ min: '2G', max: '4G' }).value.max === '4G' && sm({ min: '2G', max: '4G' }).changed === false);
ok('内存清洗：正常值（1024M）原样保留', sm({ min: '512M', max: '1024M' }).value.max === '1024M' && sm({ min: '512M', max: '1024M' }).changed === false);
ok('内存清洗：回退后使用默认 1G~2G', sm({ min: '2G', max: '0' }).value.max === '2G' && sm({ min: '2G', max: '0' }).value.min === '1G');

// ---- 不盖掉已有的 Java 版本不匹配 ----
const j1 = launch.diagnoseCrash('java.lang.UnsupportedClassVersionError: ...', 1, ctx);
ok('Java 版本：仍正确识别', j1.title.indexOf('Java 版本不匹配') >= 0);

// ---- 游戏崩溃报告（模组不兼容）仍优先 ----
const modLog = 'Error during pre-loading phase\nSome of your mods are incompatible with the game or each other!';
const c1 = launch.diagnoseCrash(modLog, 1, ctx);
ok('模组不兼容：崩溃报告优先识别为模组问题', c1.type === 'mod' || c1.title.indexOf('模组') >= 0);

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
