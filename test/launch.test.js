'use strict';
// 启动器纯逻辑单元测试（无需联网/启动游戏即可验证确定性部分）
const path = require('path');
const assert = require('assert');
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

const launch = require('../src/core/launch');

console.log('launch.js 纯逻辑测试');

// 1. token 替换
ok('substitute 替换已知 token', launch.substitute('${auth_player_name}/${classpath}', { auth_player_name: 'Steve', classpath: 'a;b' }) === 'Steve/a;b');
// 未知占位符必须清空：留着 "${xxx}" 字面量会被 Java 当成真实路径解析，
// 直接导致 InvalidPathException 启动失败。
ok('substitute 清除未知 token（不留字面量）', launch.substitute('${unknown}', {}) === '');

// 2. 库路径（maven 坐标 -> 路径）
ok('libArtifactPath 无 downloads 时按 maven 拼', launch.libArtifactPath({ name: 'com.google.guava:guava:31.0' }) === 'com/google/guava/guava/31.0/guava-31.0.jar');
ok('libArtifactPath 优先用 downloads.artifact.path', launch.libArtifactPath({ name: 'x:y:1', downloads: { artifact: { path: 'custom/path.jar' } } }) === 'custom/path.jar');

// 3. rules 评估
ok('evalRules 无 rules 默认允许', launch.evalRules(undefined, { platform: 'windows', arch: 'x86_64' }));
ok('evalRules allow+os 命中', launch.evalRules([{ action: 'allow', os: { name: 'windows' } }], { platform: 'windows', arch: 'x86_64' }));
ok('evalRules allow+os 不命中', !launch.evalRules([{ action: 'allow', os: { name: 'linux' } }], { platform: 'windows', arch: 'x86_64' }));
ok('evalRules disallow 覆盖', !launch.evalRules([{ action: 'allow', os: { name: 'windows' } }, { action: 'disallow', os: { name: 'windows' } }], { platform: 'windows', arch: 'x86_64' }));

// 4. resolveVersion 合并（mock 版本链，不读磁盘）
// 通过临时目录构造 fake 版本文件：1.20.1(父) -> 1.20.1-forge-x(子)
const fs = require('fs');
const os = require('os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'launchtest-'));
const root = path.join(tmp, '.minecraft');
const vdir = (id) => path.join(root, 'versions', id);
function writeV(id, obj) { fs.mkdirSync(vdir(id), { recursive: true }); fs.writeFileSync(path.join(vdir(id), id + '.json'), JSON.stringify(obj)); }

writeV('1.20.1', {
  id: '1.20.1', mainClass: 'net.minecraft.client.main.Main', assets: '1.20', assetIndex: { id: '1.20', url: 'https://x/1.20.json' },
  libraries: [{ name: 'a:a:1' }, { name: 'b:b:1', rules: [{ action: 'allow', os: { name: 'linux' } }] }],
  arguments: { jvm: ['-Xopt', '-Dx=${natives_directory}'], game: ['--width', '854'] },
});
writeV('1.20.1-forge-x', {
  id: '1.20.1-forge-x', inheritsFrom: '1.20.1', mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher', type: 'release',
  libraries: [{ name: 'net.minecraftforge:forge:1.20.1-x' }],
  arguments: { jvm: ['-Dforge'], game: ['--fml'] },
});

const merged = launch.resolveVersion(root, '1.20.1-forge-x');
ok('resolveVersion mainClass 取子层', merged.mainClass === 'cpw.mods.bootstraplauncher.BootstrapLauncher');
ok('resolveVersion assets 取父层', merged.assets === '1.20');
ok('resolveVersion libraries 累加', merged.libraries.length === 3);
ok('resolveVersion jvmArgs 合并父+子', merged.jvmArgs.includes('-Dx=${natives_directory}') && merged.jvmArgs.includes('-Dforge'));
ok('resolveVersion gameArgs 合并父+子', merged.gameArgs.includes('854') && merged.gameArgs.includes('--fml'));

// 5. tokensFor 基本字段
const auth = launch.offlineAuth('测试玩家');
const toks = launch.tokensFor(auth, { instance: '1.20.1-forge-x', assets: '1.20' }, 'CP', 'NAT', 'LIB', 'ASSETS', 'GAME');
ok('tokensFor 玩家名', toks.auth_player_name === '测试玩家');
ok('tokensFor classpath', toks.classpath === 'CP');
ok('tokensFor natives_directory', toks.natives_directory === 'NAT');
ok('offlineAuth 生成 uuid', /^[0-9a-f]{8}-/.test(auth.selectedProfile.id));

// 6. 回归：Forge module-path 的 ${classpath_separator}
// 真实故障：Forge/NeoForge 版本 json 的 -p 参数用 ${classpath_separator} 连接多个 jar。
// 若该 token 未被替换，Java 会把整个 module-path 当成单一路径解析，
// 报 "InvalidPathException: Illegal char <:> at index N" 而启动失败。
ok('tokensFor 提供 classpath_separator', toks.classpath_separator === path.delimiter);
const sepTok = { classpath_separator: path.delimiter };
ok(
  'module-path 中 ${classpath_separator} 被替换为系统分隔符',
  launch.substitute('${library_directory}/a.jar${classpath_separator}${library_directory}/b.jar', Object.assign({ library_directory: 'LIB' }, sepTok))
    === 'LIB/a.jar' + path.delimiter + 'LIB/b.jar'
);
ok('替换后 module-path 不残留占位符', !launch.substitute('${library_directory}/a.jar${classpath_separator}C:/b.jar', sepTok).includes('${'));

// 7. 回归：arguments 里的 value 可能是数组
// 真实故障：新版版本 json 里 { rules:[...], value:["--width","${resolution_width}","--height","${resolution_height}"] }
// 若不逐项展开，整个数组会被当成一个参数传给 JVM。
const osWin = { platform: 'windows', arch: 'x86_64' };
const arrTok = Object.assign({}, toks, { resolution_width: '1280', resolution_height: '720' });
// 默认不开自定义分辨率 → 该组参数不应出现
ok(
  'expandArg 默认不展开自定义分辨率参数',
  JSON.stringify(launch.expandArg({ rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}'] }, arrTok, osWin)) === '[]'
);
// 用户在设置里指定分辨率 → 该组参数才展开
ok(
  'expandArg 开启自定义分辨率后展开数组 value',
  JSON.stringify(launch.expandArg({ rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}', '--height', '${resolution_height}'] }, arrTok, Object.assign({}, osWin, { features: { has_custom_resolution: true } })))
    === JSON.stringify(['--width', '1280', '--height', '720'])
);
ok('expandArg 展开字符串 value', JSON.stringify(launch.expandArg({ rules: [{ action: 'allow', os: { name: 'windows' } }], value: '-Xfoo' }, toks, osWin)) === JSON.stringify(['-Xfoo']));
ok('expandArg 纯字符串参数', JSON.stringify(launch.expandArg('-cp', toks, osWin)) === JSON.stringify(['-cp']));
ok('expandArg rules 不命中返回空', JSON.stringify(launch.expandArg({ rules: [{ action: 'allow', os: { name: 'linux' } }], value: '-Xfoo' }, toks, osWin)) === '[]');
ok('expandArg 丢弃空参数', JSON.stringify(launch.expandArg('${unknown_token}', toks, osWin)) === '[]');

// 8. 回归：任何参数里都不能残留 ${...} 字面量
const allArgs = launch.expandArg({ value: ['${classpath}', '${library_directory}/x.jar'] }, toks, osWin);
ok('参数中无残留占位符', !allArgs.some((a) => /\$\{[a-zA-Z_]+\}/.test(a)));

console.log('\\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
