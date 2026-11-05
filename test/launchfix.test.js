'use strict';
// 启动参数组装专项测试
// 背景：曾经出现过「Java 报 -cp requires class path specification 游戏秒退」的故障，
// 根因是版本 json 里 ["-cp","${classpath}"] 的第二项展开后为空被丢弃，
// 只剩一个孤零零的 -cp。这类问题 node --check 查不出来，必须专门盯住。
const path = require('path');
const fs = require('fs');
const os = require('os');
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

const launch = require('../src/core/launch');

console.log('启动参数组装测试');

const osWin = { platform: 'windows', arch: 'x86_64' };
const auth = { selectedProfile: { name: 'Tester', id: '12345678-1234-1234-1234-123456789012' }, accessToken: 'tok' };

// ---- 1. tokensFor 必须填真实 classpath ----
const CP = 'C:\\mc\\libs\\a.jar;C:\\mc\\libs\\b.jar';
const tok = launch.tokensFor(auth, { instance: '1.20.1' }, CP, 'C:\\mc\\natives', 'C:\\mc\\libs', 'C:\\mc\\assets', 'C:\\mc');
ok('tokensFor 把 classpath 填成真实值', tok.classpath === CP);
ok('tokensFor 不把 classpath 置空（回归：置空会导致悬空 -cp）', tok.classpath !== '' && tok.classpath !== undefined);

// ---- 2. Forge 风格的 ["-cp","${classpath}"] 展开后必须成对 ----
const forgeJvm = [
  { value: '-Xmx2G' },
  { value: ['-cp', '${classpath}'] },
  { value: '-Dfoo=bar' },
];
const expanded = forgeJvm.flatMap((a) => launch.expandArg(a, tok, osWin));
const cpIdx = expanded.indexOf('-cp');
ok('展开后能找到 -cp', cpIdx >= 0);
ok('-cp 后面紧跟 classpath 实际值', cpIdx >= 0 && expanded[cpIdx + 1] === CP);
ok('展开结果里没有悬空的 -cp', expanded.every((a, i) => a !== '-cp' || (i + 1 < expanded.length && expanded[i + 1] && !expanded[i + 1].startsWith('-'))));

// ---- 3. sanitizeCpFlags：清理悬空 -cp ----
ok('sanitizeCpFlags 删除末尾悬空的 -cp',
  JSON.stringify(launch.sanitizeCpFlags(['-Xmx2G', '-cp'])) === JSON.stringify(['-Xmx2G']));
ok('sanitizeCpFlags 删除后面接 - 开头的 -cp',
  JSON.stringify(launch.sanitizeCpFlags(['-cp', '-Xmx2G'])) === JSON.stringify(['-Xmx2G']));
ok('sanitizeCpFlags 保留完整的 -cp 值',
  JSON.stringify(launch.sanitizeCpFlags(['-cp', CP, '-Xmx2G'])) === JSON.stringify(['-cp', CP, '-Xmx2G']));
ok('sanitizeCpFlags 支持 -classpath 别名',
  JSON.stringify(launch.sanitizeCpFlags(['-classpath'])) === JSON.stringify([]));
ok('sanitizeCpFlags 不动其它参数',
  JSON.stringify(launch.sanitizeCpFlags(['-Xmx2G', '-Dfoo=bar'])) === JSON.stringify(['-Xmx2G', '-Dfoo=bar']));

// ---- 4. hasCpFlag ----
ok('hasCpFlag 识别 -cp', launch.hasCpFlag(['-cp', 'x']) === true);
ok('hasCpFlag 识别 -classpath', launch.hasCpFlag(['-classpath', 'x']) === true);
ok('hasCpFlag 无 cp 时返回 false', launch.hasCpFlag(['-Xmx2G']) === false);

// ---- 5. 端到端：模拟版本 json 的 arguments 展开，检查没有悬空 -cp ----
const simulated = [
  '-XX:HeapDumpPath=x.heapdump',
  '-cp',
  CP,
  '-Djava.net.preferIPv6Addresses=system',
  '-p',
  'C:\\mc\\libs\\m1.jar;C:\\mc\\libs\\m2.jar',
];
ok('模拟参数里 -cp 后有值', simulated[1] === '-cp' && !!simulated[2]);
const cleaned = launch.sanitizeCpFlags(simulated.slice());
ok('清理后参数数量不变（说明没有误删）', cleaned.length === simulated.length);
ok('清理后仍有且仅有一个 -cp', cleaned.filter((a) => a === '-cp').length === 1);

// ---- 6. 命令行超长 → 改用 @argfile ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argfile-'));
try {
  const short = launch.maybeWriteArgFile(['-Xmx2G', '-cp', CP], 'java', tmp);
  ok('命令行不长时不生成 argfile', short === null);

  const long = [];
  for (let i = 0; i < 4000; i++) long.push('C:\\very\\long\\path\\to\\library\\number\\' + i + '\\artifact-' + i + '.jar');
  const file = launch.maybeWriteArgFile(long, 'java', tmp);
  ok('命令行超长时生成 argfile', !!file && fs.existsSync(file));
  if (file) {
    const content = fs.readFileSync(file, 'utf8');
    ok('argfile 每行一个参数', content.trim().split(/\r?\n/).length === long.length);
    // 含反斜杠/空格的参数用双引号包裹，引号内的反斜杠被转义
    const quoted = content.split(/\r?\n/).filter((l) => l.startsWith('"'));
    ok('argfile 对特殊字符参数加了引号', quoted.length > 0);
    ok('argfile 引号内的反斜杠已转义', quoted.every((l) => !/[^\\]\\"/.test(l)));
  }
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
