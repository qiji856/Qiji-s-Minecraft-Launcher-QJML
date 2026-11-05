'use strict';
// 更新检查：版本号比较的边界测试（最容易踩的坑是字符串比较把 2.10 当成小于 2.9）
const assert = require('assert');
const { parseVersion, compareVersion } = require('../src/core/updater');

function eq(actual, expected, msg) {
  assert.strictEqual(actual, expected, msg + ' (got ' + actual + ')');
}

eq(compareVersion('2.3.0', '2.3.0'), 0, 'equal');
eq(compareVersion('2.3.0', '2.3.1'), -1, 'patch newer');
eq(compareVersion('2.3.1', '2.3.0'), 1, 'patch older');
eq(compareVersion('2.9.0', '2.10.0'), -1, 'minor 9 vs 10 —— 字符串比较会判错');
eq(compareVersion('2.10.0', '2.9.0'), 1, 'minor 10 vs 9');
eq(compareVersion('1.9.0', '2.0.0'), -1, 'major jump');
eq(compareVersion('2.0.0', '1.9.0'), 1, 'major jump reverse');
eq(compareVersion('v2.3.0', '2.3.0'), 0, 'leading v stripped');
eq(compareVersion('2.3', '2.3.0'), 0, 'missing patch treated as 0');
eq(compareVersion('2.3.0-beta', '2.3.0'), 0, 'prerelease suffix ignored');
eq(compareVersion('', '2.3.0'), -1, 'empty current < anything');

assert.deepStrictEqual(parseVersion('v2.10.1'), [2, 10, 1], 'parseVersion shape');

console.log('updater version-compare tests passed ✅');
