import { DiffEditor } from '@monaco-editor/react';
import { Link, useParams } from '@tanstack/react-router';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  GitCompare,
  Layers3,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { CandidatePanel } from '../components/contract/candidate-panel';
import { ChangeReviewItem } from '../components/contract/change-review-item';
import { CompatibilityBadge } from '../components/contract/compatibility-badge';
import { ConflictPanel } from '../components/contract/conflict-panel';
import { ConsumerTable } from '../components/contract/consumer-table';
import { ContractEditor } from '../components/contract/contract-editor';
import { ReleasePanel } from '../components/contract/release-panel';
import { VersionActions } from '../components/contract/version-actions';
import { WindowBar } from '../components/contract/window-bar';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Progress } from '../components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { formatDateTime } from '../lib/utils';
import {
  REVIEW_STATE_LABELS,
  type ApiContract,
  type ReviewState,
} from '../models/contract';
import type { Candidate, MergeableField } from '../models/candidate';
import {
  buildChangeReport,
  diffVersionSummary,
  generateExampleRequest,
  ReleaseGateError,
} from '../services/contract-service';
import {
  useAddExemption,
  useCandidates,
  useCommitCandidate,
  useContract,
  useDiscardCandidate,
  useRebaseCandidate,
  useReviewChange,
  useRollbackVersion,
  useStartCandidate,
  usePublishVersion,
  useResolveConflict,
} from '../services/contract-queries';
import { useReviewStore } from '../store/review-store';

const MERGE_FIELDS: MergeableField[] = ['impactStatement', 'migrationPlan'];
const EMPTY_CANDIDATES: Candidate[] = [];

export function ContractDetailPage() {
  const { contractId } = useParams({ from: '/contracts/$contractId' });
  const contractQuery = useContract(contractId);
  const candidatesQuery = useCandidates(contractId);
  const activeTab = useReviewStore((state) => state.activeTab);
  const setActiveTab = useReviewStore((state) => state.setActiveTab);
  const windows = useReviewStore((state) => state.windows);
  const activeWindowId = useReviewStore((state) => state.activeWindowId);
  const setWindowCandidate = useReviewStore((state) => state.setWindowCandidate);
  const windowCandidates = useReviewStore((state) => state.windowCandidates);
  const setDraft = useReviewStore((state) => state.setDraft);
  const getDraft = useReviewStore((state) => state.getDraft);
  const clearDrafts = useReviewStore((state) => state.clearDrafts);

  const reviewChange = useReviewChange();
  const addExemption = useAddExemption();
  const startCandidate = useStartCandidate();
  const discardCandidate = useDiscardCandidate();
  const rebaseCandidate = useRebaseCandidate();
  const commitCandidate = useCommitCandidate();
  const resolveConflict = useResolveConflict();
  const publishVersion = usePublishVersion();
  const rollbackVersion = useRollbackVersion();

  const [reviewFilter, setReviewFilter] = useState<ReviewState | 'all'>('all');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [banner, setBanner] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const contract = contractQuery.data;
  const candidates = candidatesQuery.data ?? EMPTY_CANDIDATES;

  const candidatesByWindow = useMemo(() => {
    const map: Record<string, (typeof candidates)[number] | undefined> = {};
    windows.forEach((window) => {
      const mappedId = windowCandidates[contractId]?.[window.id];
      map[window.id] =
        candidates.find((candidate) => candidate.id === mappedId) ??
        candidates.find(
          (candidate) =>
            candidate.windowId === window.id &&
            (candidate.status === 'open' || candidate.status === 'conflict'),
        );
    });
    return map;
  }, [candidates, windows, windowCandidates, contractId]);

  const activeWindow = windows.find((window) => window.id === activeWindowId) ?? windows[0];
  const activeCandidate = candidatesByWindow[activeWindow?.id ?? 'window-a'];

  const draftEdits = useMemo(() => {
    if (!contract || !activeCandidate) return { fields: [] as Array<{ changeId: string; field: MergeableField; value: string }>, openApi: undefined as string | undefined, dirtyCount: 0 };
    const fields: Array<{ changeId: string; field: MergeableField; value: string }> = [];
    let dirtyCount = 0;
    contract.changes.forEach((change) => {
      MERGE_FIELDS.forEach((field) => {
        const key = `${change.id}.${field}`;
        const draft = getDraft({ contractId, windowId: activeCandidate.windowId, changeId: change.id, field });
        // 未触碰的字段回落到候选锁定的基线值，提交时会被服务端过滤；展示仍用当前已提交值
        const value = draft ?? activeCandidate.baseFields[key] ?? change[field];
        fields.push({ changeId: change.id, field, value });
        if (draft !== undefined && draft !== activeCandidate.baseFields[key]) {
          dirtyCount += 1;
        }
      });
    });
    const openApiDraft = getDraft({
      contractId,
      windowId: activeCandidate.windowId,
      changeId: '__openapi__',
      field: 'openapi',
    });
    const openApiDirty =
      openApiDraft !== undefined && openApiDraft !== activeCandidate.baseOpenApi;
    if (openApiDirty) dirtyCount += 1;
    return { fields, openApi: openApiDraft, dirtyCount };
  }, [contract, activeCandidate, contractId, getDraft]);

  const acceptedCount = contract?.changes.filter((change) => change.reviewState !== 'pending').length ?? 0;
  const reviewProgress = contract?.changes.length
    ? Math.round((acceptedCount / contract.changes.length) * 100)
    : 100;
  const selectedVersion =
    contract?.versions.find((version) => version.id === selectedVersionId) ??
    contract?.versions[0];

  if (contractQuery.isLoading) {
    return <PageState text="正在加载契约详情..." />;
  }
  if (contractQuery.isError || !contract) {
    return (
      <div className="rounded-lg border border-red-200 bg-white p-10 text-center">
        <h1 className="text-xl font-semibold">契约不存在</h1>
        <p className="mt-2 text-sm text-slate-500">记录可能已被删除，或链接无效。</p>
        <Link to="/" className="mt-5 inline-flex text-sm font-medium text-sky-800">
          返回契约工作台
        </Link>
      </div>
    );
  }
  const currentContract = contract;
  const canDraft = activeCandidate?.status === 'open' || activeCandidate?.status === 'conflict';

  async function handleStart() {
    if (!activeWindow) return;
    const candidate = await startCandidate.mutateAsync({
      contractId,
      windowId: activeWindow.id,
      windowLabel: activeWindow.label,
      author: activeWindow.author,
    });
    setWindowCandidate(contractId, activeWindow.id, candidate.id);
    setBanner({ tone: 'success', text: `${activeWindow.label} 已从基线 ${candidate.baselineId.slice(0, 10)} 发起候选。` });
  }

  async function handleDiscard() {
    if (!activeCandidate) return;
    await discardCandidate.mutateAsync(activeCandidate.id);
    setWindowCandidate(contractId, activeCandidate.windowId, undefined);
    clearDrafts(contractId, activeCandidate.windowId);
    setBanner({ tone: 'success', text: '候选已丢弃，已提交副本未受影响。' });
  }

  async function handleRebase() {
    if (!activeCandidate) return;
    const rebased = await rebaseCandidate.mutateAsync(activeCandidate.id);
    setWindowCandidate(contractId, activeCandidate.windowId, rebased.id);
    setBanner({ tone: 'success', text: '候选已变基到最新基线，本地草稿保留。' });
  }

  async function handleCommit() {
    if (!activeCandidate) return;
    try {
      const result = await commitCandidate.mutateAsync({
        candidateId: activeCandidate.id,
        fieldEdits: draftEdits.fields,
        openApi:
          draftEdits.openApi !== undefined ? { value: draftEdits.openApi } : undefined,
      });
      setBanner(
        result.candidate.status === 'conflict'
          ? { tone: 'error', text: '提交检测到同字段冲突，双方内容已保留，请在下方逐处选择。' }
          : { tone: 'success', text: '候选已合并提交，不同字段的补充均已保留。' },
      );
      if (result.candidate.status === 'merged') {
        clearDrafts(contractId, activeCandidate.windowId);
        setWindowCandidate(contractId, activeCandidate.windowId, undefined);
      }
    } catch (error) {
      setBanner({ tone: 'error', text: error instanceof Error ? error.message : '提交失败' });
    }
  }

  async function handleReview(changeId: string, state: ReviewState, comment: string) {
    await reviewChange.mutateAsync({
      contractId,
      changeId,
      state,
      reviewer: activeWindow?.author ?? '当前评审人',
      comment,
    });
  }

  async function handleExemption(changeId: string, reason: string) {
    await addExemption.mutateAsync({ contractId, changeId, reason });
  }

  async function handlePublish(input: { version: string; notes: string; consumerImpactSummary: string }) {
    try {
      await publishVersion.mutateAsync({
        contractId,
        version: input.version,
        notes: input.notes,
        consumerImpactSummary: input.consumerImpactSummary,
        baselineId: activeCandidate?.baselineId ?? contract?.baselineId ?? '',
      });
      setBanner({ tone: 'success', text: `v${input.version} 发布快照已冻结，可在版本历史中回滚或查阅报告。` });
    } catch (error) {
      const text =
        error instanceof ReleaseGateError
          ? `发布被门禁挡住：${error.message}`
          : error instanceof Error
            ? error.message
            : '发布失败';
      setBanner({ tone: 'error', text });
    }
  }

  async function handleRollback(versionId: string, reason: string) {
    try {
      await rollbackVersion.mutateAsync({ contractId, versionId, reason });
      setBanner({ tone: 'success', text: '该快照的变化与调用方影响已恢复到评审工作副本，其他版本与报告未受影响。' });
    } catch (error) {
      setBanner({ tone: 'error', text: error instanceof Error ? error.message : '回滚失败' });
    }
  }

  function exportReport() {
    downloadText(
      `${currentContract.id}-${currentContract.version}-change-report.md`,
      buildChangeReport(currentContract),
      'text/markdown;charset=utf-8',
    );
  }

  function exportJson() {
    downloadText(
      `${currentContract.id}-${currentContract.version}.json`,
      JSON.stringify(currentContract, null, 2),
      'application/json;charset=utf-8',
    );
  }

  const filteredChanges = contract.changes.filter(
    (change) => reviewFilter === 'all' || change.reviewState === reviewFilter,
  );

  return (
    <div>
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-800 hover:text-sky-950"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        返回契约清单
      </Link>

      <section className="mt-3 border-b border-slate-200 pb-5">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-sky-800">{contract.protocol}</span>
              <Badge tone="slate">v{contract.version}</Badge>
              <StatusPill status={contract.status} />
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-500">
                <GitCompare className="h-3 w-3" />
                基线 {contract.baselineId.slice(0, 10)}
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">
              {contract.name}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {contract.domain} · 负责人 {contract.owner} · 更新 {formatDateTime(contract.updatedAt)}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
            <HeaderMetric label="变更项" value={String(contract.changes.length)} />
            <HeaderMetric label="调用方" value={String(contract.consumers.length)} />
            <HeaderMetric label="发布快照" value={String(contract.versions.length)} />
          </div>
        </div>
      </section>

      {banner && (
        <div
          className={
            banner.tone === 'error'
              ? 'mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800'
              : 'mt-3 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800'
          }
        >
          {banner.tone === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <GitCompare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span className="flex-1">{banner.text}</span>
          <button type="button" className="underline" onClick={() => setBanner(null)}>
            关闭
          </button>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
        <TabsList>
          <TabsTrigger value="overview">概览与契约</TabsTrigger>
          <TabsTrigger value="changes">差异评审</TabsTrigger>
          <TabsTrigger value="collab">协作候选</TabsTrigger>
          <TabsTrigger value="consumers">调用方</TabsTrigger>
          <TabsTrigger value="release">发布门禁</TabsTrigger>
          <TabsTrigger value="history">版本历史</TabsTrigger>
          <TabsTrigger value="report">变更报告</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <div className="space-y-3">
              <WindowBar contractBaselineId={contract.baselineId} candidatesByWindow={candidatesByWindow} />
              <ContractEditor
                value={draftEdits.openApi ?? contract.openapi}
                baselineValue={activeCandidate?.baseOpenApi ?? contract.openapi}
                canDraft={!!canDraft}
                dirty={
                  draftEdits.openApi !== undefined &&
                  draftEdits.openApi !== (activeCandidate?.baseOpenApi ?? contract.openapi)
                }
                saving={commitCandidate.isPending}
                onChange={(value) =>
                  activeWindow &&
                  setDraft(
                    {
                      contractId,
                      windowId: activeWindow.id,
                      changeId: '__openapi__',
                      field: 'openapi',
                    },
                    value,
                  )
                }
                onCommit={() => void handleCommit()}
              />
            </div>
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>评审进度</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end justify-between">
                    <div>
                      <span className="text-3xl font-semibold">{reviewProgress}%</span>
                      <p className="mt-1 text-xs text-slate-500">
                        {acceptedCount} / {contract.changes.length} 项已有结论
                      </p>
                    </div>
                    <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                  </div>
                  <Progress className="mt-4" value={reviewProgress} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>兼容性摘要</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(['compatible', 'warning', 'breaking'] as const).map((level) => {
                    const count = contract.changes.filter(
                      (change) => change.compatibility === level,
                    ).length;
                    return (
                      <div key={level} className="flex items-center justify-between">
                        <CompatibilityBadge value={level} />
                        <strong className="text-sm">{count} 项</strong>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>示例请求</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">根据当前定义自动生成</p>
                </CardHeader>
                <CardContent>
                  <pre className="max-h-72 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
                    {generateExampleRequest(contract)}
                  </pre>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="changes">
          <Card>
            <CardHeader className="flex flex-col gap-3">
              <WindowBar contractBaselineId={contract.baselineId} candidatesByWindow={candidatesByWindow} />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>字段与错误码差异</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    在当前窗口的候选中补充影响与迁移说明，提交时按字段与其他窗口合并
                  </p>
                </div>
                <Select
                  value={reviewFilter}
                  onValueChange={(value) => setReviewFilter(value as ReviewState | 'all')}
                >
                  <SelectTrigger className="sm:w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部评审状态</SelectItem>
                    {Object.entries(REVIEW_STATE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {activeCandidate?.status === 'conflict' && (
                <ConflictPanel
                  candidate={activeCandidate}
                  resolving={resolveConflict.isPending}
                  onResolve={async (input) => {
                    try {
                      const result = await resolveConflict.mutateAsync({
                        candidateId: activeCandidate.id,
                        ...input,
                      });
                      if (result.candidate.status === 'merged') {
                        clearDrafts(contractId, activeCandidate.windowId);
                        setWindowCandidate(contractId, activeCandidate.windowId, undefined);
                        setBanner({ tone: 'success', text: '冲突已全部解决，候选合并完成。' });
                      }
                    } catch (error) {
                      setBanner({
                        tone: 'error',
                        text: error instanceof Error ? error.message : '冲突解决失败',
                      });
                    }
                  }}
                />
              )}
            </CardHeader>
            <CardContent className="p-0">
              {filteredChanges.map((change) => (
                <ChangeReviewItem
                  key={`${change.id}-${change.reviewState}-${change.impactStatement}-${change.migrationPlan}-${activeWindow?.id}`}
                  change={change}
                  canDraft={!!canDraft}
                  draftImpact={
                    getDraft({
                      contractId,
                      windowId: activeWindow?.id ?? 'window-a',
                      changeId: change.id,
                      field: 'impactStatement',
                    }) ?? change.impactStatement
                  }
                  draftMigration={
                    getDraft({
                      contractId,
                      windowId: activeWindow?.id ?? 'window-a',
                      changeId: change.id,
                      field: 'migrationPlan',
                    }) ?? change.migrationPlan
                  }
                  onDraftChange={(changeId, field, value) =>
                    activeWindow &&
                    setDraft({ contractId, windowId: activeWindow.id, changeId, field }, value)
                  }
                  onReview={(changeId, state, comment) =>
                    void handleReview(changeId, state, comment)
                  }
                  onExemption={(changeId, reason) => void handleExemption(changeId, reason)}
                />
              ))}
              {!filteredChanges.length && (
                <p className="p-10 text-center text-sm text-slate-500">没有符合条件的变更项。</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="collab">
          <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
            <div className="space-y-4">
              <WindowBar contractBaselineId={contract.baselineId} candidatesByWindow={candidatesByWindow} />
              {activeCandidate?.status === 'conflict' && (
                <ConflictPanel
                  candidate={activeCandidate}
                  resolving={resolveConflict.isPending}
                  onResolve={(input) =>
                    void resolveConflict
                      .mutateAsync({ candidateId: activeCandidate.id, ...input })
                      .then((result) => {
                        if (result.candidate.status === 'merged') {
                          clearDrafts(contractId, activeCandidate.windowId);
                          setWindowCandidate(contractId, activeCandidate.windowId, undefined);
                          setBanner({ tone: 'success', text: '冲突已全部解决，候选合并完成。' });
                        }
                      })
                  }
                />
              )}
              <Card>
                <CardHeader>
                  <CardTitle>候选合并规则</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm leading-6 text-slate-600">
                  <p>1. 每个窗口都从同一个已提交基线发起候选，候选始终携带基线标识。</p>
                  <p>2. 提交时按字段做三方合并：不同字段的补充自动合入；本窗口没动而对方改过的字段保留对方内容。</p>
                  <p>3. 同一字段两边都改成不同内容时不覆盖任何一方，保留两边的值和来源，在上方逐处人工选择。</p>
                  <p>4. 基线已推进时可以直接提交（触发合并）或先“变基到最新”刷新基准；发布则必须基于最新基线。</p>
                </CardContent>
              </Card>
            </div>
            <CandidatePanel
              candidate={activeCandidate}
              latestBaselineId={contract.baselineId}
              dirty={draftEdits.dirtyCount > 0}
              submitting={commitCandidate.isPending}
              starting={startCandidate.isPending}
              rebasing={rebaseCandidate.isPending}
              onStart={() => void handleStart()}
              onCommit={() => void handleCommit()}
              onRebase={() => void handleRebase()}
              onDiscard={() => void handleDiscard()}
            />
          </div>
        </TabsContent>

        <TabsContent value="consumers">
          <Card>
            <CardHeader>
              <CardTitle>依赖调用方列表</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                发布时调用方影响会写入独立快照，回滚只恢复该快照记录的范围
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <ConsumerTable consumers={contract.consumers} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="release">
          <div className="mb-4">
            <WindowBar contractBaselineId={contract.baselineId} candidatesByWindow={candidatesByWindow} />
          </div>
          <ReleasePanel
            contract={contract}
            windowBaselineId={activeCandidate?.baselineId ?? contract.baselineId}
            candidates={candidates}
            publishing={publishVersion.isPending}
            onPublish={(input) => void handlePublish(input)}
          />
        </TabsContent>

        <TabsContent value="history">
          {selectedVersion ? (
            <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>发布快照</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    每次发布独立留档，回滚彼此不影响；旧版本定义与报告始终可查
                  </p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {contract.versions.map((version) => (
                    <button
                      key={version.id}
                      type="button"
                      className={
                        selectedVersion.id === version.id
                          ? 'w-full rounded-md border border-sky-300 bg-sky-50 p-3 text-left'
                          : 'w-full rounded-md border border-slate-200 p-3 text-left hover:bg-slate-50'
                      }
                      onClick={() => setSelectedVersionId(version.id)}
                    >
                      <div className="flex items-center justify-between">
                        <strong className="text-sm">v{version.version}</strong>
                        <div className="flex items-center gap-1.5">
                          {version.status === 'rolled_back' && <Badge tone="slate">已回滚</Badge>}
                          <span className="font-mono text-[10px] text-slate-500">
                            {version.checksum}
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">{version.notes}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        快照内 {version.changeIds.length} 项变化
                      </p>
                    </button>
                  ))}
                  {!contract.versions.length && (
                    <p className="py-8 text-center text-sm text-slate-500">尚无发布快照。</p>
                  )}
                </CardContent>
              </Card>
              <div className="space-y-4">
                <Card>
                  <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <div>
                      <CardTitle>快照 {selectedVersion.version}</CardTitle>
                      <p className="mt-1 whitespace-pre-line text-xs text-slate-500">
                        {diffVersionSummary(contract, selectedVersion)}
                      </p>
                    </div>
                    <VersionActions
                      version={selectedVersion}
                      rollingBack={rollbackVersion.isPending}
                      onRollback={(reason) => void handleRollback(selectedVersion.id, reason)}
                    />
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3">
                      <div className="text-xs font-semibold text-slate-600">本快照收集的变化</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {selectedVersion.changes.map((change) => (
                          <Badge key={change.id} tone="blue">
                            {change.method} {change.path}
                          </Badge>
                        ))}
                        {!selectedVersion.changes.length && (
                          <span className="text-xs text-slate-400">旧版快照，未留存逐项副本。</span>
                        )}
                      </div>
                    </div>
                    <div className="overflow-hidden rounded-md border border-slate-200">
                      <DiffEditor
                        height="460px"
                        language="plaintext"
                        original={selectedVersion.openapi}
                        modified={contract.openapi}
                        options={{
                          readOnly: true,
                          minimap: { enabled: false },
                          renderSideBySide: true,
                          fontSize: 12,
                          automaticLayout: true,
                        }}
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <Card>
              <CardContent className="py-14 text-center text-sm text-slate-500">
                暂无版本可比较。
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="report">
          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>工作副本变更报告</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    Markdown 格式，包含字段补充来源；每次发布另存独立快照报告
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-sm border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50"
                  onClick={exportReport}
                >
                  <Download className="h-3.5 w-3.5" />
                  导出报告
                </button>
              </CardHeader>
              <CardContent>
                <pre className="max-h-[650px] overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100">
                  {buildChangeReport(contract)}
                </pre>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>发布快照报告存档</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {contract.versions.map((version) => (
                    <div
                      key={version.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2"
                    >
                      <div>
                        <div className="text-sm font-medium">v{version.version}</div>
                        <div className="text-[11px] text-slate-500">
                          {formatDateTime(version.releasedAt)}
                        </div>
                      </div>
                      <VersionActions
                        version={version}
                        rollingBack={rollbackVersion.isPending}
                        onRollback={(reason) => void handleRollback(version.id, reason)}
                      />
                    </div>
                  ))}
                  {!contract.versions.length && (
                    <p className="py-6 text-center text-xs text-slate-500">尚无发布报告。</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>报告要素</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <ReportFact
                    icon={GitCompare}
                    label="变更明细"
                    value={`${contract.changes.length} 项`}
                  />
                  <ReportFact
                    icon={Users}
                    label="调用方影响"
                    value={`${contract.consumers.length} 个客户端`}
                  />
                  <ReportFact
                    icon={Layers3}
                    label="兼容层豁免"
                    value={`${contract.exemptions.length} 条`}
                  />
                </CardContent>
              </Card>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-sm border border-slate-300 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50"
                  onClick={exportJson}
                >
                  导出 JSON
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-sm border border-slate-300 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50"
                  onClick={exportReport}
                >
                  导出 Markdown
                </button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function HeaderMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-24 bg-white px-4 py-3">
      <span className="text-[11px] text-slate-500">{label}</span>
      <strong className="mt-1 block text-slate-900">{value}</strong>
    </div>
  );
}

function StatusPill({ status }: { status: ApiContract['status'] }) {
  const label = {
    draft: '草稿',
    review: '评审中',
    ready: '待发布',
    released: '已发布',
    frozen: '已冻结',
  }[status];
  const tone = {
    draft: 'neutral',
    review: 'amber',
    ready: 'blue',
    released: 'green',
    frozen: 'slate',
  }[status] as 'neutral' | 'amber' | 'blue' | 'green' | 'slate';
  return <Badge tone={tone}>{label}</Badge>;
}

function ReportFact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof GitCompare;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0">
      <span className="flex items-center gap-2 text-slate-600">
        <Icon className="h-4 w-4 text-sky-800" />
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function PageState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-16 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
