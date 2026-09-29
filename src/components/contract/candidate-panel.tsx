import { GitMerge, History, Send, Trash2, TriangleAlert } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import type { Candidate } from '../../models/candidate';

interface CandidatePanelProps {
  candidate?: Candidate;
  latestBaselineId: string;
  dirty: boolean;
  submitting: boolean;
  starting: boolean;
  rebasing: boolean;
  onStart: () => void;
  onCommit: () => void;
  onRebase: () => void;
  onDiscard: () => void;
}

const STATUS_TONE: Record<Candidate['status'], 'blue' | 'red' | 'green' | 'slate'> = {
  open: 'blue',
  conflict: 'red',
  merged: 'green',
  discarded: 'slate',
};
const STATUS_LABEL: Record<Candidate['status'], string> = {
  open: '编辑中',
  conflict: '冲突待解决',
  merged: '已合并提交',
  discarded: '已丢弃',
};

export function CandidatePanel({
  candidate,
  latestBaselineId,
  dirty,
  submitting,
  starting,
  rebasing,
  onStart,
  onCommit,
  onRebase,
  onDiscard,
}: CandidatePanelProps) {
  if (!candidate) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
        <p className="text-sm text-slate-600">当前窗口还没有编辑候选。</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          发起候选会锁定当前基线标识，之后在差异评审里补充的内容都只属于这个窗口，
          提交时按字段与其他窗口的提交自动合并。
        </p>
        <Button className="mt-4" disabled={starting} onClick={onStart}>
          从当前基线发起编辑候选
        </Button>
      </div>
    );
  }

  const stale = candidate.baselineId !== latestBaselineId;
  const finished = candidate.status === 'merged' || candidate.status === 'discarded';

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
        <strong className="text-sm text-slate-900">{candidate.windowLabel} 的候选</strong>
        <Badge tone={STATUS_TONE[candidate.status]}>{STATUS_LABEL[candidate.status]}</Badge>
        <span className="font-mono text-[10px] text-slate-400">{candidate.id}</span>
        {stale && (
          <Badge tone="amber">
            基线过期（{candidate.baselineId.slice(0, 8)} → {latestBaselineId.slice(0, 8)}）
          </Badge>
        )}
      </div>

      <div className="space-y-3 px-4 py-3 text-xs text-slate-600">
        <div>作者：{candidate.author}</div>
        <div>字段草稿：{candidate.fieldEdits.filter((e) => e.value !== e.base).length} 处</div>
        {candidate.openApiEdit && candidate.openApiEdit.value !== candidate.openApiEdit.base && (
          <div>OpenAPI 定义：已修改</div>
        )}
        {stale && candidate.status === 'open' && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              其他窗口已经提交，基线已推进。直接提交会做三方合并：不同字段的补充自动保留，同一字段两边都改才需要人工选择。
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
        {!finished && (
          <Button size="sm" disabled={!dirty || submitting} onClick={onCommit}>
            <Send className="h-3.5 w-3.5" />
            {submitting ? '提交合并中' : '提交候选'}
          </Button>
        )}
        {stale && !finished && (
          <Button size="sm" variant="secondary" disabled={rebasing} onClick={onRebase}>
            <GitMerge className="h-3.5 w-3.5" />
            变基到最新
          </Button>
        )}
        {!finished && (
          <Button size="sm" variant="ghost" onClick={onDiscard}>
            <Trash2 className="h-3.5 w-3.5" />
            丢弃
          </Button>
        )}
        {finished && (
          <Button size="sm" variant="secondary" onClick={onStart} disabled={starting}>
            基于最新基线再发起候选
          </Button>
        )}
      </div>

      <div className="border-t border-slate-100 px-4 py-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <History className="h-3.5 w-3.5" />
          合并时间线
        </div>
        <ol className="mt-2 space-y-2">
          {candidate.history.slice(-6).map((entry, index) => (
            <li key={index} className="flex gap-2 text-xs leading-5 text-slate-600">
              <span
                className={
                  entry.tone === 'conflict'
                    ? 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500'
                    : entry.tone === 'merge' || entry.tone === 'success'
                      ? 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500'
                      : entry.tone === 'discard'
                        ? 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400'
                        : 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500'
                }
              />
              <span>{entry.message}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
