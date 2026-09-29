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

export interface FieldProvenance {
  source: string;
  candidateId: string;
  at: string;
}

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
  impactProvenance?: FieldProvenance;
  migrationProvenance?: FieldProvenance;
  reviewState: ReviewState;
  reviewer: string;
  reviewComment: string;
  reviewedAt?: string;
  /** 已随哪个发布快照冻结；非空时不再进入后续发布，回滚该快照会清空 */
  releasedInVersionId?: string;
  releasedInVersion?: string;
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

export type ReleaseStatus = 'active' | 'rolled_back';

export interface ReleaseConsumerImpact {
  consumerId: string;
  name: string;
  environment: ApiConsumer['environment'];
  clientVersion: string;
  requestsPerDay: number;
  impactSummary: string;
}

export interface ContractVersion {
  id: string;
  contractId: string;
  version: string;
  releasedAt: string;
  checksum: string;
  notes: string;
  changeIds: string[];
  openapi: string;
  /** 发布时所基于的基线标识，过期基线不允许冻结 */
  baselineId: string;
  /** 发布后该快照内变化的调用方影响摘要，回滚时仅恢复本快照范围 */
  consumerImpacts: ReleaseConsumerImpact[];
  /** 发布时已接受变化的完整副本，旧版本回滚不影响其他已发布快照 */
  changes: ContractChange[];
  status: ReleaseStatus;
  rolledBackAt?: string;
  rollbackReason?: string;
  /** 每次发布独立生成的 Markdown 报告，快照回滚后仍可查阅 */
  report: string;
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
  versions: ContractVersion[];
  /** 已提交工作副本的乐观锁基线标识，任何合并/发布/评审都会推进 */
  baselineId: string;
}

export type ReleaseIssueKind =
  | 'stale_baseline'
  | 'conflict'
  | 'open_candidate'
  | 'missing_explanation'
  | 'no_accepted_change'
  | 'breaking_without_exemption'
  | 'excluded_change';

export interface ReleaseIssue {
  id: string;
  severity: 'blocker' | 'warning';
  kind: ReleaseIssueKind;
  title: string;
  detail: string;
  changeId?: string;
  candidateId?: string;
}

export interface ReleaseChangeInfo {
  change: ContractChange;
  included: boolean;
  reason?: string;
}

export interface ReleaseEvaluation {
  issues: ReleaseIssue[];
  /** 本次发布会收集的变化：已接受（含兼容层豁免）且说明齐全 */
  includedChanges: ContractChange[];
  changeInfos: ReleaseChangeInfo[];
  canRelease: boolean;
}

export const RELEASABLE_REVIEW_STATES: ReviewState[] = ['accepted', 'exemption'];

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

function explanationComplete(change: ContractChange): boolean {
  if (change.compatibility === 'compatible') {
    return true;
  }
  return Boolean(change.impactStatement.trim() && change.migrationPlan.trim());
}

export function isReleasableChange(change: ContractChange): boolean {
  return (
    !change.releasedInVersionId &&
    RELEASABLE_REVIEW_STATES.includes(change.reviewState) &&
    explanationComplete(change)
  );
}

/**
 * 发布门禁评估。发布不再整份冻结：只收集已接受（含豁免）且说明齐全的变化，
 * 基线过期、存在未解决字段冲突或仍开放在当前基线上的候选都会被挡住。
 */
export function evaluateRelease(input: {
  contract: ApiContract;
  /** 发起发布窗口所基于的基线标识，与 contract.baselineId 不一致即过期 */
  baselineId: string;
  activeCandidates: Array<{
    id: string;
    windowId: string;
    baselineId: string;
    status: string;
  }>;
}): ReleaseEvaluation {
  const { contract, baselineId, activeCandidates } = input;
  const issues: ReleaseIssue[] = [];
  const includedChanges: ContractChange[] = [];
  const changeInfos: ReleaseChangeInfo[] = [];

  if (baselineId !== contract.baselineId) {
    issues.push({
      id: 'stale-baseline',
      severity: 'blocker',
      kind: 'stale_baseline',
      title: '发布基线已过期',
      detail: `当前窗口基于基线 ${baselineId.slice(0, 8)}，最新基线为 ${contract.baselineId.slice(0, 8)}，请刷新到最新基线后再发布。`,
    });
  }

  activeCandidates.forEach((candidate) => {
    if (candidate.status === 'conflict') {
      issues.push({
        id: `conflict-${candidate.id}`,
        severity: 'blocker',
        kind: 'conflict',
        candidateId: candidate.id,
        title: '存在未解决的字段冲突',
        detail: `窗口 ${candidate.windowId} 的候选 ${candidate.id.slice(0, 8)} 仍有同字段冲突待人工选择。`,
      });
    } else if (candidate.baselineId !== contract.baselineId) {
      issues.push({
        id: `stale-candidate-${candidate.id}`,
        severity: 'blocker',
        kind: 'stale_baseline',
        candidateId: candidate.id,
        title: '候选基于过期基线',
        detail: `窗口 ${candidate.windowId} 的候选尚未合并或变基，发布后其修改可能被遗漏，请先处理。`,
      });
    } else {
      issues.push({
        id: `open-candidate-${candidate.id}`,
        severity: 'blocker',
        kind: 'open_candidate',
        candidateId: candidate.id,
        title: '仍有未提交的编辑候选',
        detail: `窗口 ${candidate.windowId} 的候选处于开放状态，请提交或丢弃后再发布。`,
      });
    }
  });

  contract.changes.forEach((change) => {
    if (isReleasableChange(change)) {
      includedChanges.push(change);
      changeInfos.push({ change, included: true });
      return;
    }

    let reason = '';
    if (change.releasedInVersionId) {
      reason = `已随 v${change.releasedInVersion ?? '历史版本'} 发布，不重复进入本次快照`;
    } else if (!RELEASABLE_REVIEW_STATES.includes(change.reviewState)) {
      reason = '评审尚未接受，不进入本次发布';
    } else {
      const missing: string[] = [];
      if (change.compatibility !== 'compatible') {
        if (!change.impactStatement.trim()) missing.push('调用方影响说明');
        if (!change.migrationPlan.trim()) missing.push('迁移方案');
      }
      reason = `缺少${missing.join('与')}，不进入本次发布`;
      if (missing.length) {
        issues.push({
          id: `missing-${change.id}`,
          severity: 'blocker',
          kind: 'missing_explanation',
          title: `已接受变化缺少${missing.join('与')}`,
          detail: `${change.method} ${change.path} 已接受但说明不齐全，补齐说明后才能随版本发布。`,
          changeId: change.id,
        });
      }
    }
    changeInfos.push({ change, included: false, reason });
  });

  contract.changes
    .filter(
      (change) =>
        change.compatibility === 'breaking' &&
        change.reviewState === 'accepted' &&
        !contract.exemptions.some((item) => item.changeId === change.id),
    )
    .forEach((change) => {
      issues.push({
        id: `breaking-${change.id}`,
        severity: 'warning',
        kind: 'breaking_without_exemption',
        title: '不兼容变化已接受但未登记豁免',
        detail: `${change.path} 建议记录兼容层的范围、原因和到期时间。`,
        changeId: change.id,
      });
    });

  if (!includedChanges.length) {
    issues.push({
      id: 'no-accepted-change',
      severity: 'blocker',
      kind: 'no_accepted_change',
      title: '没有可发布的变化',
      detail: '本次发布至少需要一项已接受且说明齐全的变化。',
    });
  }

  return {
    issues,
    includedChanges,
    changeInfos,
    canRelease: !issues.some((issue) => issue.severity === 'blocker'),
  };
}
