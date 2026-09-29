import assert from 'node:assert';
import {
  mergeField,
  collectConflicts,
  getMergedChange,
  validateForRelease,
  type ApiContract,
  type ChangeCandidate,
  type ContractChange,
} from '../src/models/contract';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

const baseChange: ContractChange = {
  id: 'c1',
  path: '/x',
  method: 'GET',
  kind: 'enum_expanded',
  before: 'b',
  after: 'a',
  compatibility: 'warning',
  rationale: 'r',
  impactStatement: '',
  migrationPlan: '',
  reviewState: 'pending',
  reviewer: '',
  reviewComment: '',
};

function makeContract(partial: Partial<ApiContract> = {}): ApiContract {
  return {
    id: 'k',
    name: 'n',
    version: '1.0.0',
    domain: 'd',
    owner: 'o',
    protocol: 'REST',
    status: 'review',
    updatedAt: new Date().toISOString(),
    openapi: 'openapi',
    changes: [baseChange],
    consumers: [],
    exemptions: [],
    candidates: [],
    baselineId: 'B1',
    baselineLabel: 'v1',
    baselineUpdatedAt: '',
    snapshots: [],
    ...partial,
  };
}

function candidate(
  over: Partial<ChangeCandidate> & { id: string; value: string; windowId: string },
): ChangeCandidate {
  return {
    contractId: 'k',
    changeId: 'c1',
    field: 'impactStatement',
    baselineId: 'B1',
    baselineLabel: 'v1',
    baselineValue: '',
    windowLabel: over.windowId,
    author: `author-${over.windowId}`,
    submittedAt: new Date().toISOString(),
    ...over,
  } as ChangeCandidate;
}

check('无候选时回退基线值', () => {
  const contract = makeContract();
  const merged = mergeField(contract, 'c1', 'impactStatement');
  assert.strictEqual(merged.value, '');
  assert.strictEqual(merged.source, 'baseline');
  assert.strictEqual(merged.conflict, null);
});

check('不同字段的补充自动合并', () => {
  const contract = makeContract({
    candidates: [
      candidate({ id: 'x', windowId: 'w1', field: 'impactStatement', value: '窗口A影响' } as never),
      candidate({ id: 'y', windowId: 'w1', field: 'migrationPlan', value: '窗口A迁移' } as never),
    ],
  });
  assert.strictEqual(getMergedChange(contract, 'c1').impactStatement, '窗口A影响');
  assert.strictEqual(getMergedChange(contract, 'c1').migrationPlan, '窗口A迁移');
  assert.strictEqual(collectConflicts(contract).length, 0);
});

check('同字段不同窗口给出相同值 -> 自动合并且带来源', () => {
  const contract = makeContract({
    candidates: [
      candidate({ id: 'x', windowId: 'w1', value: '相同补充' }),
      candidate({ id: 'y', windowId: 'w2', value: '相同补充' }),
    ],
  });
  const merged = mergeField(contract, 'c1', 'impactStatement');
  assert.strictEqual(merged.value, '相同补充');
  assert.strictEqual(merged.conflict, null);
  assert.strictEqual(merged.source, 'candidate');
});

check('同字段不同值 -> 保留双方形成冲突，生效值回退基线', () => {
  const contract = makeContract({
    candidates: [
      candidate({ id: 'x', windowId: 'w1', value: 'A的说明' }),
      candidate({ id: 'y', windowId: 'w2', value: 'B的说明' }),
    ],
  });
  const merged = mergeField(contract, 'c1', 'impactStatement');
  assert.ok(merged.conflict);
  assert.deepStrictEqual(
    merged.conflict!.candidateIds.toSorted(),
    ['x', 'y'],
  );
  assert.strictEqual(merged.value, ''); // 未解决前回退基线，避免误发布
  assert.strictEqual(collectConflicts(contract).length, 1);
});

check('解决冲突后保留指定候选', () => {
  const contract = makeContract({
    candidates: [
      candidate({ id: 'x', windowId: 'w1', value: 'A的说明' }),
      candidate({ id: 'y', windowId: 'w2', value: 'B的说明', resolution: 'kept' }),
    ],
  });
  const merged = mergeField(contract, 'c1', 'impactStatement');
  assert.strictEqual(merged.conflict, null);
  assert.strictEqual(merged.value, 'B的说明');
  assert.strictEqual(merged.windowLabel, 'w2');
});

check('基线过期候选会被门禁标记为 blocker', () => {
  const contract = makeContract({
    baselineId: 'B2',
    baselineLabel: 'v2',
    candidates: [
      candidate({ id: 'x', windowId: 'w1', value: '说明', baselineId: 'B1', baselineLabel: 'v1' }),
    ],
  });
  const blockers = validateForRelease(contract).filter((i) => i.severity === 'blocker');
  assert.ok(blockers.some((i) => i.id === 'stale-baseline'));
});

check('已接受但说明不齐 -> blocker', () => {
  const contract = makeContract({
    changes: [{ ...baseChange, reviewState: 'accepted', reviewer: 'r' }],
  });
  const blockers = validateForRelease(contract).filter((i) => i.severity === 'blocker');
  assert.ok(blockers.some((i) => i.title.includes('调用方影响说明')));
  assert.ok(blockers.some((i) => i.title.includes('迁移方案')));
});

check('待评审变化只产生 warning（本次不纳入发布），不阻断', () => {
  const contract = makeContract();
  const issues = validateForRelease(contract);
  assert.ok(issues.some((i) => i.id === 'excluded-c1' && i.severity === 'warning'));
  assert.ok(!issues.some((i) => i.severity === 'blocker'));
});

console.log(`\n全部 ${passed} 项模型测试通过`);
