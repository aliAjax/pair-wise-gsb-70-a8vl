import { Link } from '@tanstack/react-router';
import { Archive, CheckCircle2, LockKeyhole, PackageCheck, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ReleasePanel } from '../components/contract/release-panel';
import { VersionActions } from '../components/contract/version-actions';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { formatDateTime } from '../lib/utils';
import { evaluateRelease } from '../models/contract';
import { ReleaseGateError } from '../services/contract-service';
import {
  useCandidates,
  useContracts,
  usePublishVersion,
  useRollbackVersion,
} from '../services/contract-queries';
import { useReviewStore } from '../store/review-store';

export function ReleasesPage() {
  const contracts = useContracts();
  const candidatesQuery = useCandidates();
  const publishVersion = usePublishVersion();
  const rollbackVersion = useRollbackVersion();
  const selectedContractId = useReviewStore((state) => state.selectedContractId);
  const setSelectedContract = useReviewStore((state) => state.setSelectedContract);
  const activeWindowId = useReviewStore((state) => state.activeWindowId);
  const windows = useReviewStore((state) => state.windows);
  const [error, setError] = useState('');

  const selectedContract = (contracts.data ?? []).find(
    (contract) => contract.id === selectedContractId,
  );
  const contractCandidates = useMemo(
    () => (candidatesQuery.data ?? []).filter((candidate) => candidate.contractId === selectedContractId),
    [candidatesQuery.data, selectedContractId],
  );
  const windowCandidate = contractCandidates.find(
    (candidate) =>
      candidate.windowId === activeWindowId &&
      (candidate.status === 'open' || candidate.status === 'conflict'),
  );

  const evaluation = selectedContract
    ? evaluateRelease({
        contract: selectedContract,
        baselineId: windowCandidate?.baselineId ?? selectedContract.baselineId,
        activeCandidates: contractCandidates
          .filter((candidate) => candidate.status === 'open' || candidate.status === 'conflict')
          .map((candidate) => ({
            id: candidate.id,
            windowId: candidate.windowLabel,
            baselineId: candidate.baselineId,
            status: candidate.status,
          })),
      })
    : undefined;
  const blockers = evaluation?.issues.filter((issue) => issue.severity === 'blocker').length ?? 0;

  const versions = useMemo(
    () =>
      (contracts.data ?? [])
        .flatMap((contract) => contract.versions.map((release) => ({ contract, release })))
        .sort(
          (left, right) =>
            new Date(right.release.releasedAt).getTime() -
            new Date(left.release.releasedAt).getTime(),
        ),
    [contracts.data],
  );

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Release Center</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950 sm:text-3xl">契约版本发布</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          发布按变化收集：只有已接受且说明齐全的变化进入独立快照。窗口基线过期、字段冲突未解决或仍有开放候选时发布被挡住；
          回滚一次只恢复对应快照的变化与调用方影响，旧版本和报告记录始终保留。
        </p>
        <p className="mt-1 text-xs text-slate-500">
          当前发起窗口：{windows.find((window) => window.id === activeWindowId)?.label ?? activeWindowId}
        </p>
      </div>

      <div className="mb-4">
        <Card>
          <CardHeader>
            <CardTitle>选择发布候选</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              门禁以当前窗口看到的基线为准，过期基线必须先处理候选或切换窗口
            </p>
          </CardHeader>
          <CardContent>
            <Select value={selectedContractId} onValueChange={setSelectedContract}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择一个契约" />
              </SelectTrigger>
              <SelectContent>
                {(contracts.data ?? []).map((contract) => (
                  <SelectItem key={contract.id} value={contract.id}>
                    {contract.name} · v{contract.version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedContract && evaluation && (
              <div className="mt-3">
                <div
                  className={
                    blockers
                      ? 'flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3'
                      : 'flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3'
                  }
                >
                  {blockers ? (
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                  )}
                  <div>
                    <strong className="text-sm">
                      {blockers ? `${blockers} 个阻断项` : '发布门禁通过'}
                    </strong>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {blockers
                        ? `${evaluation.issues.find((issue) => issue.severity === 'blocker')?.title}：${evaluation.issues.find((issue) => issue.severity === 'blocker')?.detail}`
                        : `本次将收集 ${evaluation.includedChanges.length} 项已接受变化。`}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedContract && (
        <div className="mb-6">
          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </div>
          )}
          <ReleasePanel
            contract={selectedContract}
            windowBaselineId={windowCandidate?.baselineId ?? selectedContract.baselineId}
            candidates={contractCandidates}
            publishing={publishVersion.isPending}
            onPublish={async (input) => {
              setError('');
              try {
                await publishVersion.mutateAsync({
                  contractId: selectedContract.id,
                  version: input.version,
                  notes: input.notes,
                  consumerImpactSummary: input.consumerImpactSummary,
                  baselineId: windowCandidate?.baselineId ?? selectedContract.baselineId,
                });
              } catch (publishError) {
                setError(
                  publishError instanceof ReleaseGateError
                    ? `发布被挡住：${publishError.message}`
                    : '发布失败，请重试',
                );
              }
            }}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>发布快照记录</CardTitle>
          <p className="mt-1 text-xs text-slate-500">{versions.length} 个发布快照</p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">契约</th>
                  <th className="px-4 py-3 font-medium">版本</th>
                  <th className="px-4 py-3 font-medium">收集变化</th>
                  <th className="px-4 py-3 font-medium">发布时间</th>
                  <th className="px-4 py-3 font-medium">校验值</th>
                  <th className="px-4 py-3 font-medium">状态/操作</th>
                </tr>
              </thead>
              <tbody>
                {versions.map(({ contract, release }) => (
                  <tr key={release.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-4">
                      <Link
                        to="/contracts/$contractId"
                        params={{ contractId: contract.id }}
                        className="font-medium text-sky-900 hover:underline"
                      >
                        {contract.name}
                      </Link>
                      <div className="mt-1 text-xs text-slate-500">{contract.domain}</div>
                    </td>
                    <td className="px-4 py-4">
                      <Badge tone="slate">v{release.version}</Badge>
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-600">
                      {release.changeIds.length} 项
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-600">
                      {formatDateTime(release.releasedAt)}
                      <div className="font-mono text-[10px] text-slate-400">
                        {release.baselineId?.slice(0, 10) ?? '—'}
                      </div>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs text-slate-600">
                      {release.checksum}
                    </td>
                    <td className="px-4 py-4">
                      <VersionActions
                        version={release}
                        rollingBack={rollbackVersion.isPending}
                        onRollback={(reason) =>
                          void rollbackVersion.mutateAsync({
                            contractId: contract.id,
                            versionId: release.id,
                            reason,
                          })
                        }
                      />
                      {release.status === 'rolled_back' && release.rollbackReason && (
                        <p className="mt-2 max-w-xs text-[11px] leading-4 text-slate-500">
                          {release.rollbackReason}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!versions.length && (
              <p className="px-4 py-16 text-center text-sm text-slate-500">尚无发布快照。</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>冻结与回滚策略</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-slate-600 md:grid-cols-3">
          <Policy icon={Archive} text="每次发布生成包含变化副本、调用方影响与报告的独立快照。" />
          <Policy icon={PackageCheck} text="回滚只恢复该快照的范围，其他快照与旧版本报告仍可查。" />
          <Policy icon={LockKeyhole} text="基线过期、字段冲突或开放候选未处理时，发布会被挡住。" />
        </CardContent>
      </Card>
    </div>
  );
}

function Policy({
  icon: Icon,
  text,
}: {
  icon: typeof Archive;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-sky-800" />
      <span>{text}</span>
    </div>
  );
}
