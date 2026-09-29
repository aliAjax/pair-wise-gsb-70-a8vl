import { seedContracts } from '../data/seed';
import type {
  ApiContract,
  ContractChange,
  ContractVersion,
  FieldProvenance,
  ReviewState,
} from '../models/contract';
import { evaluateRelease, isReleasableChange } from '../models/contract';
import {
  commitCandidate as runCommit,
  MERGEABLE_FIELDS,
  resolveFieldConflict,
  type Candidate,
  type CandidateFieldEdit,
  type CandidateOpenApiEdit,
} from '../models/candidate';
import { stableChecksum, formatDateTime } from '../lib/utils';

const STORAGE_KEY = 'pair-wise-gsb-70-contracts';
const CANDIDATE_STORAGE_KEY = 'pair-wise-gsb-70-candidates';
const LATENCY = 180;

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function wait(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, LATENCY));
}

let baselineCounter = 0;

function nextBaselineId(contractId: string): string {
  baselineCounter += 1;
  return `base-${contractId.replace(/^contract-/, '')}-${Date.now().toString(36)}-${basalSuffix()}`;
}

function basalSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

function normalizeContract(raw: Partial<ApiContract>): ApiContract {
  const fallback = seedContracts.find((item) => item.id === raw.id) ?? seedContracts[0];
  const merged: ApiContract = { ...fallback, ...(raw as ApiContract) };
  if (!merged.baselineId) {
    merged.baselineId = `base-${merged.id.replace(/^contract-/, '')}-legacy-${stableChecksum(merged.openapi).slice(0, 6)}`;
  }
  merged.versions = (merged.versions ?? []).map((version): ContractVersion => ({
    ...version,
    consumerImpacts: version.consumerImpacts ?? [],
    changes: version.changes ?? [],
    status: version.status ?? 'active',
    report: version.report ?? '',
    baselineId: version.baselineId ?? merged.baselineId,
  }));
  return merged;
}

export async function listContracts(): Promise<ApiContract[]> {
  await wait();
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Partial<ApiContract>[];
      return parsed.map(normalizeContract);
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

function persistContracts(contracts: ApiContract[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contracts));
}

function readCandidates(): Candidate[] {
  const stored = localStorage.getItem(CANDIDATE_STORAGE_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored) as Candidate[];
  } catch {
    return [];
  }
}

function writeCandidates(candidates: Candidate[]): void {
  localStorage.setItem(CANDIDATE_STORAGE_KEY, JSON.stringify(candidates));
}

export async function listCandidates(contractId?: string): Promise<Candidate[]> {
  await wait();
  const candidates = readCandidates();
  return clone(
    contractId ? candidates.filter((candidate) => candidate.contractId === contractId) : candidates,
  );
}

function getCandidatesSync(contractId: string): Candidate[] {
  return readCandidates().filter((candidate) => candidate.contractId === contractId);
}

function touchBaseline(contract: ApiContract): ApiContract {
  return { ...contract, baselineId: nextBaselineId(contract.id), updatedAt: new Date().toISOString() };
}

function updateContract(id: string, updater: (contract: ApiContract) => ApiContract): ApiContract {
  const contracts = readContractsSync();
  const index = contracts.findIndex((item) => item.id === id);
  if (index < 0) {
    throw new Error('契约不存在');
  }
  contracts[index] = updater(contracts[index]);
  persistContracts(contracts);
  return contracts[index];
}

/** 直接从 localStorage 读取最新已提交副本，避免 React Query 缓存导致合并基准过期 */
function readContractsSync(): ApiContract[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return (JSON.parse(raw) as Partial<ApiContract>[]).map(normalizeContract);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  return clone(seedContracts);
}

function getContractSync(id: string): ApiContract {
  const contract = readContractsSync().find((item) => item.id === id);
  if (!contract) {
    throw new Error('契约不存在');
  }
  return contract;
}

export async function saveContract(updated: ApiContract): Promise<ApiContract> {
  const saved = touchBaseline({ ...updated, updatedAt: new Date().toISOString() });
  updateContract(updated.id, () => saved);
  await wait();
  return clone(saved);
}

/** 评审结论会推进基线，仍开放在旧基线上的候选提交时进入三方合并 */
async function mutateContract(
  contractId: string,
  mutator: (contract: ApiContract) => ApiContract,
): Promise<ApiContract> {
  const updated = updateContract(contractId, (contract) => touchBaseline(mutator(contract)));
  await wait();
  return clone(updated);
}

export async function reviewChange(
  contractId: string,
  changeId: string,
  reviewState: ReviewState,
  reviewer: string,
  comment: string,
): Promise<ApiContract> {
  return mutateContract(contractId, (contract) => ({
    ...contract,
    status: contract.status === 'draft' ? 'review' : contract.status,
    changes: contract.changes.map((change) =>
      change.id === changeId
        ? {
            ...change,
            reviewState,
            reviewer,
            reviewComment: comment,
            reviewedAt: new Date().toISOString(),
          }
        : change,
    ),
  }));
}

export async function bulkReviewChanges(
  selections: Array<{ contractId: string; changeId: string }>,
  reviewState: ReviewState,
  reviewer: string,
  comment: string,
): Promise<ApiContract[]> {
  const byContract = new Map<string, Set<string>>();
  selections.forEach((item) => {
    const set = byContract.get(item.contractId) ?? new Set<string>();
    set.add(item.changeId);
    byContract.set(item.contractId, set);
  });

  const raw = localStorage.getItem(STORAGE_KEY);
  let contracts: ApiContract[] = raw
    ? (JSON.parse(raw) as Partial<ApiContract>[]).map(normalizeContract)
    : clone(seedContracts);
  const now = new Date().toISOString();
  contracts = contracts.map((contract) => {
    const changeIds = byContract.get(contract.id);
    if (!changeIds) return contract;
    return touchBaseline({
      ...contract,
      changes: contract.changes.map((change) =>
        changeIds.has(change.id)
          ? { ...change, reviewState, reviewer, reviewComment: comment, reviewedAt: now }
          : change,
      ),
    });
  });
  persistContracts(contracts);
  await wait();
  return clone(contracts.filter((contract) => byContract.has(contract.id)));
}

export async function addExemption(
  contractId: string,
  changeId: string,
  reason: string,
): Promise<ApiContract> {
  return mutateContract(contractId, (contract) => {
    const exemption = {
      id: `ex-${Date.now()}`,
      changeId,
      scope: contract.changes.find((item) => item.id === changeId)?.path ?? '未指定',
      reason,
      approvedBy: '当前评审人',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    };
    return {
      ...contract,
      exemptions: [...contract.exemptions, exemption],
      changes: contract.changes.map((change) =>
        change.id === changeId ? { ...change, reviewState: 'exemption' } : change,
      ),
    };
  });
}

/* ------------------------------------------------------------------ */
/* 编辑候选：同一基线起稿，提交时按字段三方合并，同字段冲突保留双方       */
/* ------------------------------------------------------------------ */

export interface StartCandidateInput {
  contractId: string;
  windowId: string;
  windowLabel: string;
  author: string;
}

export async function startCandidate(input: StartCandidateInput): Promise<Candidate> {
  const contract = await getContract(input.contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  // 同一窗口已有开放/冲突候选时直接复用，避免两个入口产生分叉草稿
  const existing = getCandidatesSync(input.contractId).find(
    (candidate) =>
      candidate.windowId === input.windowId &&
      (candidate.status === 'open' || candidate.status === 'conflict'),
  );
  if (existing) {
    return clone(existing);
  }
  const now = new Date().toISOString();
  const baseFields: Record<string, string> = {};
  contract.changes.forEach((change) => {
    MERGEABLE_FIELDS.forEach((field) => {
      baseFields[`${change.id}.${field}`] = change[field];
    });
  });
  const candidate: Candidate = {
    id: `cand-${Date.now()}-${basalSuffix()}`,
    contractId: input.contractId,
    windowId: input.windowId,
    windowLabel: input.windowLabel,
    author: input.author,
    createdAt: now,
    baselineId: contract.baselineId,
    status: 'open',
    fieldEdits: [],
    baseFields,
    baseOpenApi: contract.openapi,
    history: [
      {
        at: now,
        tone: 'info',
        message: `${input.windowLabel} 从基线 ${contract.baselineId.slice(0, 8)} 创建编辑候选。`,
      },
    ],
  };
  const candidates = readCandidates();
  writeCandidates([candidate, ...candidates]);
  await wait();
  return clone(candidate);
}

export async function discardCandidate(candidateId: string): Promise<void> {
  const candidates = readCandidates().map((candidate) =>
    candidate.id === candidateId
      ? {
          ...candidate,
          status: 'discarded' as const,
          history: [
            ...candidate.history,
            {
              at: new Date().toISOString(),
              tone: 'discard' as const,
              message: '候选已丢弃，草稿未进入已提交副本。',
            },
          ],
        }
      : candidate,
  );
  writeCandidates(candidates);
  await wait();
}

/** 变基：把候选的字段基准刷新到当前基线，草稿内容原样保留，提交时重新做三方合并 */
export async function rebaseCandidate(candidateId: string): Promise<Candidate> {
  const candidate = readCandidates().find((item) => item.id === candidateId);
  if (!candidate) {
    throw new Error('候选不存在');
  }
  const contract = (await getContract(candidate.contractId))!;
  const now = new Date().toISOString();
  const baseFields: Record<string, string> = {};
  contract.changes.forEach((change) => {
    MERGEABLE_FIELDS.forEach((field) => {
      baseFields[`${change.id}.${field}`] = change[field];
    });
  });
  const rebased: Candidate = {
    ...candidate,
    id: `cand-${Date.now()}-${basalSuffix()}`,
    baselineId: contract.baselineId,
    status: 'open',
    baseFields,
    baseOpenApi: contract.openapi,
    fieldEdits: candidate.fieldEdits.map((edit) => ({
      ...edit,
      resolution: 'clean',
      mergedValue: undefined,
      committedValue: undefined,
      committedSource: undefined,
      resolvedAt: undefined,
      resolvedChoice: undefined,
    })),
    openApiEdit: candidate.openApiEdit
      ? {
          ...candidate.openApiEdit,
          base: contract.openapi,
          resolution: 'clean',
          mergedValue: undefined,
          committedValue: undefined,
          committedSource: undefined,
        }
      : undefined,
    history: [
      ...candidate.history,
      {
        at: now,
        tone: 'info',
        message: `候选已变基到最新基线 ${contract.baselineId.slice(0, 8)}，本地草稿保留。`,
      },
    ],
  };
  const candidates = readCandidates().map((item) =>
    item.id === candidateId ? { ...item, status: 'discarded' as const } : item,
  );
  writeCandidates([rebased, ...candidates]);
  await wait();
  return clone(rebased);
}

export interface CommitCandidateInput {
  candidateId: string;
  fieldEdits: Array<{
    changeId: string;
    field: CandidateFieldEdit['field'];
    value: string;
  }>;
  openApi?: { value: string };
}

export async function commitCandidateEdits(
  input: CommitCandidateInput,
): Promise<{ contract: ApiContract; candidate: Candidate }> {
  let candidate = readCandidates().find((item) => item.id === input.candidateId);
  if (!candidate) {
    throw new Error('候选不存在');
  }

  const contract = getContractSync(candidate.contractId);
  const now = new Date().toISOString();

  // 用页面提交的草稿重建编辑清单：base 取候选创建/变基时锁定的字段值
  const rebuiltEdits: CandidateFieldEdit[] = input.fieldEdits
    .map((edit): CandidateFieldEdit => ({
      changeId: edit.changeId,
      field: edit.field,
      base: candidate!.baseFields[`${edit.changeId}.${edit.field}`] ?? '',
      value: edit.value,
      resolution: 'clean',
    }))
    .filter((edit) => edit.value !== edit.base);

  // 已经通过冲突解决写回的编辑保持其解决结果，不被本次草稿重建覆盖
  const resolvedEdits = candidate.fieldEdits.filter((edit) => edit.resolvedAt);
  const resolvedKeys = new Set(resolvedEdits.map((edit) => `${edit.changeId}.${edit.field}`));
  const fieldEdits = [
    ...resolvedEdits,
    ...rebuiltEdits.filter((edit) => !resolvedKeys.has(`${edit.changeId}.${edit.field}`)),
  ];

  let openApiEdit: CandidateOpenApiEdit | undefined;
  if (input.openApi && !candidate.openApiEdit?.resolvedAt) {
    openApiEdit = {
      base: candidate.baseOpenApi,
      value: input.openApi.value,
      resolution: 'clean',
    };
  }

  candidate = {
    ...candidate,
    fieldEdits,
    openApiEdit: openApiEdit ?? candidate.openApiEdit,
  };

  const fieldSources: Record<string, FieldProvenance> = {};
  contract.changes.forEach((change) => {
    if (change.impactProvenance) {
      fieldSources[`${change.id}.impactStatement`] = change.impactProvenance;
    }
    if (change.migrationProvenance) {
      fieldSources[`${change.id}.migrationPlan`] = change.migrationProvenance;
    }
  });

  const result = runCommit(candidate, {
    baselineId: contract.baselineId,
    openapi: contract.openapi,
    changes: contract.changes,
    fieldSources,
  });

  // 把已自动合并/解决的编辑写进已提交副本；冲突项保留在候选中
  const appliedByKey = new Map(
    result.appliedFieldEdits.map((edit) => [`${edit.changeId}.${edit.field}`, edit]),
  );
  let nextChanges = contract.changes;
  if (appliedByKey.size) {
    nextChanges = contract.changes.map((change) => {
      let next = change;
      MERGEABLE_FIELDS.forEach((field) => {
        const applied = appliedByKey.get(`${change.id}.${field}`);
        if (applied && applied.mergedValue !== undefined) {
          const provenance: FieldProvenance = {
            source: `${candidate!.windowLabel} / ${candidate!.author}`,
            candidateId: candidate!.id,
            at: now,
          };
          next = {
            ...next,
            [field]: applied.mergedValue,
            [field === 'impactStatement' ? 'impactProvenance' : 'migrationProvenance']: provenance,
          };
        }
      });
      return next;
    });
  }

  let nextOpenApi = contract.openapi;
  if (result.appliedOpenApi) {
    const openApiResult = result.candidate.openApiEdit;
    if (openApiResult?.mergedValue !== undefined) {
      nextOpenApi = openApiResult.mergedValue;
    }
  }

  // 冲突未解决时不推进基线，保持候选停留；有实际写入才推进
  const changed = result.changed;
  let nextContract: ApiContract = {
    ...contract,
    openapi: nextOpenApi,
    changes: nextChanges,
  };
  if (changed && result.conflicts === 0) {
    nextContract = touchBaseline(nextContract);
  } else if (changed) {
    // 部分字段已合并、部分冲突：推进基线但候选保持 conflict，基线已包含自动合并部分
    nextContract = touchBaseline(nextContract);
  }

  updateContract(contract.id, () => nextContract);
  const candidates = readCandidates().map((item) =>
    item.id === candidate!.id ? result.candidate : item,
  );
  writeCandidates(candidates);

  await wait();
  return { contract: clone(nextContract), candidate: clone(result.candidate) };
}

export interface ResolveConflictInput {
  candidateId: string;
  changeId: string;
  field: CandidateFieldEdit['field'] | 'openapi';
  choice: 'mine' | 'theirs' | 'combined';
  combinedValue?: string;
}

export async function resolveCandidateConflict(
  input: ResolveConflictInput,
): Promise<{ contract: ApiContract; candidate: Candidate }> {
  const stored = readCandidates().find((item) => item.id === input.candidateId);
  if (!stored) {
    throw new Error('候选不存在');
  }
  const resolved =
    input.field === 'openapi'
      ? resolveFieldConflict({
          candidate: stored,
          changeId: '__openapi__',
          field: 'impactStatement',
          choice: input.choice,
          combinedValue: input.combinedValue,
        })
      : resolveFieldConflict({
          candidate: stored,
          changeId: input.changeId,
          field: input.field,
          choice: input.choice,
          combinedValue: input.combinedValue,
        });

  const contract = getContractSync(stored.contractId);
  const now = new Date().toISOString();

  // 只把本次解决的那一项应用到已提交副本
  const justResolvedEdits = resolved.fieldEdits.filter(
    (edit) =>
      edit.changeId === input.changeId &&
      input.field !== 'openapi' &&
      edit.field === input.field &&
      edit.resolvedAt &&
      edit.mergedValue !== undefined,
  );

  let nextChanges = contract.changes;
  if (justResolvedEdits.length) {
    const edit = justResolvedEdits[0];
    nextChanges = contract.changes.map((change) => {
      if (change.id !== edit.changeId || edit.mergedValue === undefined) return change;
      const provenance: FieldProvenance = {
        source: `${resolved.windowLabel} / ${resolved.author}（冲突解决）`,
        candidateId: resolved.id,
        at: now,
      };
      return {
        ...change,
        [edit.field]: edit.mergedValue,
        [edit.field === 'impactStatement' ? 'impactProvenance' : 'migrationProvenance']: provenance,
      };
    });
  }

  let nextOpenApi = contract.openapi;
  if (input.field === 'openapi') {
    const edit = resolved.openApiEdit;
    if (edit?.resolvedAt && edit.mergedValue !== undefined) {
      nextOpenApi = edit.mergedValue;
    }
  }

  const allResolved = resolved.status === 'merged';
  const nextContract = touchBaseline({ ...contract, openapi: nextOpenApi, changes: nextChanges });
  updateContract(contract.id, () => nextContract);

  const finalCandidate: Candidate = allResolved
    ? {
        ...resolved,
        history: [
          ...resolved.history,
          {
            at: new Date().toISOString(),
            tone: 'success',
            message: `全部冲突已解决，候选合并到基线 ${nextContract.baselineId.slice(0, 8)}。`,
          },
        ],
      }
    : resolved;
  writeCandidates(
    readCandidates().map((item) => (item.id === stored.id ? finalCandidate : item)),
  );

  await wait();
  return { contract: clone(nextContract), candidate: clone(finalCandidate) };
}

/* ------------------------------------------------------------------ */
/* 发布：收集已接受且说明齐全的变化，基线过期/冲突/开放候选一律挡住       */
/* ------------------------------------------------------------------ */

export interface PublishInput {
  contractId: string;
  version: string;
  notes: string;
  /** 发起发布窗口看到的基线标识 */
  baselineId: string;
  consumerImpactSummary: string;
}

export class ReleaseGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseGateError';
  }
}

export async function publishVersion(input: PublishInput): Promise<{ contract: ApiContract; release: ContractVersion }> {
  const contract = getContractSync(input.contractId);
  const activeCandidates = getCandidatesSync(input.contractId).filter(
    (candidate) => candidate.status === 'open' || candidate.status === 'conflict',
  );
  const evaluation = evaluateRelease({
    contract,
    baselineId: input.baselineId,
    activeCandidates: activeCandidates.map((candidate) => ({
      id: candidate.id,
      windowId: candidate.windowLabel,
      baselineId: candidate.baselineId,
      status: candidate.status,
    })),
  });
  const blockers = evaluation.issues.filter((issue) => issue.severity === 'blocker');
  if (blockers.length) {
    throw new ReleaseGateError(blockers[0].detail);
  }

  const included = evaluation.includedChanges;
  const consumerImpacts = contract.consumers.map((consumer) => ({
    consumerId: consumer.id,
    name: consumer.name,
    environment: consumer.environment,
    clientVersion: consumer.clientVersion,
    requestsPerDay: consumer.requestsPerDay,
    impactSummary: input.consumerImpactSummary.trim() || '沿用各变化中的调用方影响说明。',
  }));

  const release: ContractVersion = {
    id: `ver-${Date.now()}-${basalSuffix()}`,
    contractId: input.contractId,
    version: input.version.trim(),
    releasedAt: new Date().toISOString(),
    checksum: stableChecksum(contract.openapi),
    notes: input.notes.trim() || '候选变化合并完成，按变化集冻结。',
    changeIds: included.map((change) => change.id),
    openapi: contract.openapi,
    baselineId: contract.baselineId,
    consumerImpacts,
    changes: clone(included),
    status: 'active',
    report: '',
  };
  release.report = buildReleaseReport(contract, release);

  const releasedIds = new Set(release.changeIds);
  // 发布只冻结进入快照的变化：标记它们已随版本发布，工作副本中其余变化保持评审中可继续编辑
  const nextChanges = contract.changes.map((change) =>
    releasedIds.has(change.id)
      ? {
          ...change,
          releasedInVersionId: release.id,
          releasedInVersion: release.version,
        }
      : change,
  );

  const updated: ApiContract = touchBaseline({
    ...contract,
    version: input.version.trim(),
    status: 'released',
    changes: nextChanges,
    versions: [release, ...contract.versions],
  });
  updateContract(input.contractId, () => updated);
  await wait();
  return { contract: clone(updated), release: clone(release) };
}

export interface RollbackInput {
  contractId: string;
  versionId: string;
  reason: string;
}

/**
 * 回滚一个发布快照：只恢复该快照内变化与对应调用方影响，
 * 其他快照、旧版本定义和报告记录全部保留可查。
 */
export async function rollbackVersion(input: RollbackInput): Promise<ApiContract> {
  const contract = getContractSync(input.contractId);
  const release = contract.versions.find((version) => version.id === input.versionId);
  if (!release) {
    throw new Error('发布快照不存在');
  }
  if (release.status === 'rolled_back') {
    throw new ReleaseGateError('该快照已经回滚，不能重复恢复。');
  }

  const now = new Date().toISOString();
  const snapshotChangeIds = new Set(release.changeIds);
  const snapshotById = new Map(release.changes.map((change) => [change.id, change]));

  const restoredChanges = contract.changes.map((change) => {
    if (!snapshotChangeIds.has(change.id)) return change;
    const snap = snapshotById.get(change.id);
    // 恢复到发布前的评审工作态：重新打开该项，只恢复本快照范围内的说明，保留本轮回滚备注
    return {
      ...(snap ?? change),
      id: change.id,
      reviewState: 'pending' as ReviewState,
      reviewer: change.reviewer,
      reviewComment: `版本 ${release.version} 已回滚：${input.reason}`,
      reviewedAt: undefined,
      releasedInVersionId: undefined,
      releasedInVersion: undefined,
    };
  });

  // 快照里可能包含之后从工作副本移除的变化（当前演示不会删除，但仍按快照恢复）
  release.changes.forEach((snapshotChange) => {
    if (!contract.changes.some((change) => change.id === snapshotChange.id)) {
      restoredChanges.push({
        ...snapshotChange,
        reviewState: 'pending',
        reviewComment: `版本 ${release.version} 回滚恢复的变化：${input.reason}`,
        reviewedAt: undefined,
        releasedInVersionId: undefined,
        releasedInVersion: undefined,
      });
    }
  });

  const versions = contract.versions.map((version) =>
    version.id === release.id
      ? { ...version, status: 'rolled_back' as const, rolledBackAt: now, rollbackReason: input.reason }
      : version,
  );

  const updated = touchBaseline({
    ...contract,
    status: 'review',
    changes: restoredChanges,
    versions,
  });
  updateContract(input.contractId, () => updated);
  await wait();
  return clone(updated);
}

export function isChangeReleasable(change: ContractChange): boolean {
  return isReleasableChange(change);
}

/* ------------------------------------------------------------------ */
/* 报告与示例                                                          */
/* ------------------------------------------------------------------ */

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

export function buildChangeReport(contract: ApiContract): string {
  const lines = [
    `# ${contract.name} ${contract.version} 契约变更报告（工作副本）`,
    '',
    `- 领域：${contract.domain}`,
    `- 负责人：${contract.owner}`,
    `- 状态：${contract.status}`,
    `- 当前基线：${contract.baselineId.slice(0, 12)}`,
    `- 生成时间：${new Date().toISOString()}`,
    '',
    '## 变更明细',
    ...contract.changes.flatMap((change) => [
      `### ${change.method} ${change.path} - ${change.kind}`,
      `- 兼容性：${change.compatibility}`,
      `- 变更前：${change.before}`,
      `- 变更后：${change.after}`,
      `- 判定依据：${change.rationale}`,
      `- 调用方影响：${change.impactStatement || '未填写'}${provenanceText(change.impactProvenance)}`,
      `- 迁移方案：${change.migrationPlan || '未填写'}${provenanceText(change.migrationProvenance)}`,
      `- 评审结论：${change.reviewState}`,
      '',
    ]),
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

function provenanceText(provenance?: FieldProvenance): string {
  if (!provenance) return '';
  return `（来源：${provenance.source}，${formatDateTime(provenance.at)}）`;
}

/** 单个发布快照的独立报告：只包含本快照收集的变化与调用方影响 */
export function buildReleaseReport(contract: ApiContract, release: ContractVersion): string {
  const lines = [
    `# ${contract.name} v${release.version} 发布报告`,
    '',
    `- 发布时间：${formatDateTime(release.releasedAt)}`,
    `- 发布基线：${release.baselineId.slice(0, 12)}`,
    `- 快照校验值：${release.checksum}`,
    `- 收集变化：${release.changeIds.length} 项`,
    `- 发布说明：${release.notes}`,
    '',
    '## 本次发布变化',
    ...release.changes.flatMap((change) => [
      `### ${change.method} ${change.path} - ${change.kind}`,
      `- 兼容性：${change.compatibility}；评审结论：${change.reviewState}（${change.reviewer}）`,
      `- 调用方影响：${change.impactStatement || '未填写'}${provenanceText(change.impactProvenance)}`,
      `- 迁移方案：${change.migrationPlan || '未填写'}${provenanceText(change.migrationProvenance)}`,
      '',
    ]),
    '## 调用方影响范围',
    ...release.consumerImpacts.map(
      (impact) =>
        `- ${impact.name}（${impact.environment} / ${impact.clientVersion}）：${impact.impactSummary}`,
    ),
    '',
    '## 豁免记录',
    ...(contract.exemptions.length
      ? contract.exemptions
          .filter((item) => release.changeIds.includes(item.changeId))
          .map((item) => `- ${item.scope}：${item.reason}（至 ${item.expiresAt}）`)
      : ['- 无']),
  ];
  return lines.join('\n');
}

export function diffVersionSummary(contract: ApiContract, version?: ContractVersion): string {
  const previous = version ?? contract.versions[0];
  if (!previous) {
    return '无可比较的历史正式版本。';
  }
  return [
    `版本 ${previous.version}（${previous.status === 'rolled_back' ? '已回滚' : '生效中'}）`,
    `发布于 ${formatDateTime(previous.releasedAt)}`,
    `校验值 ${previous.checksum}`,
    `发布基线 ${previous.baselineId.slice(0, 12)}`,
    `快照内变化 ${previous.changeIds.length} 项`,
    previous.rollbackReason ? `回滚原因：${previous.rollbackReason}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
