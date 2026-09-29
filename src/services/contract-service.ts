import { seedContracts } from '../data/seed';
import type {
  ApiConsumer,
  ApiContract,
  ChangeCandidate,
  ContractChange,
  ContractStatus,
  Exemption,
  MergeableField,
  ReleaseSnapshot,
  ReviewState,
  SnapshotConsumerImpact,
} from '../models/contract';
import {
  collectConflicts,
  getMergedChange,
  isChangeReleaseReady,
  validateForRelease,
} from '../models/contract';
import { stableChecksum, formatDateTime } from '../lib/utils';

const STORAGE_KEY = 'pair-wise-gsb-70-contracts';
const LATENCY = 180;

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function wait(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, LATENCY));
}

/**
 * 把旧版本（无候选/基线/快照）的存储数据迁移到当前结构。
 * 旧的 versions 记录映射为只读快照，保证历史版本与报告仍可查。
 */
function normalize(raw: ApiContract): ApiContract {
  const legacy = raw as ApiContract & { versions?: Array<Record<string, unknown>> };
  const candidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  const snapshots: ReleaseSnapshot[] = Array.isArray(raw.snapshots)
    ? raw.snapshots
    : Array.isArray(legacy.versions)
      ? (legacy.versions as unknown as ReleaseSnapshot[]).map((version) => ({
          ...version,
          baselineId: raw.baselineId ?? `seed-${raw.id}`,
          baselineLabel:
            typeof version.baselineLabel === 'string' ? version.baselineLabel : raw.baselineLabel,
          changes: Array.isArray(version.changes) ? version.changes : [],
          changesBeforeRelease: Array.isArray(version.changesBeforeRelease)
            ? version.changesBeforeRelease
            : Array.isArray(version.changes)
              ? version.changes
              : [],
          consumerImpacts: Array.isArray(version.consumerImpacts)
            ? version.consumerImpacts
            : [],
          report:
            typeof version.report === 'string'
              ? version.report
              : buildChangeReport({ ...raw, snapshots: [], candidates: [] }),
        }))
      : [];
  return {
    ...raw,
    candidates,
    snapshots,
    baselineId: raw.baselineId ?? `seed-${raw.id}`,
    baselineLabel: raw.baselineLabel ?? '初始基线',
    baselineUpdatedAt: raw.baselineUpdatedAt ?? raw.updatedAt,
  };
}

export async function listContracts(): Promise<ApiContract[]> {
  await wait();
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as ApiContract[];
      const normalized = parsed.map(normalize);
      const needsPersist = normalized.some(
        (_, index) =>
          !Array.isArray(parsed[index]?.candidates) ||
          !Array.isArray(parsed[index]?.snapshots),
      );
      if (needsPersist) persistContracts(normalized);
      return normalized;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  persistContracts(seedContracts);
  return clone(seedContracts);
}

export async function getContract(id: string): Promise<ApiContract | undefined> {
  const contracts = await listContracts();
  return contracts.find((contract) => contract.id === id);
}

function touch(contract: ApiContract): ApiContract {
  return { ...contract, updatedAt: new Date().toISOString() };
}

async function commit(
  contractId: string,
  produce: (contract: ApiContract) => ApiContract,
): Promise<ApiContract> {
  const contracts = await listContracts();
  const index = contracts.findIndex((item) => item.id === contractId);
  if (index === -1) {
    throw new Error('契约不存在');
  }
  const next = touch(produce(contracts[index]));
  const updatedContracts = contracts.map((item) => (item.id === contractId ? next : item));
  persistContracts(updatedContracts);
  return clone(next);
}

export async function saveContract(updated: ApiContract): Promise<ApiContract> {
  const contracts = await listContracts();
  const exists = contracts.some((contract) => contract.id === updated.id);
  const saved = touch(normalize(updated));
  const next = exists
    ? contracts.map((contract) => (contract.id === updated.id ? saved : contract))
    : [saved, ...contracts];
  persistContracts(next);
  await wait();
  return clone(saved);
}

export interface CandidateInput {
  contractId: string;
  changeId: string;
  field: MergeableField;
  value: string;
  windowId: string;
  windowLabel: string;
  author: string;
}

/**
 * 提交一个窗口对某字段的候选补充。
 * 以 (changeId, field, windowId) 为粒度覆盖该窗口此前的候选；
 * 不同窗口的不同取值并存，由 mergeField 判定自动合并或形成冲突。
 */
export async function submitCandidate(input: CandidateInput): Promise<ApiContract> {
  return commit(input.contractId, (contract) => {
    const change = contract.changes.find((item) => item.id === input.changeId);
    if (!change) {
      throw new Error('变更不存在');
    }
    const now = new Date().toISOString();
    const existing = contract.candidates.find(
      (candidate) =>
        candidate.changeId === input.changeId &&
        candidate.field === input.field &&
        candidate.windowId === input.windowId,
    );

    // 与基线一致：该窗口没有实质补充，撤回其候选，避免无意义冲突
    if (input.value === String(change[input.field] ?? '')) {
      return {
        ...contract,
        candidates: contract.candidates.filter((candidate) => candidate.id !== existing?.id),
      };
    }

    const nextCandidate: ChangeCandidate = {
      id: existing?.id ?? `cand-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      contractId: input.contractId,
      changeId: input.changeId,
      field: input.field,
      baselineId: contract.baselineId,
      baselineLabel: contract.baselineLabel,
      baselineValue: String(change[input.field] ?? ''),
      value: input.value,
      windowId: input.windowId,
      windowLabel: input.windowLabel,
      author: input.author,
      submittedAt: existing?.submittedAt ?? now,
    };

    const others = contract.candidates.filter((candidate) => candidate.id !== existing?.id);
    // 只有当本次提交让该字段出现多个不同取值（冲突重新出现）时，
    // 才清空此前的冲突解决标记；提交自己的候选不会抹掉别人已做的选择。
    const otherValues = new Set(
      others
        .filter(
          (candidate) =>
            candidate.changeId === input.changeId &&
            candidate.field === input.field &&
            candidate.value !== String(change[input.field] ?? ''),
        )
        .map((candidate) => candidate.value),
    );
    const conflictReopens = otherValues.size > 0 && !otherValues.has(input.value);
    const reset = others.map((candidate) =>
      conflictReopens && candidate.changeId === input.changeId && candidate.field === input.field
        ? { ...candidate, resolution: undefined, resolvedBy: undefined, resolvedAt: undefined }
        : candidate,
    );

    return { ...contract, candidates: [...reset, nextCandidate] };
  });
}

/**
 * 解决同字段冲突：保留指定候选，其余候选标记 discarded。
 * 冲突一旦因新提交重新出现（submitCandidate 会重置标记），需要再次选择。
 */
export async function resolveConflict(input: {
  contractId: string;
  changeId: string;
  field: MergeableField;
  keepCandidateId: string;
  resolvedBy: string;
}): Promise<ApiContract> {
  return commit(input.contractId, (contract) => {
    const now = new Date().toISOString();
    return {
      ...contract,
      candidates: contract.candidates.map((candidate) => {
        if (candidate.changeId !== input.changeId || candidate.field !== input.field) {
          return candidate;
        }
        if (candidate.id === input.keepCandidateId) {
          return { ...candidate, resolution: 'kept', resolvedBy: input.resolvedBy, resolvedAt: now };
        }
        return { ...candidate, resolution: 'discarded', resolvedBy: input.resolvedBy, resolvedAt: now };
      }),
    };
  });
}

/** 窗口同步到最新基线：更新其候选携带的基线标识，基线过期阻断即解除。 */
export async function syncWindowBaseline(
  contractId: string,
  windowId: string,
): Promise<ApiContract> {
  return commit(contractId, (contract) => ({
    ...contract,
    candidates: contract.candidates.map((candidate) =>
      candidate.windowId === windowId
        ? {
            ...candidate,
            baselineId: contract.baselineId,
            baselineLabel: contract.baselineLabel,
          }
        : candidate,
    ),
  }));
}

/** 直接写入评审结论（评审队列/单条评审），作为一个系统窗口候选进入合并。 */
async function applyReview(input: {
  contractId: string;
  changeId: string;
  reviewState: ReviewState;
  reviewer: string;
  comment: string;
}): Promise<ApiContract> {
  const contracts = await listContracts();
  const contract = contracts.find((item) => item.id === input.contractId);
  if (!contract) throw new Error('契约不存在');
  const now = new Date().toISOString();
  const windowId = 'review-console';
  const windowLabel = '评审台';
  const author = input.reviewer;
  const basePatch: Omit<CandidateInput, 'field' | 'value'> = {
    contractId: input.contractId,
    changeId: input.changeId,
    windowId,
    windowLabel,
    author,
  };
  const entries: Array<{ field: MergeableField; value: string }> = [
    { field: 'reviewState', value: input.reviewState },
    { field: 'reviewer', value: input.reviewer },
    { field: 'reviewComment', value: input.comment },
  ];
  let next = contract;
  for (const entry of entries) {
    next = applyCandidateInline(next, { ...basePatch, ...entry }, now);
  }
  const status: ContractStatus = next.status === 'draft' ? 'review' : next.status;
  next = { ...next, status };
  persistContracts(contracts.map((item) => (item.id === input.contractId ? touch(next) : item)));
  await wait();
  return clone(next);
}

/** 不经过异步往返地在内存契约上叠加候选，供评审类批量操作复用。 */
function applyCandidateInline(
  contract: ApiContract,
  input: Omit<CandidateInput, 'contractId'> & { contractId?: string },
  now: string,
): ApiContract {
  const change = contract.changes.find((item) => item.id === input.changeId);
  if (!change) return contract;
  const existing = contract.candidates.find(
    (candidate) =>
      candidate.changeId === input.changeId &&
      candidate.field === input.field &&
      candidate.windowId === input.windowId,
  );
  if (input.value === String(change[input.field] ?? '')) {
    return {
      ...contract,
      candidates: contract.candidates.filter((candidate) => candidate.id !== existing?.id),
    };
  }
  const candidate: ChangeCandidate = {
    id: existing?.id ?? `cand-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    contractId: contract.id,
    changeId: input.changeId,
    field: input.field,
    baselineId: contract.baselineId,
    baselineLabel: contract.baselineLabel,
    baselineValue: String(change[input.field] ?? ''),
    value: input.value,
    windowId: input.windowId,
    windowLabel: input.windowLabel,
    author: input.author,
    submittedAt: existing?.submittedAt ?? now,
  };
  const otherCandidates = contract.candidates.filter(
    (candidateItem) => candidateItem.id !== existing?.id,
  );
  const otherValues = new Set(
    otherCandidates
      .filter(
        (candidateItem) =>
          candidateItem.changeId === input.changeId &&
          candidateItem.field === input.field &&
          candidateItem.value !== String(change[input.field] ?? ''),
      )
      .map((candidateItem) => candidateItem.value),
  );
  const conflictReopens = otherValues.size > 0 && !otherValues.has(input.value);
  const others = otherCandidates.map((candidateItem) =>
    conflictReopens &&
    candidateItem.changeId === input.changeId &&
    candidateItem.field === input.field
      ? {
          ...candidateItem,
          resolution: undefined,
          resolvedBy: undefined,
          resolvedAt: undefined,
        }
      : candidateItem,
  );
  return { ...contract, candidates: [...others, candidate] };
}

export async function reviewChange(
  contractId: string,
  changeId: string,
  reviewState: ReviewState,
  reviewer: string,
  comment: string,
): Promise<ApiContract> {
  return applyReview({ contractId, changeId, reviewState, reviewer, comment });
}

export async function bulkReviewChanges(
  selections: Array<{ contractId: string; changeId: string }>,
  reviewState: ReviewState,
  reviewer: string,
  comment: string,
): Promise<ApiContract[]> {
  const contracts = await listContracts();
  const now = new Date().toISOString();
  const selected = new Set(selections.map((item) => `${item.contractId}:${item.changeId}`));
  const updated = contracts.map((contract) => {
    let next = contract;
    let touchedFlag = false;
    for (const change of contract.changes) {
      if (!selected.has(`${contract.id}:${change.id}`)) continue;
      touchedFlag = true;
      const basePatch = {
        contractId: contract.id,
        changeId: change.id,
        windowId: 'review-console',
        windowLabel: '评审台',
        author: reviewer,
      };
      next = applyCandidateInline(
        next,
        { ...basePatch, field: 'reviewState', value: reviewState },
        now,
      );
      next = applyCandidateInline(
        next,
        { ...basePatch, field: 'reviewer', value: reviewer },
        now,
      );
      next = applyCandidateInline(
        next,
        { ...basePatch, field: 'reviewComment', value: comment },
        now,
      );
    }
    if (!touchedFlag) return contract;
    return touch({
      ...next,
      status: next.status === 'draft' ? 'review' : next.status,
    });
  });
  persistContracts(updated);
  await wait();
  return clone(updated);
}

export async function updateContractOpenApi(
  contractId: string,
  openapi: string,
): Promise<ApiContract> {
  return commit(contractId, (contract) => ({ ...contract, openapi }));
}

export async function addExemption(
  contractId: string,
  changeId: string,
  reason: string,
): Promise<ApiContract> {
  const contracts = await listContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  const now = new Date().toISOString();
  const exemption: Exemption = {
    id: `ex-${Date.now()}`,
    changeId,
    scope: contract.changes.find((item) => item.id === changeId)?.path ?? '未指定',
    reason,
    approvedBy: '当前评审人',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  };
  let next = applyCandidateInline(
    contract,
    {
      contractId,
      changeId,
      field: 'reviewState',
      value: 'exemption',
      windowId: 'review-console',
      windowLabel: '评审台',
      author: '当前评审人',
    },
    now,
  );
  next = { ...next, exemptions: [...next.exemptions, exemption] };
  persistContracts(contracts.map((item) => (item.id === contractId ? touch(next) : item)));
  await wait();
  return clone(next);
}

/** 汇总一次发布覆盖到的调用方影响。 */
function buildConsumerImpacts(
  contract: ApiContract,
  includedChanges: ContractChange[],
): SnapshotConsumerImpact[] {
  const riskyChangeIds = new Set(
    includedChanges
      .filter((change) => change.compatibility !== 'compatible')
      .map((change) => change.id),
  );
  return contract.consumers.map((consumer) => {
    const affectedChangeIds = [...riskyChangeIds];
    return {
      consumerId: consumer.id,
      name: consumer.name,
      owner: consumer.owner,
      environment: consumer.environment,
      clientVersion: consumer.clientVersion,
      requestsPerDay: consumer.requestsPerDay,
      affectedChangeIds,
      summary: `${consumer.name}（${consumer.environment} · v${consumer.clientVersion}）需关注 ${affectedChangeIds.length} 项警告/不兼容变化，日均约 ${consumer.requestsPerDay.toLocaleString('zh-CN')} 次调用。`,
    };
  });
}

/**
 * 发布：只收集已接受且说明齐全的变化，门禁不过直接拒绝。
 * 生成独立快照，把合并结果固化为新基线，并清空已发布变化的候选。
 */
export async function freezeVersion(
  contractId: string,
  version: string,
  notes: string,
): Promise<ApiContract> {
  const contracts = await listContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }

  const blockers = validateForRelease(contract).filter((issue) => issue.severity === 'blocker');
  if (blockers.length) {
    throw new Error(blockers[0]?.detail ?? '发布门禁未通过');
  }

  const included = contract.changes
    .map((change) => getMergedChange(contract, change.id))
    .filter((change) => isChangeReleaseReady(contract, change).ready);

  if (!included.length) {
    throw new Error('没有已接受且说明齐全的变化可发布');
  }

  const releasedAt = new Date().toISOString();
  const previousSnapshotId = contract.snapshots[0]?.id;
  const openapi = contract.openapi;
  const snapshotId = `ver-${Date.now()}`;

  const includedIds = new Set(included.map((change) => change.id));
  const mergedById = new Map(included.map((change) => [change.id, change]));
  // 发布前一刻这些变化在旧基线上的取值（结构 + 说明），供精确回滚
  const beforeRelease = contract.changes.filter((change) => includedIds.has(change.id));

  const report = buildSnapshotReport(contract, {
    version,
    releasedAt,
    notes,
    changes: included,
    consumerImpacts: buildConsumerImpacts(contract, included),
  });

  const snapshot: ReleaseSnapshot = {
    id: snapshotId,
    contractId,
    version,
    releasedAt,
    baselineId: contract.baselineId,
    baselineLabel: contract.baselineLabel,
    previousSnapshotId,
    checksum: stableChecksum(openapi),
    openapi,
    notes,
    changeIds: included.map((change) => change.id),
    changes: included,
    changesBeforeRelease: beforeRelease,
    consumerImpacts: buildConsumerImpacts(contract, included),
    report,
  };

  const next: ApiContract = {
    ...contract,
    version,
    status: 'frozen',
    snapshots: [snapshot, ...contract.snapshots],
    // 把已发布变化的合并结果固化为新基线；未纳入发布的变化维持原基线取值
    changes: contract.changes.map((change) => mergedById.get(change.id) ?? change),
    baselineId: snapshotId,
    baselineLabel: `v${version}`,
    baselineUpdatedAt: releasedAt,
    // 已发布变化的候选随快照归档；未纳入发布的变化候选保留继续编辑
    candidates: contract.candidates.filter((candidate) => !includedIds.has(candidate.changeId)),
  };

  persistContracts(contracts.map((item) => (item.id === contractId ? touch(next) : item)));
  await wait();
  return clone(next);
}

/**
 * 回滚指定快照（仅允许回滚最新一版）。
 * 只恢复该快照纳入的变化：用发布前一刻的取值覆盖当前基线对应字段；
 * 未随本版发布的变化、其它快照与归档报告都不受影响、仍可查。
 */
export async function rollbackSnapshot(input: {
  contractId: string;
  snapshotId: string;
  reason: string;
  operator: string;
}): Promise<ApiContract> {
  const contracts = await listContracts();
  const contract = contracts.find((item) => item.id === input.contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  const latest = contract.snapshots[0];
  if (!latest || latest.id !== input.snapshotId) {
    throw new Error('只能回滚最新一次发布；更早版本保留为只读归档。');
  }
  if (latest.rollbackState) {
    throw new Error('该快照已经回滚。');
  }

  const beforeById = new Map(latest.changesBeforeRelease.map((change) => [change.id, change]));
  // 仅恢复本版纳入的变化到发布前状态，其余变化原样保留
  const restoredChanges = contract.changes.map((change) => beforeById.get(change.id) ?? change);

  const now = new Date().toISOString();
  const snapshots = contract.snapshots.map((snapshot) =>
    snapshot.id === input.snapshotId
      ? {
          ...snapshot,
          rollbackState: {
            rolledBackAt: now,
            rolledBackBy: input.operator,
            reason: input.reason,
          },
        }
      : snapshot,
  );

  const previous = snapshots.find((snapshot) => snapshot.id === latest.previousSnapshotId);
  const next: ApiContract = {
    ...contract,
    changes: restoredChanges,
    snapshots,
    // 基线恢复到发布前一刻：优先用快照记录的基线；若是首个发布则回到其发布前基线
    baselineId: previous?.id ?? latest.baselineId,
    baselineLabel: previous ? `v${previous.version}` : latest.baselineLabel,
    baselineUpdatedAt: now,
    status: 'review',
  };

  persistContracts(contracts.map((item) => (item.id === input.contractId ? touch(next) : item)));
  await wait();
  return clone(next);
}

function buildSnapshotReport(
  contract: ApiContract,
  snapshot: {
    version: string;
    releasedAt: string;
    notes: string;
    changes: ContractChange[];
    consumerImpacts: SnapshotConsumerImpact[];
  },
): string {
  const lines = [
    `# ${contract.name} v${snapshot.version} 发布变更报告（归档）`,
    '',
    `- 领域：${contract.domain}`,
    `- 负责人：${contract.owner}`,
    `- 发布时间：${snapshot.releasedAt}`,
    `- 发布说明：${snapshot.notes}`,
    '',
    '## 本次发布变化',
    ...snapshot.changes.flatMap((change) => [
      `### ${change.method} ${change.path} - ${change.kind}`,
      `- 兼容性：${change.compatibility}`,
      `- 变更前：${change.before}`,
      `- 变更后：${change.after}`,
      `- 调用方影响：${change.impactStatement || '未填写'}`,
      `- 迁移方案：${change.migrationPlan || '未填写'}`,
      `- 评审结论：${change.reviewState}（${change.reviewer || '未署名'}）`,
      '',
    ]),
    '## 调用方影响',
    ...snapshot.consumerImpacts.map((impact) => `- ${impact.summary}`),
    '',
    '## 兼容层豁免',
    ...(contract.exemptions.length
      ? contract.exemptions.map(
          (item) => `- ${item.scope}：${item.reason}（至 ${item.expiresAt}）`,
        )
      : ['- 无']),
  ];
  return lines.join('\n');
}

export function buildChangeReport(contract: ApiContract): string {
  const lines = [
    `# ${contract.name} ${contract.version} 契约变更报告（工作区）`,
    '',
    `- 领域：${contract.domain}`,
    `- 负责人：${contract.owner}`,
    `- 当前基线：${contract.baselineLabel}`,
    `- 生成时间：${new Date().toISOString()}`,
    '',
    '## 变更明细（合并候选后）',
    ...contract.changes.flatMap((baseChange) => {
      const change = getMergedChange(contract, baseChange.id);
      return [
        `### ${change.method} ${change.path} - ${change.kind}`,
        `- 兼容性：${change.compatibility}`,
        `- 变更前：${change.before}`,
        `- 变更后：${change.after}`,
        `- 判定依据：${change.rationale}`,
        `- 调用方影响：${change.impactStatement || '未填写'}`,
        `- 迁移方案：${change.migrationPlan || '未填写'}`,
        `- 评审结论：${change.reviewState}（${change.reviewer || '未署名'}）`,
        '',
      ];
    }),
    '## 调用方',
    ...contract.consumers.map(
      (consumer) =>
        `- ${consumer.name} / ${consumer.owner} / ${consumer.environment} / ${consumer.clientVersion}`,
    ),
    '',
    '## 豁免记录',
    ...(contract.exemptions.length
      ? contract.exemptions.map(
          (item) => `- ${item.scope}：${item.reason}（至 ${item.expiresAt}）`,
        )
      : ['- 无']),
  ];
  return lines.join('\n');
}

export function generateExampleRequest(contract: ApiContract, change?: ContractChange): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contract.openapi);
  } catch {
    parsed = null;
  }
  const openapi = parsed as
    | {
        paths?: Record<string, Record<string, { summary?: string }>>;
      }
    | null;
  const candidates = openapi?.paths ? Object.entries(openapi.paths) : [];
  const selectedPath = change?.path ?? candidates[0]?.[0] ?? '/resource';
  const selectedMethod = (
    change?.method ??
    (candidates[0]?.[1] ? Object.keys(candidates[0][1])[0] : 'get')
  ).toUpperCase();
  const fields = change
    ? [change.after.replace(/^新增|移除|变为/g, '').trim()]
    : ['orderId: ORD-20260929-001', 'requestId: req-local-demo'];

  return JSON.stringify(
    {
      method: selectedMethod,
      url: `https://api.example.com${selectedPath.replace('{orderId}', 'ORD-20260929-001').replace('{paymentId}', 'PAY-90218').replace('{userId}', 'U-1024')}`,
      headers: {
        Authorization: 'Bearer <token>',
        'X-Client-Version': contract.version,
      },
      body:
        selectedMethod === 'GET'
          ? undefined
          : Object.fromEntries(
              fields.map((field) => {
                const [key, value] = field.split(':').map((item) => item.trim());
                return [key || 'field', value || 'value'];
              }),
            ),
    },
    null,
    2,
  );
}

export function diffVersionSummary(contract: ApiContract): string {
  const previous = contract.snapshots[0];
  if (!previous) {
    return '无可比较的历史发布快照。';
  }
  return [
    `上一版 ${previous.version}`,
    `发布于 ${formatDateTime(previous.releasedAt)}`,
    `校验值 ${previous.checksum}`,
    `本版纳入 ${previous.changes.length} 项变化`,
  ].join('\n');
}

/** 供页面/查询层读取某个调用方在当前工作区的受影响情况（合并候选视角）。 */
export function getCurrentConsumerImpacts(contract: ApiContract): SnapshotConsumerImpact[] {
  return buildConsumerImpacts(
    contract,
    contract.changes.map((change) => getMergedChange(contract, change.id)),
  );
}

export function getConflicts(contract: ApiContract) {
  return collectConflicts(contract);
}

export type { ApiConsumer };

function persistContracts(contracts: ApiContract[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contracts));
}
