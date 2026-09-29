export type ContractStatus = 'draft' | 'review' | 'ready' | 'released' | 'frozen';
export type ChangeKind =
  | 'field_added'
  | 'field_removed'
  | 'optionality_changed'
  | 'enum_expanded'
  | 'error_code_added'
  | 'error_code_removed';
export type Compatibility = 'compatible' | 'warning' | 'breaking';
export type ReviewState = 'pending' | 'accepted' | 'returned' | 'exemption';

/**
 * 可以在多个窗口之间做字段级合并的说明类字段。
 * 结构字段（path/method/before/after 等）来自基线，不参与候选合并。
 */
export type MergeableField =
  | 'impactStatement'
  | 'migrationPlan'
  | 'reviewState'
  | 'reviewer'
  | 'reviewComment';

export interface ContractChange {
  id: string;
  path: string;
  method: string;
  kind: ChangeKind;
  before: string;
  after: string;
  compatibility: Compatibility;
  rationale: string;
  impactStatement: string;
  migrationPlan: string;
  reviewState: ReviewState;
  reviewer: string;
  reviewComment: string;
  reviewedAt?: string;
}

export interface ApiConsumer {
  id: string;
  name: string;
  owner: string;
  environment: '生产' | '预发' | '灰度';
  clientVersion: string;
  requestsPerDay: number;
  contact: string;
}

export interface Exemption {
  id: string;
  changeId: string;
  scope: string;
  reason: string;
  approvedBy: string;
  expiresAt: string;
}

/**
 * 一个窗口对某个变化的某个字段提交的候选补充。
 * 每个窗口都从同一条基线开始，提交时携带基线标识。
 */
export interface ChangeCandidate {
  id: string;
  contractId: string;
  changeId: string;
  field: MergeableField;
  /** 该候选基于的基线标识，用于检测基线是否过期。 */
  baselineId: string;
  /** 提交时刻基线的展示名，便于在过期提示里说明来源。 */
  baselineLabel: string;
  /** 提交时该字段在基线上的取值。 */
  baselineValue: string;
  value: string;
  windowId: string;
  windowLabel: string;
  author: string;
  submittedAt: string;
  /** 冲突解决后记录最终被保留的候选；未解决时为空。 */
  resolution?: 'kept' | 'discarded';
  resolvedBy?: string;
  resolvedAt?: string;
}

/** 同字段、多个不同取值时保留双方形成的冲突，等待人工选择。 */
export interface FieldConflict {
  changeId: string;
  field: MergeableField;
  candidateIds: string[];
  baselineValue: string;
}

/** 发布快照里随版本归档的调用方影响。 */
export interface SnapshotConsumerImpact {
  consumerId: string;
  name: string;
  owner: string;
  environment: ApiConsumer['environment'];
  clientVersion: string;
  requestsPerDay: number;
  affectedChangeIds: string[];
  summary: string;
}

/**
 * 每次发布的独立快照。回滚时只恢复这一版包含的变化与调用方影响，
 * 快照本身与归档报告始终保留可查。
 */
export interface ReleaseSnapshot {
  id: string;
  contractId: string;
  version: string;
  releasedAt: string;
  /** 发布所基于的基线标识，同时成为下一阶段的新基线。 */
  baselineId: string;
  /** 发布前基线的展示名，回滚时据此恢复到发布前的基线。 */
  baselineLabel: string;
  /** 上一版快照 id，用于把基线串成链。 */
  previousSnapshotId?: string;
  checksum: string;
  openapi: string;
  notes: string;
  /** 本次发布收集进来的变化 id（已接受且说明齐全）。 */
  changeIds: string[];
  /** 发布时刻这些变化的完整内容快照。 */
  changes: ContractChange[];
  /**
   * 这些变化在发布前一刻的取值。回滚时只恢复本版纳入的变化到该状态，
   * 不触碰未随本版发布的内容。
   */
  changesBeforeRelease: ContractChange[];
  consumerImpacts: SnapshotConsumerImpact[];
  /** 随版归档的 Markdown 报告，旧版本始终可查。 */
  report: string;
  rollbackState?: {
    rolledBackAt: string;
    rolledBackBy: string;
    reason: string;
  };
}

export interface ApiContract {
  id: string;
  name: string;
  version: string;
  domain: string;
  owner: string;
  protocol: 'REST' | 'GraphQL' | 'gRPC-Web';
  status: ContractStatus;
  updatedAt: string;
  openapi: string;
  changes: ContractChange[];
  consumers: ApiConsumer[];
  exemptions: Exemption[];
  /** 字段级编辑候选，跨窗口收集，发布后清空。 */
  candidates: ChangeCandidate[];
  /** 当前基线标识。初始为 seed，每次发布推进到新快照。 */
  baselineId: string;
  baselineLabel: string;
  baselineUpdatedAt: string;
  /** 历次发布的独立快照。 */
  snapshots: ReleaseSnapshot[];
}

export interface ReleaseIssue {
  id: string;
  severity: 'blocker' | 'warning';
  title: string;
  detail: string;
  changeId?: string;
}

/** 提交候选后的合并结果，供界面提示是否产生冲突或基线过期。 */
export interface SubmitCandidateResult {
  contract: ApiContract;
  staleBaseline: boolean;
  conflicts: FieldConflict[];
}

export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  field_added: '新增字段',
  field_removed: '删除字段',
  optionality_changed: '可选性变化',
  enum_expanded: '枚举扩展',
  error_code_added: '新增错误码',
  error_code_removed: '删除错误码',
};

export const COMPATIBILITY_LABELS: Record<Compatibility, string> = {
  compatible: '兼容',
  warning: '警告',
  breaking: '不兼容',
};

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  pending: '待评审',
  accepted: '已接受',
  returned: '已退回',
  exemption: '兼容层豁免',
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: '草稿',
  review: '评审中',
  ready: '待发布',
  released: '已发布',
  frozen: '已冻结',
};

export const MERGEABLE_FIELD_LABELS: Record<MergeableField, string> = {
  impactStatement: '调用方影响说明',
  migrationPlan: '迁移方案',
  reviewState: '评审结论',
  reviewer: '评审人',
  reviewComment: '评审意见',
};

export function classifyChange(input: {
  kind: ChangeKind;
  before: string;
  after: string;
}): { compatibility: Compatibility; rationale: string } {
  switch (input.kind) {
    case 'field_removed':
      return {
        compatibility: 'breaking',
        rationale: '删除字段会使仍读取该字段的客户端解析失败或业务判断缺失。',
      };
    case 'error_code_removed':
      return {
        compatibility: 'breaking',
        rationale: '删除错误码会破坏调用方基于错误码建立的分支与重试策略。',
      };
    case 'field_added':
      if (/required/i.test(input.after) || /必填/.test(input.after)) {
        return {
          compatibility: 'breaking',
          rationale: '新增必填字段要求现有调用方立即修改请求。',
        };
      }
      return {
        compatibility: 'compatible',
        rationale: '新增可选字段不会改变现有请求和响应结构。',
      };
    case 'optionality_changed':
      if (/可选.*必填|optional.*required/i.test(`${input.before} ${input.after}`)) {
        return {
          compatibility: 'breaking',
          rationale: '字段从可选变为必填，现有调用方可能不再满足请求约束。',
        };
      }
      return {
        compatibility: 'warning',
        rationale: '字段从必填变为可选会改变调用方对响应完整性的假设。',
      };
    case 'enum_expanded':
      return {
        compatibility: 'warning',
        rationale: '新增枚举值可能使未实现默认分支的客户端出现解析或展示异常。',
      };
    case 'error_code_added':
      return {
        compatibility: 'warning',
        rationale: '调用方应明确新错误码的展示和重试策略。',
      };
  }
}

/** 合并后字段取值及其来源。 */
export interface MergedFieldValue {
  value: string;
  /** 当前生效取值来自哪个候选；未被候选覆盖时来自基线。 */
  source: 'baseline' | 'candidate';
  candidateId?: string;
  windowLabel?: string;
  author?: string;
}

/**
 * 计算某个变化某个可合并字段的当前合并结果。
 * - 没有候选：取基线（contract.changes 即基线值）
 * - 只有一个有效取值（或多窗口取值一致）：自动合并
 * - 多个不同取值：标记为冲突，调用方应让用户在候选中选择
 */
export function mergeField(
  contract: ApiContract,
  changeId: string,
  field: MergeableField,
): MergedFieldValue & { conflict: FieldConflict | null } {
  const change = contract.changes.find((item) => item.id === changeId);
  const baselineValue = change ? String(change[field] ?? '') : '';

  const active = contract.candidates.filter(
    (candidate) =>
      candidate.changeId === changeId &&
      candidate.field === field &&
      candidate.resolution !== 'discarded',
  );

  // 已解决的冲突：被保留的候选直接生效
  const kept = active.find((candidate) => candidate.resolution === 'kept');
  if (kept) {
    return {
      value: kept.value,
      source: 'candidate',
      candidateId: kept.id,
      windowLabel: kept.windowLabel,
      author: kept.author,
      conflict: null,
    };
  }

  const distinct = new Map<string, ChangeCandidate>();
  for (const candidate of active) {
    if (candidate.value === baselineValue) continue;
    const existing = distinct.get(candidate.value);
    // 不同窗口给出相同取值：自动合并，保留最先提交者作为来源
    if (!existing || existing.submittedAt > candidate.submittedAt) {
      distinct.set(candidate.value, candidate);
    }
  }

  if (distinct.size === 0) {
    return { value: baselineValue, source: 'baseline', conflict: null };
  }
  if (distinct.size === 1) {
    const [candidate] = [...distinct.values()];
    return {
      value: candidate.value,
      source: 'candidate',
      candidateId: candidate.id,
      windowLabel: candidate.windowLabel,
      author: candidate.author,
      conflict: null,
    };
  }

  const conflictCandidates = [...distinct.values()].sort(
    (left, right) => new Date(left.submittedAt).getTime() - new Date(right.submittedAt).getTime(),
  );
  return {
    // 冲突未解决前，生效值仍回退到基线，避免误发布
    value: baselineValue,
    source: 'baseline',
    conflict: {
      changeId,
      field,
      candidateIds: conflictCandidates.map((candidate) => candidate.id),
      baselineValue,
    },
  };
}

/** 聚合契约上所有尚未解决的同字段冲突（含说明字段与评审结论）。 */
export function collectConflicts(contract: ApiContract): FieldConflict[] {
  const conflicts: FieldConflict[] = [];
  const fields: MergeableField[] = [
    'impactStatement',
    'migrationPlan',
    'reviewState',
    'reviewer',
    'reviewComment',
  ];
  for (const change of contract.changes) {
    for (const field of fields) {
      const result = mergeField(contract, change.id, field);
      if (result.conflict) conflicts.push(result.conflict);
    }
  }
  return conflicts;
}

/** 判断某个候选携带的基线是否已经过期（期间发生过发布）。 */
export function isCandidateStale(contract: ApiContract, candidate: ChangeCandidate): boolean {
  return candidate.baselineId !== contract.baselineId;
}

export function hasStaleCandidates(contract: ApiContract): boolean {
  return contract.candidates.some((candidate) => isCandidateStale(contract, candidate));
}

/** 取某个变化合并后的完整视图（基线 + 已自动合并字段）。 */
export function getMergedChange(contract: ApiContract, changeId: string): ContractChange {
  const change = contract.changes.find((item) => item.id === changeId);
  if (!change) {
    throw new Error(`变更 ${changeId} 不存在`);
  }
  const fields: MergeableField[] = [
    'impactStatement',
    'migrationPlan',
    'reviewState',
    'reviewer',
    'reviewComment',
  ];
  const merged = { ...change } as Record<string, string>;
  for (const field of fields) {
    merged[field] = mergeField(contract, changeId, field).value;
  }
  return merged as unknown as ContractChange;
}

/** 判断合并后的变化是否已接受、且按兼容性要求说明齐全，可进入发布。 */
export function isChangeReleaseReady(
  contract: ApiContract,
  change: ContractChange,
): { ready: boolean; missing: string[] } {
  const merged = getMergedChange(contract, change.id);
  const missing: string[] = [];
  if (merged.reviewState !== 'accepted') {
    return { ready: false, missing };
  }
  if (merged.compatibility !== 'compatible') {
    if (!merged.impactStatement.trim()) missing.push('调用方影响说明');
    if (!merged.migrationPlan.trim()) missing.push('迁移方案');
  }
  return { ready: missing.length === 0, missing };
}

/**
 * 发布门禁：
 * - blocker：基线过期仍有候选、存在未解决冲突、已接受变化说明不齐
 * - warning：仍有未进入发布范围（待评审/退回）的变化
 */
export function validateForRelease(contract: ApiContract): ReleaseIssue[] {
  const issues: ReleaseIssue[] = [];
  const conflicts = collectConflicts(contract);

  conflicts.forEach((conflict) => {
    const change = contract.changes.find((item) => item.id === conflict.changeId);
    issues.push({
      id: `conflict-${conflict.changeId}-${conflict.field}`,
      severity: 'blocker',
      title: '同字段存在未解决冲突',
      detail: `${change?.method ?? ''} ${change?.path ?? ''} 的${
        MERGEABLE_FIELD_LABELS[conflict.field]
      }有多个窗口的不同取值，需要人工选择后才能发布。`,
      changeId: conflict.changeId,
    });
  });

  if (hasStaleCandidates(contract)) {
    const stale = contract.candidates.find((candidate) => isCandidateStale(contract, candidate));
    issues.push({
      id: 'stale-baseline',
      severity: 'blocker',
      title: '存在基线过期的候选',
      detail: `有窗口仍基于旧基线「${stale?.baselineLabel ?? stale?.baselineId ?? ''}」编辑，请让这些窗口同步到当前基线「${contract.baselineLabel}」后重新提交。`,
    });
  }

  contract.changes.forEach((change) => {
    const merged = getMergedChange(contract, change.id);
    if (merged.reviewState === 'accepted') {
      const { missing } = isChangeReleaseReady(contract, change);
      missing.forEach((label) => {
        issues.push({
          id: `missing-${label}-${change.id}`,
          severity: 'blocker',
          title: `已接受变化缺少${label}`,
          detail: `${change.method} ${change.path} 已接受，但${label}尚未补齐，不能进入发布。`,
          changeId: change.id,
        });
      });
      if (
        change.compatibility === 'breaking' &&
        !contract.exemptions.some((item) => item.changeId === change.id)
      ) {
        issues.push({
          id: `breaking-${change.id}`,
          severity: 'warning',
          title: '不兼容变更已接受但未登记豁免',
          detail: `${change.path} 建议记录兼容层的范围、原因和到期时间。`,
          changeId: change.id,
        });
      }
    }
  });

  contract.changes
    .filter((change) => {
      const merged = getMergedChange(contract, change.id);
      return merged.reviewState === 'pending' || merged.reviewState === 'returned';
    })
    .forEach((change) => {
      const merged = getMergedChange(contract, change.id);
      issues.push({
        id: `excluded-${change.id}`,
        severity: 'warning',
        title: '变化本次不纳入发布',
        detail: `${change.method} ${change.path} 当前为「${REVIEW_STATE_LABELS[merged.reviewState]}」，将保留在工作区，不进入本次快照。`,
        changeId: change.id,
      });
    });

  return issues;
}
