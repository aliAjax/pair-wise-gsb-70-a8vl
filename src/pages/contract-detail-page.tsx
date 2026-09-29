import { DiffEditor } from '@monaco-editor/react';
import { Link, useParams } from '@tanstack/react-router';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  FileWarning,
  GitCompare,
  History,
  Layers3,
  LockKeyhole,
  RotateCcw,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ChangeReviewItem } from '../components/contract/change-review-item';
import { ConsumerTable } from '../components/contract/consumer-table';
import { ContractEditor } from '../components/contract/contract-editor';
import { WindowBar } from '../components/contract/window-bar';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Progress } from '../components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { formatDateTime } from '../lib/utils';
import {
  REVIEW_STATE_LABELS,
  type ApiContract,
  type MergeableField,
  type ReviewState,
  collectConflicts,
  getMergedChange,
  isChangeReleaseReady,
  mergeField,
  validateForRelease,
} from '../models/contract';
import { buildChangeReport, generateExampleRequest } from '../services/contract-service';
import {
  useAddExemption,
  useContract,
  useFreezeVersion,
  useResolveConflict,
  useReviewChange,
  useRollbackSnapshot,
  useSubmitCandidate,
  useSyncWindowBaseline,
  useUpdateOpenApi,
} from '../services/contract-queries';
import { useReviewStore } from '../store/review-store';

const MERGEABLE_FIELDS: MergeableField[] = [
  'impactStatement',
  'migrationPlan',
  'reviewState',
  'reviewer',
  'reviewComment',
];

export function ContractDetailPage() {
  const { contractId } = useParams({ from: '/contracts/$contractId' });
  const contractQuery = useContract(contractId);
  const activeTab = useReviewStore((state) => state.activeTab);
  const setActiveTab = useReviewStore((state) => state.setActiveTab);

  const windows = useReviewStore((state) =>
    state.windows.filter((window) => window.contractId === contractId),
  );
  const activeWindowId = useReviewStore((state) => state.activeWindowByContract[contractId] ?? '');
  const ensureWindow = useReviewStore((state) => state.ensureWindow);
  const setActiveWindow = useReviewStore((state) => state.setActiveWindow);
  const addWindow = useReviewStore((state) => state.addWindow);
  const removeWindow = useReviewStore((state) => state.removeWindow);
  const setWindowAuthor = useReviewStore((state) => state.setWindowAuthor);

  const reviewChange = useReviewChange();
  const addExemption = useAddExemption();
  const updateOpenApi = useUpdateOpenApi();
  const submitCandidate = useSubmitCandidate();
  const resolveConflict = useResolveConflict();
  const syncBaseline = useSyncWindowBaseline();
  const freezeVersion = useFreezeVersion();
  const rollbackSnapshot = useRollbackSnapshot();

  const [releaseVersion, setReleaseVersion] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [reviewFilter, setReviewFilter] = useState<ReviewState | 'all'>('all');
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('');
  const [freezeError, setFreezeError] = useState('');
  const [rollbackTarget, setRollbackTarget] = useState<{ id: string; version: string } | null>(
    null,
  );
  const [rollbackReason, setRollbackReason] = useState('');
  const [rollbackError, setRollbackError] = useState('');

  const contract = contractQuery.data;

  // 进入详情页时确保至少有一个编辑窗口（副作用放在 effect 中）
  useEffect(() => {
    if (!contract) return;
    const contractWindows = windows.filter((window) => window.contractId === contractId);
    if (!contractWindows.length) {
      ensureWindow(contractId);
      return;
    }
    if (!activeWindowId || !contractWindows.some((window) => window.id === activeWindowId)) {
      setActiveWindow(contractId, contractWindows[0].id);
    }
  }, [contract, windows, activeWindowId, contractId, ensureWindow, setActiveWindow]);

  const activeWindow = useMemo(
    () =>
      windows.find((window) => window.id === activeWindowId) ??
      windows.find((window) => window.contractId === contractId),
    [windows, activeWindowId, contractId],
  );

  const mergedChanges = useMemo(
    () => (contract ? contract.changes.map((change) => getMergedChange(contract, change.id)) : []),
    [contract],
  );

  const fieldMerges = useMemo(() => {
    if (!contract) return {};
    const map: Record<
      string,
      Record<
        MergeableField,
        ReturnType<typeof mergeField>
      >
    > = {};
    for (const change of contract.changes) {
      map[change.id] = MERGEABLE_FIELDS.reduce(
        (acc, field) => {
          acc[field] = mergeField(contract, change.id, field);
          return acc;
        },
        {} as Record<MergeableField, ReturnType<typeof mergeField>>,
      );
    }
    return map;
  }, [contract]);

  const issues = useMemo(() => (contract ? validateForRelease(contract) : []), [contract]);
  const conflicts = useMemo(() => (contract ? collectConflicts(contract) : []), [contract]);
  const blockers = issues.filter((issue) => issue.severity === 'blocker').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  const acceptedCount = mergedChanges.filter((change) => change.reviewState !== 'pending').length;
  const reviewProgress = mergedChanges.length
    ? Math.round((acceptedCount / mergedChanges.length) * 100)
    : 100;
  const readyToRelease = mergedChanges.filter((change) =>
    contract ? isChangeReleaseReady(contract, change).ready : false,
  );

  const selectedSnapshot =
    contract?.snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ??
    contract?.snapshots[0];

  if (contractQuery.isLoading) {
    return <PageState text="正在加载契约详情..." />;
  }
  if (contractQuery.isError || !contract || !activeWindow) {
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

  async function handleSubmitField(changeId: string, field: MergeableField, value: string) {
    await submitCandidate.mutateAsync({
      contractId,
      changeId,
      field,
      value,
      windowId: activeWindow!.id,
      windowLabel: activeWindow!.label,
      author: activeWindow!.author,
    });
  }

  async function handleReview(changeId: string, state: ReviewState, comment: string) {
    await reviewChange.mutateAsync({
      contractId,
      changeId,
      state,
      reviewer: activeWindow!.author,
      comment,
    });
  }

  async function handleExemption(changeId: string, reason: string) {
    await addExemption.mutateAsync({ contractId, changeId, reason });
  }

  async function handleResolve(
    changeId: string,
    field: MergeableField,
    keepCandidateId: string,
  ) {
    await resolveConflict.mutateAsync({
      contractId,
      changeId,
      field,
      keepCandidateId,
      resolvedBy: activeWindow!.author,
    });
  }

  async function saveOpenApi(value: string) {
    await updateOpenApi.mutateAsync({ contractId, openapi: value });
  }

  async function freeze() {
    if (!releaseVersion.trim()) return;
    setFreezeError('');
    try {
      await freezeVersion.mutateAsync({
        contractId,
        version: releaseVersion.trim(),
        notes: releaseNotes.trim() || '本版契约变更评审完成。',
      });
      setReleaseVersion('');
      setReleaseNotes('');
    } catch (error) {
      setFreezeError(error instanceof Error ? error.message : '发布失败');
    }
  }

  async function confirmRollback() {
    if (!rollbackTarget || !rollbackReason.trim()) return;
    setRollbackError('');
    try {
      await rollbackSnapshot.mutateAsync({
        contractId,
        snapshotId: rollbackTarget.id,
        reason: rollbackReason.trim(),
        operator: activeWindow!.author,
      });
      setRollbackTarget(null);
      setRollbackReason('');
    } catch (error) {
      setRollbackError(error instanceof Error ? error.message : '回滚失败');
    }
  }

  function exportReport() {
    downloadText(
      `${contract!.id}-${contract!.version}-change-report.md`,
      buildChangeReport(contract!),
      'text/markdown;charset=utf-8',
    );
  }

  function exportSnapshotReport(snapshotId: string) {
    const snapshot = contract!.snapshots.find((item) => item.id === snapshotId);
    if (!snapshot) return;
    downloadText(
      `${contract!.id}-v${snapshot.version}-archived-report.md`,
      snapshot.report,
      'text/markdown;charset=utf-8',
    );
  }

  const filteredChanges = mergedChanges.filter(
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
              <Badge tone="blue">基线 {contract.baselineLabel}</Badge>
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
            <HeaderMetric label="待发布" value={String(readyToRelease.length)} />
            <HeaderMetric
              label="发布门禁"
              value={blockers ? `${blockers} 阻断` : '通过'}
              danger={!!blockers}
            />
          </div>
        </div>
      </section>

      <div className="mt-4">
        <WindowBar
          contract={contract}
          windows={windows}
          activeWindow={activeWindow}
          syncing={syncBaseline.isPending}
          onSelectWindow={(windowId) => setActiveWindow(contractId, windowId)}
          onAddWindow={(label, author) => addWindow(contractId, label, author)}
          onRemoveWindow={(windowId) => removeWindow(contractId, windowId)}
          onAuthorChange={(author) => setWindowAuthor(contractId, activeWindow.id, author)}
          onSyncBaseline={() => syncBaseline.mutate({ contractId, windowId: activeWindow.id })}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
        <TabsList>
          <TabsTrigger value="overview">概览与契约</TabsTrigger>
          <TabsTrigger value="changes">差异评审</TabsTrigger>
          <TabsTrigger value="consumers">调用方</TabsTrigger>
          <TabsTrigger value="release">发布门禁</TabsTrigger>
          <TabsTrigger value="history">版本快照</TabsTrigger>
          <TabsTrigger value="report">变更报告</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <ContractEditor
              key={`${contract.id}-${contract.openapi}`}
              contract={contract}
              onSave={(value) => void saveOpenApi(value)}
              saving={updateOpenApi.isPending}
            />
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
                        {acceptedCount} / {mergedChanges.length} 项已有结论
                      </p>
                    </div>
                    {!blockers && <CheckCircle2 className="h-6 w-6 text-emerald-600" />}
                  </div>
                  <Progress className="mt-4" value={reviewProgress} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>候选与冲突</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">待合并候选</span>
                    <strong>{contract.candidates.length}</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">未解决冲突</span>
                    <strong className={conflicts.length ? 'text-red-700' : 'text-emerald-700'}>
                      {conflicts.length}
                    </strong>
                  </div>
                  <p className="text-xs leading-5 text-slate-500">
                    不同字段的补充已自动合并；同字段冲突需在「差异评审」中选择保留版本。
                  </p>
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
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>字段与错误码差异</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  每个窗口从基线提交候选；同字段冲突保留双方，选择后才能发布
                </p>
              </div>
              <Select
                value={reviewFilter}
                onValueChange={(value) => setReviewFilter(value as ReviewState | 'all')}
              >
                <SelectTrigger>
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
            </CardHeader>
            <CardContent className="p-0">
              {filteredChanges.map((change) => (
                <ChangeReviewItem
                  key={`${change.id}-${activeWindow.id}-${
                    fieldMerges[change.id]?.impactStatement.value
                  }-${fieldMerges[change.id]?.migrationPlan.value}-${contract.candidates.length}`}
                  contract={contract}
                  change={change}
                  activeWindowId={activeWindow.id}
                  activeWindowLabel={activeWindow.label}
                  fields={fieldMerges[change.id]!}
                  submitting={submitCandidate.isPending}
                  resolving={resolveConflict.isPending}
                  onSubmitField={(changeId, field, value) =>
                    void handleSubmitField(changeId, field, value)
                  }
                  onReview={(changeId, state, comment) => void handleReview(changeId, state, comment)}
                  onExemption={(changeId, reason) => void handleExemption(changeId, reason)}
                  onResolveConflict={(changeId, field, keepCandidateId) =>
                    void handleResolve(changeId, field, keepCandidateId)
                  }
                />
              ))}
              {!filteredChanges.length && (
                <p className="p-10 text-center text-sm text-slate-500">没有符合条件的变更项。</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="consumers">
          <Card>
            <CardHeader>
              <CardTitle>依赖调用方列表</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                发布快照会记录每个调用方在该版本受到的影响；回滚时随该版一并恢复
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <ConsumerTable consumers={contract.consumers} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="release">
          <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
            <Card>
              <CardHeader>
                <CardTitle>发布前门禁</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  {blockers} 个阻断项，{warnings} 个警告；本次将收集 {readyToRelease.length} 项已接受且说明齐全的变化
                </p>
              </CardHeader>
              <CardContent>
                {issues.map((issue) => (
                  <div
                    key={issue.id}
                    className={
                      issue.severity === 'blocker'
                        ? 'border-b border-red-100 bg-red-50 px-3 py-3 first:rounded-t-md'
                        : 'border-b border-amber-100 bg-amber-50 px-3 py-3'
                    }
                  >
                    <div className="flex items-center gap-2">
                      {issue.severity === 'blocker' ? (
                        <FileWarning className="h-4 w-4 text-red-700" />
                      ) : (
                        <Clock3 className="h-4 w-4 text-amber-700" />
                      )}
                      <strong className="text-sm">{issue.title}</strong>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-600">{issue.detail}</p>
                  </div>
                ))}
                {!issues.length && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                    基线最新、无冲突且说明齐全，可以生成本次独立发布快照。
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>生成发布快照</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  只冻结本版收集的变化；每次发布独立存档，回滚不影响其他版本
                </p>
              </CardHeader>
              <CardContent>
                <label className="text-xs font-medium text-slate-700">版本号</label>
                <Input
                  className="mt-1.5"
                  value={releaseVersion}
                  onChange={(event) => setReleaseVersion(event.target.value)}
                  placeholder="例如 2.9.0"
                />
                <label className="mt-4 block text-xs font-medium text-slate-700">发布说明</label>
                <Textarea
                  className="mt-1.5"
                  value={releaseNotes}
                  onChange={(event) => setReleaseNotes(event.target.value)}
                  placeholder="说明本版接口变化、兼容层和调用方升级状态"
                />
                {freezeError && <p className="mt-2 text-xs text-red-700">{freezeError}</p>}
                <Button
                  className="mt-4 w-full"
                  disabled={!!blockers || !releaseVersion.trim() || freezeVersion.isPending}
                  onClick={() => void freeze()}
                >
                  <LockKeyhole className="h-4 w-4" />
                  {freezeVersion.isPending ? '发布中' : '确认发布（独立快照）'}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history">
          {selectedSnapshot ? (
            <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>发布快照</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {contract.snapshots.map((snapshot) => (
                    <button
                      key={snapshot.id}
                      type="button"
                      className={
                        selectedSnapshot.id === snapshot.id
                          ? 'w-full rounded-md border border-sky-300 bg-sky-50 p-3 text-left'
                          : 'w-full rounded-md border border-slate-200 p-3 text-left hover:bg-slate-50'
                      }
                      onClick={() => setSelectedSnapshotId(snapshot.id)}
                    >
                      <div className="flex items-center justify-between">
                        <strong className="text-sm">v{snapshot.version}</strong>
                        <span className="font-mono text-[10px] text-slate-500">
                          {snapshot.checksum}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">{snapshot.notes}</p>
                      {snapshot.rollbackState && <Badge tone="red">已回滚</Badge>}
                    </button>
                  ))}
                  {!contract.snapshots.length && (
                    <p className="py-8 text-center text-sm text-slate-500">尚无发布快照。</p>
                  )}
                </CardContent>
              </Card>
              <div className="space-y-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>快照 v{selectedSnapshot.version}</CardTitle>
                      <p className="mt-1 whitespace-pre-line text-xs text-slate-500">
                        发布于 {formatDateTime(selectedSnapshot.releasedAt)} · 纳入{' '}
                        {selectedSnapshot.changes.length} 项变化
                        {selectedSnapshot.rollbackState
                          ? ` · 已于 ${formatDateTime(selectedSnapshot.rollbackState.rolledBackAt)} 回滚`
                          : ''}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => exportSnapshotReport(selectedSnapshot.id)}
                      >
                        <Download className="h-3.5 w-3.5" />
                        归档报告
                      </Button>
                      {!selectedSnapshot.rollbackState &&
                        contract.snapshots[0]?.id === selectedSnapshot.id && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setRollbackError('');
                              setRollbackTarget({
                                id: selectedSnapshot.id,
                                version: selectedSnapshot.version,
                              });
                            }}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            回滚此版
                          </Button>
                        )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <strong className="text-xs font-medium text-slate-700">本版调用方影响</strong>
                      <div className="mt-2 space-y-2">
                        {selectedSnapshot.consumerImpacts.map((impact) => (
                          <div
                            key={impact.consumerId}
                            className="rounded-md border border-slate-200 p-2 text-xs leading-5 text-slate-600"
                          >
                            {impact.summary}
                          </div>
                        ))}
                        {!selectedSnapshot.consumerImpacts.length && (
                          <p className="text-xs text-slate-400">该版无警告/不兼容级调用方影响。</p>
                        )}
                      </div>
                    </div>
                    <div className="overflow-hidden rounded-md border border-slate-200">
                      <DiffEditor
                        height="420px"
                        language="plaintext"
                        original={selectedSnapshot.openapi}
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
                暂无快照可比较。
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="report">
          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>变更报告预览（工作区合并视图）</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    Markdown 格式，已合并各窗口候选；归档版在「版本快照」内随版保留
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={exportReport}>
                  <Download className="h-3.5 w-3.5" />
                  导出报告
                </Button>
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
                  <ReportFact
                    icon={History}
                    label="历史快照报告"
                    value={`${contract.snapshots.length} 份可查`}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>归档报告入口</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {contract.snapshots.map((snapshot) => (
                    <button
                      key={snapshot.id}
                      type="button"
                      onClick={() => {
                        setActiveTab('history');
                        setSelectedSnapshotId(snapshot.id);
                      }}
                      className="flex w-full items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-xs hover:bg-slate-50"
                    >
                      <span>v{snapshot.version} 归档报告</span>
                      <span className="text-slate-400">{formatDateTime(snapshot.releasedAt)}</span>
                    </button>
                  ))}
                  {!contract.snapshots.length && (
                    <p className="text-xs text-slate-400">发布后每份快照都会附带归档报告。</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!rollbackTarget} onOpenChange={(open) => !open && setRollbackTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>回滚 v{rollbackTarget?.version} 这一版</DialogTitle>
            <DialogDescription>
              只会恢复该快照包含的变化与调用方影响，使其回到工作区继续评审；其他版本不受影响。
              快照与归档报告仍保留可查，并标记为已回滚。
            </DialogDescription>
          </DialogHeader>
          <label className="text-xs font-medium text-slate-700">回滚原因</label>
          <Textarea
            className="mt-1.5"
            value={rollbackReason}
            onChange={(event) => setRollbackReason(event.target.value)}
            placeholder="说明哪一项变化发错、影响范围和后续处理"
          />
          {rollbackError && <p className="mt-2 text-xs text-red-700">{rollbackError}</p>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRollbackTarget(null)}>
              取消
            </Button>
            <Button
              disabled={!rollbackReason.trim() || rollbackSnapshot.isPending}
              onClick={() => void confirmRollback()}
            >
              <RotateCcw className="h-4 w-4" />
              {rollbackSnapshot.isPending ? '回滚中' : '确认只回滚此版'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HeaderMetric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="min-w-24 bg-white px-4 py-3">
      <span className="text-[11px] text-slate-500">{label}</span>
      <strong className={danger ? 'mt-1 block text-red-700' : 'mt-1 block text-slate-900'}>
        {value}
      </strong>
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
