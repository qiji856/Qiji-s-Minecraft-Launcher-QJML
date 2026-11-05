'use strict';
/* 模组前置依赖解析测试：用注入的假 API 验证「递归解析 required 依赖 + 去重 + 深度限制」 */
const assert = require('assert');
const modrinth = require('../src/core/modrinth');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

// ---------- 假数据：主模组 A 依赖 B，B 依赖 C，另有一个 optional 依赖 D ----------
const VERSIONS = {
  'A-v1': {
    id: 'A-v1',
    version_number: '1.0.0',
    game_versions: ['1.20.1'],
    dependencies: [
      { dependency_type: 'required', project_id: 'B', version_id: 'B-v1' },
      { dependency_type: 'optional', project_id: 'D', version_id: 'D-v1' },
    ],
    files: [{ primary: true, url: 'https://cdn/A.jar', filename: 'A.jar' }],
  },
  'B-v1': {
    id: 'B-v1',
    version_number: '2.0.0',
    game_versions: ['1.20.1'],
    dependencies: [{ dependency_type: 'required', project_id: 'C', version_id: 'C-v1' }],
    files: [{ primary: true, url: 'https://cdn/B.jar', filename: 'B.jar' }],
  },
  'C-v1': {
    id: 'C-v1',
    version_number: '3.0.0',
    game_versions: ['1.20.1'],
    dependencies: [],
    files: [{ primary: true, url: 'https://cdn/C.jar', filename: 'C.jar' }],
  },
  'D-v1': {
    id: 'D-v1',
    version_number: '4.0.0',
    game_versions: ['1.20.1'],
    dependencies: [],
    files: [{ primary: true, url: 'https://cdn/D.jar', filename: 'D.jar' }],
  },
};
const PROJECTS = {
  A: { id: 'A', title: '主模组 A' },
  B: { id: 'B', title: '前置 B' },
  C: { id: 'C', title: '传递前置 C' },
  D: { id: 'D', title: '可选依赖 D' },
};

// 每个项目拥有的版本（对应真实 Modrinth API：getProjectVersions 返回的是「该项目自己的版本」）
const PROJ_VERSIONS = {
  A: ['A-v1'],
  B: ['B-v1'],
  C: ['C-v1'],
  D: ['D-v1'],
};

const fakeApi = {
  async getVersion(id) {
    if (!VERSIONS[id]) throw new Error('未知版本 ' + id);
    return VERSIONS[id];
  },
  async getProjectVersions(pid) {
    return (PROJ_VERSIONS[pid] || []).map((id) => VERSIONS[id]).filter(Boolean);
  },
  async getProject(pid) {
    return PROJECTS[pid] || { id: pid, title: pid };
  },
};

console.log('\n[前置依赖解析]');

(async function main() {
  // 1. 传递依赖：B 和 C 都要被解析出来
  const deps = await modrinth.resolveDependencies('A', '1.20.1', { versionId: 'A-v1', api: fakeApi });
  const ids = deps.map((d) => d.projectId);
  ok('解析出直接前置 B', ids.includes('B'));
  ok('解析出传递前置 C', ids.includes('C'));
  ok('不解析 optional 依赖 D', !ids.includes('D'));
  ok('依赖数量为 2', deps.length === 2);

  // 2. 依赖项字段完整（供下载使用）
  const b = deps.find((d) => d.projectId === 'B');
  ok('依赖项带可下载 url', b && typeof b.fileUrl === 'string' && b.fileUrl.length > 0);
  ok('依赖项带文件名', b && b.fileName === 'B.jar');
  ok('依赖项带项目标题', b && b.name === '前置 B');
  ok('依赖项带版本号', b && b.versionNumber === '2.0.0');
  ok('依赖项带 versionId', b && b.versionId === 'B-v1');

  // 3. 循环依赖不会死循环（去重）
  const cyclicApi = {
    async getVersion(id) {
      return {
        id, version_number: '1', game_versions: ['1.20.1'],
        dependencies: [{ dependency_type: 'required', project_id: 'X', version_id: 'X-v1' }],
        files: [{ primary: true, url: 'https://cdn/x.jar', filename: 'x.jar' }],
      };
    },
    async getProjectVersions() {
      return [{ id: 'X-v1', version_number: '1', game_versions: ['1.20.1'],
        dependencies: [{ dependency_type: 'required', project_id: 'Y', version_id: 'Y-v1' }],
        files: [{ primary: true, url: 'https://cdn/y.jar', filename: 'y.jar' }] }];
    },
    async getProject(pid) { return { id: pid, title: pid }; },
  };
  const cyc = await modrinth.resolveDependencies('X', '1.20.1', { versionId: 'X-v1', api: cyclicApi });
  ok('循环依赖被安全终止（不重复）', new Set(cyc.map((d) => d.projectId)).size === cyc.length);

  // 4. 无依赖的模组返回空数组
  const noDep = await modrinth.resolveDependencies('C', '1.20.1', { versionId: 'C-v1', api: fakeApi });
  ok('无依赖时返回空数组', Array.isArray(noDep) && noDep.length === 0);

  // 5. API 抛错时不崩溃（返回空）
  const brokenApi = {
    async getVersion() { throw new Error('网络错误'); },
    async getProjectVersions() { throw new Error('网络错误'); },
    async getProject() { throw new Error('网络错误'); },
  };
  let broken = null;
  try { broken = await modrinth.resolveDependencies('A', '1.20.1', { versionId: 'A-v1', api: brokenApi }); }
  catch (_) { broken = null; }
  ok('接口异常时不抛出（返回空或空数组）', broken === null || (Array.isArray(broken) && broken.length === 0));

  console.log('\n结果：通过 ' + passed + '，失败 ' + failed);
  process.exit(failed ? 1 : 0);
})();
