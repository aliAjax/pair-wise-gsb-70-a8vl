import { Link } from '@tanstack/react-router';
import { Archive, CheckCircle2, LockKeyhole, PackageCheck, RotateCcw, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { formatDateTime } from '../lib/utils';
import { validateForRelease } from '../models/contract';
import { useContracts, useFreezeVersion } from '../services/contract-queries';
import { useReviewStore } from '../store/review-store';

export function ReleasesPage() {
  const contracts = useContracts();
  const freezeVersion = useFreezeVersion();
  const selectedContractId = useReviewStore((state) => state.selectedContractId);
  const setSelectedContract = useReviewStore((state) => state.setSelectedContract);
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const selectedContract = (contracts.data ?? []).find(
    (contract) => contract.id === selectedContractId,
  );
  const selectedIssues = selectedContract ? validateForRelease(selectedContract) : [];
  const blockers = selectedIssues.filter((issue) => issue.severity === 'blocker').length;

  const snapshots = useMemo(
    () =>
      (contracts.data ?? [])
        .flatMap((contract) =>
          contract.snapshots.map((snapshot) => ({ contract, snapshot })),
        )
        .sort(
          (left, right) =>
            new Date(right.snapshot.releasedAt).getTime() -
            new Date(left.snapshot.releasedAt).getTime(),
        ),
    [contracts.data],
  );

  async function freeze() {
    if (!selectedContract || !version.trim() || blockers) return;
    setError('');
    try {
      await freezeVersion.mutateAsync({
        contractId: selectedContract.id,
        version: version.trim(),
        notes: notes.trim() || '契约兼容性评审完成，发布独立快照。',
      });
      setVersion('');
      setNotes('');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '发布失败');
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Release Center</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950 sm:text-3xl">
          契约候选发布
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          编辑与发布已拆分为候选：不同窗口的字段补充自动合并、冲突人工选择。发布只收集已接受且说明齐全、基线未过期的变化，每次发布留存独立快照并支持按版回滚。
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>发布快照记录</CardTitle>
            <p className="mt-1 text-xs text-slate-500">{snapshots.length} 个独立快照（含已回滚）</p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">契约</th>
                    <th className="px-4 py-3 font-medium">版本</th>
                    <th className="px-4 py-3 font-medium">发布时间</th>
                    <th className="px-4 py-3 font-medium">纳入变化</th>
                    <th className="px-4 py-3 font-medium">校验值</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map(({ contract, snapshot }) => (
                    <tr key={snapshot.id} className="border-t border-slate-100">
                      <td className="px-4 py-4">
                        <div className="font-medium">{contract.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{contract.domain}</div>
                      </td>
                      <td className="px-4 py-4">
                        <Badge tone="slate">v{snapshot.version}</Badge>
                      </td>
                      <td className="px-4 py-4 text-slate-600">
                        {formatDateTime(snapshot.releasedAt)}
                      </td>
                      <td className="px-4 py-4 text-slate-600">
                        {snapshot.changes.length} 项
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-slate-600">
                        {snapshot.checksum}
                      </td>
                      <td className="px-4 py-4">
                        {snapshot.rollbackState ? (
                          <Badge tone="red">
                            <RotateCcw className="mr-1 h-3 w-3" />
                            已回滚
                          </Badge>
                        ) : (
                          <Badge tone="green">生效中</Badge>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Link
                          to="/contracts/$contractId"
                          params={{ contractId: contract.id }}
                          className="text-xs font-medium text-sky-800 hover:underline"
                        >
                          查看快照
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!snapshots.length && (
                <p className="px-4 py-16 text-center text-sm text-slate-500">
                  尚无发布快照。
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>选择发布候选</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                发布门禁实时检查：基线过期、未解决冲突、说明不齐都会阻断
              </p>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedContractId}
                onValueChange={(value) => {
                  setSelectedContract(value);
                  const contract = (contracts.data ?? []).find((item) => item.id === value);
                  if (contract) setVersion(suggestVersion(contract.version));
                  setError('');
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择一个契约" />
                </SelectTrigger>
                <SelectContent>
                  {(contracts.data ?? []).map((contract) => (
                    <SelectItem key={contract.id} value={contract.id}>
                      {contract.name} · v{contract.version} · 基线 {contract.baselineLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedContract && (
                <div className="mt-4">
                  <div
                    className={
                      blockers
                        ? 'flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3'
                        : 'flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3'
                    }
                  >
                    {blockers ? (
                      <TriangleAlert className="mt-0.5 h-4 w-4 text-red-700" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-700" />
                    )}
                    <div>
                      <strong className="text-sm">
                        {blockers ? `${blockers} 个阻断项` : '发布门禁通过'}
                      </strong>
                      <p className="mt-1 text-xs leading-5 text-slate-600">
                        {blockers
                          ? '先解决冲突、同步过期基线，并补齐已接受变化的影响与迁移说明。'
                          : '可以发布独立快照；未完成评审的变化保留在工作区不进入本版。'}
                      </p>
                    </div>
                  </div>

                  <label className="mt-4 block text-xs font-medium text-slate-700">新版本号</label>
                  <Input
                    className="mt-1.5"
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                    placeholder="2.9.0"
                  />
                  <label className="mt-4 block text-xs font-medium text-slate-700">发布说明</label>
                  <Textarea
                    className="mt-1.5"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="版本变化、兼容层和调用方升级状态"
                  />
                  {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
                  <Button
                    className="mt-4 w-full"
                    disabled={!!blockers || !version.trim() || freezeVersion.isPending}
                    onClick={() => void freeze()}
                  >
                    <LockKeyhole className="h-4 w-4" />
                    {freezeVersion.isPending ? '发布中' : '发布独立快照'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>候选与快照策略</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-600">
              <Policy icon={Archive} text="每个窗口携带基线标识，基线过期会被发布门禁挡住。" />
              <Policy icon={PackageCheck} text="只发布已接受且影响、迁移说明齐全的变化。" />
              <Policy icon={RotateCcw} text="回滚一次只恢复该快照的变化与调用方影响，旧版与报告仍可查。" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function suggestVersion(current: string): string {
  const parts = current.split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return current;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
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
