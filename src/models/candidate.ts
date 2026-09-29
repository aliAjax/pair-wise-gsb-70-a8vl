import type { ContractChange } from './contract';

export type MergeableField = 'impactStatement' | 'migrationPlan';

export const MERGEABLE_FIELDS: MergeableField[] = ['impactStatement', 'migrationPlan'];

export const FIELD_LABELS: Record<MergeableField, string> = {
  impactStatement: '调用方影响说明',
  migrationPlan: '迁移方案',
};

export type CandidateStatus = 'open' | 'conflict' | 'merged' | 'discarded';

export interface CandidateFieldEdit {
  changeId: string;
  field: MergeableField;
  /** 窗口开始编辑时该字段在基线快照中的值 */
  base: string;
  /** 窗口内本地草稿值 */
  value: string;
  /**
   * - clean：基线未变化，直接采用
   * - auto_merged：对方先改了另一字段或本字段的不同部分，服务端自动合并
   * - conflict：同一字段被双方改成不同内容，保留两边的值待人工选择
   */
  resolution: 'clean' | 'auto_merged' | 'conflict';
  /** 自动合并后的结果（conflict 时为空，由 resolveConflict 决定） */
  mergedValue?: string;
  /** 冲突时已提交一侧的值（对方） */
  committedValue?: string;
  /** 已提交一侧的来源描述 */
  committedSource?: string;
  resolvedAt?: string;
  resolvedChoice?: 'mine' | 'theirs' | 'combined';
}

export interface CandidateOpenApiEdit {
  /** 窗口开始编辑时基线中的 OpenAPI */
  base: string;
  value: string;
  resolution: 'clean' | 'auto_merged' | 'conflict';
  mergedValue?: string;
  committedValue?: string;
  committedSource?: string;
  resolvedAt?: string;
  resolvedChoice?: 'mine' | 'theirs' | 'combined';
}

export interface Candidate {
  id: string;
  contractId: string;
  windowId: string;
  windowLabel: string;
  author: string;
  createdAt: string;
  submittedAt?: string;
  /** 候选发起时锁定的基线标识，提交时若已推进则按三方合并处理 */
  baselineId: string;
  status: CandidateStatus;
  fieldEdits: CandidateFieldEdit[];
  openApiEdit?: CandidateOpenApiEdit;
  /** 候选创建/变基时锁定的字段基线值，用于跨提交三方合并 */
  baseFields: Record<string, string>;
  /** 候选创建/变基时锁定的 OpenAPI 基线值 */
  baseOpenApi: string;
  /** 每次提交的时间线，便于两个窗口追溯自动合并与冲突 */
  history: CandidateHistoryEntry[];
}

export interface CandidateHistoryEntry {
  at: string;
  message: string;
  tone: 'info' | 'merge' | 'conflict' | 'success' | 'discard';
}

export interface CandidateCommitResult {
  candidate: Candidate;
  /** 应用到已提交副本的字段编辑（含自动合并与已解决冲突） */
  appliedFieldEdits: CandidateFieldEdit[];
  appliedOpenApi: boolean;
  /** 是否有任何编辑真正改变了已提交副本，决定基线是否推进 */
  changed: boolean;
  conflicts: number;
  autoMerged: number;
}

interface CommitTarget {
  baselineId: string;
  openapi: string;
  changes: Pick<ContractChange, 'id' | 'impactStatement' | 'migrationPlan'>[];
  fieldSources: Record<string, { source: string; candidateId: string; at: string }>;
}

/**
 * 两个文本版本的字段级合并：
 * - 我没改：采用已提交值（对方的补充自动保留）
 * - 只有我改：采用我的值
 * - 双方都改且内容相同：直接采用
 * - 双方都改成不同内容：判为冲突，保留两边的值与来源
 */
export function mergeFieldValue(input: {
  base: string;
  mine: string;
  theirs: string;
}): { resolution: 'clean' | 'auto_merged' | 'conflict'; value?: string } {
  if (input.mine === input.base) {
    return { resolution: 'clean', value: input.theirs };
  }
  if (input.theirs === input.base || input.theirs === input.mine) {
    return { resolution: 'clean', value: input.mine };
  }
  return { resolution: 'conflict' };
}

/**
 * 提交候选：对每个字段编辑做三方合并。
 * 不同字段的补充互不影响并自动合并；同字段冲突时候选保留两边的值，状态转为 conflict。
 */
export function commitCandidate(candidate: Candidate, target: CommitTarget): CandidateCommitResult {
  const now = new Date().toISOString();
  const submittedAt = candidate.submittedAt ?? now;
  let conflicts = 0;
  let autoMerged = 0;
  let changed = false;
  const appliedFieldEdits: CandidateFieldEdit[] = [];

  const nextEdits: CandidateFieldEdit[] = candidate.fieldEdits.map((edit): CandidateFieldEdit => {
    // 已通过冲突解决流程写回的编辑不再重新参与合并，避免用户选择被再次覆盖
    if (edit.resolution === 'auto_merged' && edit.resolvedAt) {
      return edit;
    }
    if (edit.resolution !== 'clean' && edit.resolution !== 'auto_merged' && edit.resolution !== 'conflict') {
      return edit;
    }
    const change = target.changes.find((item) => item.id === edit.changeId);
    const theirs = change ? change[edit.field] : edit.base;
    const { resolution, value } = mergeFieldValue({
      base: edit.base,
      mine: edit.value,
      theirs,
    });

    if (resolution === 'conflict') {
      conflicts += 1;
      const next: CandidateFieldEdit = {
        ...edit,
        resolution: 'conflict',
        committedValue: theirs,
        committedSource:
          target.fieldSources[`${edit.changeId}.${edit.field}`]?.source ?? '其他评审窗口',
      };
      return next;
    }

    // 基线推进后对方已先改该字段、而本窗口没动：自动保留对方的补充
    const stale = candidate.baselineId !== target.baselineId;
    const auto = stale && theirs !== edit.base && edit.value === edit.base;
    if (auto) autoMerged += 1;

    const finalValue = value ?? edit.value;
    if (finalValue !== theirs) changed = true;
    if (finalValue !== theirs) {
      appliedFieldEdits.push({
        ...edit,
        resolution: auto ? 'auto_merged' : 'clean',
        mergedValue: finalValue,
      });
    }

    return {
      ...edit,
      resolution: auto ? 'auto_merged' : 'clean',
      mergedValue: finalValue,
    };
  });

  let nextOpenApi = candidate.openApiEdit;
  let appliedOpenApi = false;
  const openApiResolved = !!candidate.openApiEdit?.resolvedAt;
  if (
    candidate.openApiEdit &&
    !openApiResolved &&
    candidate.openApiEdit.value !== candidate.openApiEdit.base
  ) {
    const { resolution, value } = mergeFieldValue({
      base: candidate.openApiEdit.base,
      mine: candidate.openApiEdit.value,
      theirs: target.openapi,
    });
    if (resolution === 'conflict') {
      conflicts += 1;
      nextOpenApi = {
        ...candidate.openApiEdit,
        resolution: 'conflict',
        committedValue: target.openapi,
        committedSource: '其他评审窗口',
      };
    } else {
      const finalValue = value ?? candidate.openApiEdit.value;
      appliedOpenApi = finalValue !== target.openapi;
      if (appliedOpenApi) changed = true;
      nextOpenApi = {
        ...candidate.openApiEdit,
        resolution: 'clean',
        mergedValue: finalValue,
      };
    }
  } else if (candidate.openApiEdit) {
    nextOpenApi = { ...candidate.openApiEdit, resolution: 'clean', mergedValue: target.openapi };
  }

  const history = [...candidate.history];
  if (autoMerged || appliedFieldEdits.some((edit) => edit.resolution === 'auto_merged')) {
    history.push({
      at: now,
      tone: 'merge',
      message: `提交时自动合并了 ${autoMerged} 个字段的补充，未覆盖其他窗口的内容。`,
    });
  }
  if (conflicts) {
    history.push({
      at: now,
      tone: 'conflict',
      message: `检测到 ${conflicts} 处同一字段冲突，已保留双方的值与来源，等待人工选择。`,
    });
  }
  if (!conflicts && (appliedFieldEdits.length > 0 || appliedOpenApi)) {
    history.push({
      at: now,
      tone: 'success',
      message: `候选已基于基线 ${target.baselineId.slice(0, 8)} 合并提交。`,
    });
  }

  const status: Candidate['status'] = conflicts > 0 ? 'conflict' : 'merged';
  const nextCandidate: Candidate = {
    ...candidate,
    submittedAt,
    status,
    fieldEdits: nextEdits,
    openApiEdit: nextOpenApi,
    history,
  };

  return {
    candidate: nextCandidate,
    appliedFieldEdits,
    appliedOpenApi,
    changed,
    conflicts,
    autoMerged,
  };
}

/** 人工解决单个字段冲突，返回可重新应用的编辑 */
export function resolveFieldConflict(input: {
  candidate: Candidate;
  changeId: string;
  field: MergeableField;
  choice: 'mine' | 'theirs' | 'combined';
  combinedValue?: string;
}): Candidate {
  const now = new Date().toISOString();
  const fieldEdits: CandidateFieldEdit[] = input.candidate.fieldEdits.map((edit) => {
    if (edit.changeId !== input.changeId || edit.field !== input.field || edit.resolution !== 'conflict') {
      return edit;
    }
    const mergedValue =
      input.choice === 'mine'
        ? edit.value
        : input.choice === 'theirs'
          ? (edit.committedValue ?? edit.base)
          : (input.combinedValue ?? `${edit.value}\n\n${edit.committedValue ?? ''}`.trim());
    return {
      ...edit,
      resolution: 'auto_merged' as const,
      mergedValue,
      resolvedAt: now,
      resolvedChoice: input.choice,
    };
  });

  const openApi = resolveOpenApiConflictIf(input.candidate.openApiEdit, input, now);
  const remainingConflicts =
    fieldEdits.filter((edit) => edit.resolution === 'conflict').length +
    (openApi?.resolution === 'conflict' ? 1 : 0);

  return {
    ...input.candidate,
    fieldEdits,
    openApiEdit: openApi,
    status: remainingConflicts ? 'conflict' : 'merged',
    history: [
      ...input.candidate.history,
      {
        at: now,
        tone: 'success',
        message:
          input.changeId === '__openapi__'
            ? 'OpenAPI 定义冲突已按人工选择解决。'
            : `${FIELD_LABELS[input.field]} 冲突已按人工选择解决（${
                input.choice === 'mine' ? '采用本窗口' : input.choice === 'theirs' ? '采用对方' : '合并双方'
              }）。`,
      },
    ],
  };
}

function resolveOpenApiConflictIf(
  edit: CandidateOpenApiEdit | undefined,
  input: {
    changeId: string;
    choice: 'mine' | 'theirs' | 'combined';
    combinedValue?: string;
  },
  now: string,
): CandidateOpenApiEdit | undefined {
  if (!edit || input.changeId !== '__openapi__' || edit.resolution !== 'conflict') {
    return edit;
  }
  const mergedValue =
    input.choice === 'mine'
      ? edit.value
      : input.choice === 'theirs'
        ? (edit.committedValue ?? edit.base)
        : (input.combinedValue ?? `${edit.value}\n\n${edit.committedValue ?? ''}`.trim());
  return {
    ...edit,
    resolution: 'auto_merged',
    mergedValue,
    resolvedAt: now,
    resolvedChoice: input.choice,
  };
}
