import assert from 'node:assert';

// 提供服务层依赖的浏览器全局
const store = new Map<string, string>();
(globalThis as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;
(globalThis as { window?: unknown }).window = {
  setTimeout: (fn: () => void) => {
    fn();
    return 0;
  },
};

import { seedContracts } from '../src/data/seed';
import type { ApiContract } from '../src/models/contract';
import {
  submitCandidate,
  resolveConflict,
  freezeVersion,
  rollbackSnapshot,
  listContracts,
} from '../src/services/contract-service';

let passed = 0;
async function check(name: string, fn: () => unknown) {
  await fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

const contractId = 'contract-user';

function setup(): ApiContract {
  const seed = structuredClone(
    seedContracts.find((c) => c.id === contractId)!,
  ) as ApiContract;
  seed.changes[0] = {
    ...seed.changes[0],
    id: 't1',
    kind: 'enum_expanded',
    before: 'A|B',
    after: 'A|B|C',
    compatibility: 'warning',
    impactStatement: '',
    migrationPlan: '',
    reviewState: 'pending',
    reviewer: '',
    reviewComment: '',
  };
  seed.snapshots = [];
  seed.baselineId = 'B0';
  seed.baselineLabel = 'v0';
  return seed;
}

async function reload(): Promise<ApiContract> {
  return (await listContracts()).find((c) => c.id === contractId)!;
}

async function main() {
  localStorage.setItem('pair-wise-gsb-70-contracts', JSON.stringify([setup()]));

  // 窗口1：补影响 + 补迁移 + 接受（不同字段）
  await submitCandidate({ contractId, changeId: 't1', field: 'impactStatement', value: '影响：客服工作台', windowId: 'win-1', windowLabel: '窗口1', author: '甲' });
  await submitCandidate({ contractId, changeId: 't1', field: 'migrationPlan', value: '迁移：灰度两周', windowId: 'win-1', windowLabel: '窗口1', author: '甲' });
  await submitCandidate({ contractId, changeId: 't1', field: 'reviewState', value: 'accepted', windowId: 'win-1', windowLabel: '窗口1', author: '甲' });

  // 窗口2：同一影响字段给出不同取值 -> 冲突
  await submitCandidate({ contractId, changeId: 't1', field: 'impactStatement', value: '影响：BI 报表也要改', windowId: 'win-2', windowLabel: '窗口2', author: '乙' });

  await check('同字段冲突时发布被阻断', async () => {
    await assert.rejects(() => freezeVersion(contractId, '2.0.0', 'n'), /多个窗口|人工选择/);
  });

  // 解决冲突，保留窗口2
  let current = await reload();
  const keepId = current.candidates.find(
    (c) => c.windowId === 'win-2' && c.field === 'impactStatement',
  )!.id;
  await resolveConflict({ contractId, changeId: 't1', field: 'impactStatement', keepCandidateId: keepId, resolvedBy: '甲' });

  await check('冲突解决后发布成功并生成独立快照', async () => {
    const res = await freezeVersion(contractId, '2.0.0', '首个候选发布');
    assert.strictEqual(res.snapshots.length, 1);
  });

  current = await reload();
  await check('发布后基线推进、合并值固化、候选归档清空、报告随版留存', () => {
    assert.strictEqual(current.baselineId, current.snapshots[0].id);
    assert.strictEqual(current.baselineLabel, 'v2.0.0');
    assert.strictEqual(current.changes[0].reviewState, 'accepted');
    assert.strictEqual(current.changes[0].impactStatement, '影响：BI 报表也要改');
    assert.strictEqual(current.changes[0].migrationPlan, '迁移：灰度两周');
    assert.strictEqual(current.candidates.length, 0);
    assert.ok(current.snapshots[0].report.includes('发布变更报告'));
  });

  const snapshotId = current.snapshots[0].id;

  // 旧窗口在发布后才提交，携带过期基线
  await submitCandidate({ contractId, changeId: 't1', field: 'migrationPlan', value: '过期窗口的补充', windowId: 'win-old', windowLabel: '旧窗口', author: '丙' });
  const staleData = JSON.parse(localStorage.getItem('pair-wise-gsb-70-contracts')!) as ApiContract[];
  staleData.find((c) => c.id === contractId)!.candidates.forEach((cand) => {
    if (cand.windowId === 'win-old') {
      cand.baselineId = 'B0';
      cand.baselineLabel = 'v0';
    }
  });
  localStorage.setItem('pair-wise-gsb-70-contracts', JSON.stringify(staleData));

  await check('基线过期候选阻断发布', async () => {
    await assert.rejects(() => freezeVersion(contractId, '2.1.0', 'n'), /基线/);
  });

  // 回滚最新一版
  await rollbackSnapshot({ contractId, snapshotId, reason: '枚举值发错，撤回该版', operator: '甲' });
  current = await reload();
  await check('回滚只恢复该版变化到发布前，基线回退，快照与报告仍保留可查', () => {
    assert.strictEqual(current.changes[0].reviewState, 'pending');
    assert.strictEqual(current.changes[0].impactStatement, '');
    assert.strictEqual(current.changes[0].migrationPlan, '');
    assert.strictEqual(current.baselineId, 'B0');
    assert.strictEqual(current.baselineLabel, 'v0');
    const snapshot = current.snapshots.find((s) => s.id === snapshotId)!;
    assert.ok(snapshot.rollbackState);
    assert.strictEqual(snapshot.rollbackState!.reason, '枚举值发错，撤回该版');
    assert.ok(snapshot.report.includes('发布变更报告'));
  });

  await check('已回滚快照不能再次回滚', async () => {
    await assert.rejects(
      () => rollbackSnapshot({ contractId, snapshotId, reason: 'x', operator: '甲' }),
      /已经回滚/,
    );
  });

  console.log(`\n全部 ${passed} 项服务层检查通过`);
}

void main();
