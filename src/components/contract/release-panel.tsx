import {
  CheckCircle2,
  Clock3,
  FileWarning,
  GitBranch,
  LockKeyhole,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import type { ApiContract } from '../../models/contract';
import { evaluateRelease } from '../../models/contract';
import type { Candidate } from '../../models/candidate';

interface ReleasePanelProps {
  contract: ApiContract;
  /** 发起发布窗口所基于的基线；若与最新基线不同，发布被挡住 */
  windowBaselineId: string;
  candidates: Candidate[];
  publishing: boolean;
  onPublish: (input: { version: string; notes: string; consumerImpactSummary: string }) => void;
}

export function ReleasePanel({
  contract,
  windowBaselineId,
  candidates,
  publishing,
  onPublish,
}: ReleasePanelProps) {
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [impactSummary, setImpactSummary] = useState('');

  const evaluation = useMemo(
    () =>
      evaluateRelease({
        contract,
        baselineId: windowBaselineId,
        activeCandidates: candidates
          .filter((candidate) => candidate.status === 'open' || candidate.status === 'conflict')
          .map((candidate) => ({
            id: candidate.id,
            windowId: candidate.windowLabel,
            baselineId: candidate.baselineId,
            status: candidate.status,
          })),
      }),
    [contract, windowBaselineId, candidates],
  );
  const blockers = evaluation.issues.filter((issue) => issue.severity === 'blocker');
  const warnings = evaluation.issues.filter((issue) => issue.severity === 'warning');

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>本次发布收集的变化</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              发布不再整份冻结：只把已接受（含兼容层豁免）且说明齐全的变化收进独立快照，其余留在工作副本。
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {evaluation.changeInfos.map((info) => (
              <div
                key={info.change.id}
                className="flex flex-col gap-1 border-b border-slate-100 px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-mono text-xs font-semibold text-slate-800">
                    {info.change.method} {info.change.path}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">{info.reason}</div>
                </div>
                <Badge tone={info.included ? 'green' : 'slate'}>
                  {info.included ? '进入本次快照' : '留在工作副本'}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>发布门禁</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              {blockers.length} 个阻断项，{warnings.length} 个警告
            </p>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-800" />
              <span>
                当前窗口基线 {windowBaselineId.slice(0, 10)}
                {windowBaselineId === contract.baselineId
                  ? '，与已提交基线一致。'
                  : `，已落后于最新基线 ${contract.baselineId.slice(0, 10)}，请先刷新窗口/处理候选。`}
              </span>
            </div>
            {evaluation.issues.map((issue) => (
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
            {!evaluation.issues.length && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <CheckCircle2 className="h-4 w-4" />
                已接受变化说明齐全，基线有效且无冲突候选，可以冻结本次发布快照。
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>冻结发布快照</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            每次发布生成独立快照与报告；回滚只恢复该快照的变化与调用方影响，旧版本和报告仍可查。
          </p>
        </CardHeader>
        <CardContent>
          <label className="text-xs font-medium text-slate-700">版本号</label>
          <Input
            className="mt-1.5"
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            placeholder="例如 2.9.0"
          />
          <label className="mt-4 block text-xs font-medium text-slate-700">发布说明</label>
          <Textarea
            className="mt-1.5"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="说明本次收集的接口变化、兼容层和调用方升级状态"
          />
          <label className="mt-4 block text-xs font-medium text-slate-700">
            调用方影响摘要（写入快照，回滚时按快照恢复）
          </label>
          <Textarea
            className="mt-1.5"
            value={impactSummary}
            onChange={(event) => setImpactSummary(event.target.value)}
            placeholder="例如：生产 3 个调用方已完成灰度，兼容层保留 30 天"
          />
          <Button
            className="mt-4 w-full"
            disabled={!evaluation.canRelease || !version.trim() || publishing}
            onClick={() => {
              onPublish({ version: version.trim(), notes: notes.trim(), consumerImpactSummary: impactSummary });
              setVersion('');
              setNotes('');
              setImpactSummary('');
            }}
          >
            <LockKeyhole className="h-4 w-4" />
            {publishing ? '冻结中' : '确认发布并冻结快照'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
