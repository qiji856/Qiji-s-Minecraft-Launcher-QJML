'use strict';
// 游戏选项覆盖逻辑单元测试（不依赖 Electron，直接测 src/core/gameOptions）
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const go = require('../src/core/gameOptions');

let pass = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { console.error('  ✗ ' + name); process.exitCode = 1; }
}

// 临时目录
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qjml-go-'));
const gameDir = path.join(tmp, 'game');
fs.mkdirSync(gameDir, { recursive: true });

console.log('parseOptions');
{
  const m = go.parseOptions('fov:0.5\ngamma:0.5\nfancyGraphics:true\ndifficulty:2\nlanguage:zh_cn\nkey_key.jump:SPACE\n');
  ok('数字解析为 number', m.fov === 0.5 && typeof m.fov === 'number');
  ok('布尔解析', m.fancyGraphics === true);
  ok('整型解析', m.difficulty === 2);
  ok('字符串保留', m.language === 'zh_cn');
  ok('非选项键（按键）保留', m['key_key.jump'] === 'SPACE');
}

console.log('writePreset / readPresetText 往返');
{
  go.writePreset(tmp, { fov: 0.75, gamma: 0.2, fancyGraphics: false, difficulty: 1, language: 'en_us' });
  const txt = go.readPresetText(tmp);
  const back = go.parseOptions(txt);
  ok('fov 写回正确', back.fov === 0.75);
  ok('gamma 写回正确', back.gamma === 0.2);
  ok('布尔写回为字符串 true/false', back.fancyGraphics === false);
  ok('整型写回', back.difficulty === 1);
  ok('语言写回', back.language === 'en_us');
}

console.log('applyToGame：无预设 → 不写');
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'qjml-go2-'));
  const r = go.applyToGame(d, gameDir);
  ok('返回未应用 + 原因 no-preset', r.applied === false && r.reason === 'no-preset');
  ok('游戏目录未新建 options.txt', !fs.existsSync(path.join(gameDir, 'options.txt')));
}

console.log('applyToGame：预设与游戏一致 → 不写');
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'qjml-go3-'));
  go.writePreset(d, { fov: 0.5, gamma: 0.5 });
  fs.writeFileSync(path.join(gameDir, 'options.txt'), 'fov:0.5\ngamma:0.5\n');
  const r = go.applyToGame(d, gameDir);
  ok('返回未应用 + 原因 same', r.applied === false && r.reason === 'same');
}

console.log('applyToGame：预设与游戏不同 → 合并覆盖写回，保留游戏其它键');
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'qjml-go4-'));
  go.writePreset(d, { fov: 0.8, difficulty: 3 });
  // 游戏已有自己的设置，含按键绑定等非选项键
  fs.writeFileSync(path.join(gameDir, 'options.txt'),
    'fov:0.5\ngamma:0.5\ndifficulty:2\nkey_key.jump:SPACE\nlastServer:mc.example.com\n');
  const r = go.applyToGame(d, gameDir);
  ok('返回已应用', r.applied === true && r.keys === 2);
  const after = go.parseOptions(fs.readFileSync(path.join(gameDir, 'options.txt'), 'utf8'));
  ok('预设键被覆盖 (fov)', after.fov === 0.8);
  ok('预设键被覆盖 (difficulty)', after.difficulty === 3);
  ok('游戏未被预设的键保留 (gamma)', after.gamma === 0.5);
  ok('游戏非选项键保留 (按键绑定)', after['key_key.jump'] === 'SPACE');
  ok('游戏非选项键保留 (lastServer)', after.lastServer === 'mc.example.com');
}

console.log('displayToStored / storedToDisplay 往返');
{
  const fov = go.SCHEMA_BY_KEY.fov;
  ok('角度 70° → 存储 0.5', Math.abs(go.displayToStored(fov, 70) - 0.5) < 1e-9);
  ok('存储 0.5 → 显示 70°', go.storedToDisplay(fov, 0.5) === 70);
  const g = go.SCHEMA_BY_KEY.gamma;
  ok('百分比 80% → 存储 0.8', Math.abs(go.displayToStored(g, 80) - 0.8) < 1e-9);
  ok('存储 0.8 → 显示 80%', go.storedToDisplay(g, 0.8) === 80);
  const s = go.SCHEMA_BY_KEY.fancyGraphics;
  ok('开关 true → 存储 true', go.displayToStored(s, true) === true);
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '（有失败）' : '，全部通过 ✅'));
