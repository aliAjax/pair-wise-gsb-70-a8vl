import { GitMerge, User } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  MERGEABLE_FIELD_LABELS,
  type ApiContract,
  type ChangeCandidate,
  type FieldConflict,
} from '../../models/contract';
import { formatDateTime } from '../../lib/utils';

interface ConflictCardProps {
  contract: ApiContract;
  conflict: FieldConflict;
  path: string;
  method: string;
  onResolve: (keepCandidateId: string) => void;
  resolving: boolean;
}

export function ConflictCard({
  contract,
  conflict,
  path,
  method,
  onResolve,
  resolving,
}: ConflictCardProps) {
  const candidates = conflict.candidateIds
    .map((id) => contract.candidates.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is ChangeCandidate => Boolean(candidate));

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <GitMerge className="h-4 w-4 text-red-700" />
        <strong className="text-sm text-red-900">
          {MERGEABLE_FIELD_LABELS[conflict.field]}存在冲突
        </strong>
        <Badge tone="red">{method} {path}</Badge>
      </div>
      <p className="mt-1 text-xs leading-5 text-red-800">
        多个窗口对同一字段给出了不同取值，已同时保留双方内容与来源，请选择本字段最终保留的版本。
      </p>

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {candidates.map((candidate) => (
          <div
            key={candidate.id}
            className="rounded-md border border-red-200 bg-white p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <User className="h-3.5 w-3.5" />
                {candidate.windowLabel} · {candidate.author}
              </div>
              <span className="text-[10px] text-slate-400">
                {formatDateTime(candidate.submittedAt)}
              </span>
            </div>
            {candidate.baselineId !== contract.baselineId && (
              <Badge className="mt-1" tone="amber">
                基于旧基线 {candidate.baselineLabel}
              </Badge>
            )}
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-xs leading-5 text-slate-700">
              {candidate.value}
            </pre>
            <Button
              className="mt-2 w-full"
              size="sm"
              variant="secondary"
              disabled={resolving}
              onClick={() => onResolve(candidate.id)}
            >
              保留这一版
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-2 text-[11px] text-slate-500">
        冲突未解决前该字段回退显示基线值，并且发布会被门禁阻断，避免误覆盖任一方的补充。
      </div>
    </div>
  );
}
