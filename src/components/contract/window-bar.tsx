import { GitBranch, MonitorSmartphone, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import type { Candidate } from '../../models/candidate';
import { useReviewStore, type ReviewWindow } from '../../store/review-store';

interface WindowBarProps {
  contractBaselineId: string;
  /** 每个窗口的开放/冲突候选（若有） */
  candidatesByWindow: Record<string, Candidate | undefined>;
}

export function WindowBar({ contractBaselineId, candidatesByWindow }: WindowBarProps) {
  const windows = useReviewStore((state) => state.windows);
  const activeWindowId = useReviewStore((state) => state.activeWindowId);
  const setActiveWindow = useReviewStore((state) => state.setActiveWindow);
  const updateWindow = useReviewStore((state) => state.updateWindow);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
        <MonitorSmartphone className="h-4 w-4 text-sky-800" />
        <span className="text-sm font-semibold text-slate-800">评审窗口</span>
        <span className="text-xs text-slate-500">
          两个窗口从同一基线各自起稿，模拟两个人同时打开同一份接口评审
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-500">
          <GitBranch className="h-3.5 w-3.5" />
          已提交基线 {contractBaselineId.slice(0, 10)}
        </span>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2">
        {windows.map((window) => (
          <WindowCard
            key={window.id}
            window={window}
            active={window.id === activeWindowId}
            candidate={candidatesByWindow[window.id]}
            contractBaselineId={contractBaselineId}
            editing={editingId === window.id}
            onActivate={() => setActiveWindow(window.id)}
            onStartEdit={() => setEditingId(window.id)}
            onRename={(patch) => {
              updateWindow(window.id, patch);
              setEditingId(null);
            }}
          />
        ))}
      </div>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-lg border border-slate-200 bg-white shadow-sm">{children}</section>;
}

function WindowCard({
  window,
  active,
  candidate,
  contractBaselineId,
  editing,
  onActivate,
  onStartEdit,
  onRename,
}: {
  window: ReviewWindow;
  active: boolean;
  candidate?: Candidate;
  contractBaselineId: string;
  editing: boolean;
  onActivate: () => void;
  onStartEdit: () => void;
  onRename: (patch: Partial<ReviewWindow>) => void;
}) {
  const [label, setLabel] = useState(window.label);
  const [author, setAuthor] = useState(window.author);
  const stale = candidate ? candidate.baselineId !== contractBaselineId : false;

  return (
    <button
      type="button"
      onClick={onActivate}
      className={cn(
        'rounded-md border p-3 text-left transition-colors',
        active
          ? 'border-sky-400 bg-sky-50 ring-1 ring-sky-300'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <strong className="text-sm text-slate-900">{window.label}</strong>
          {active && <Badge tone="blue">当前窗口</Badge>}
        </div>
        {editing ? (
          <span
            role="textbox"
            tabIndex={0}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex"
          >
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onRename({ label: label.trim() || window.label, author: author.trim() || window.author })}
            >
              完成
            </Button>
          </span>
        ) : (
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              setLabel(window.label);
              setAuthor(window.author);
              onStartEdit();
            }}
            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-sky-800"
          >
            <Pencil className="h-3 w-3" />
            改名称
          </span>
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2" onClick={(event) => event.stopPropagation()}>
          <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="窗口名称" />
          <Input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="作者" />
        </div>
      ) : (
        <p className="mt-1 text-xs text-slate-500">作者：{window.author}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {candidate ? (
          <>
            <Badge tone={candidate.status === 'conflict' ? 'red' : stale ? 'amber' : 'blue'}>
              {candidate.status === 'conflict'
                ? '有冲突待解决'
                : stale
                  ? '基线已过期'
                  : '候选编辑中'}
            </Badge>
            <span className="font-mono text-[10px] text-slate-400">
              候选基线 {candidate.baselineId.slice(0, 10)}
            </span>
          </>
        ) : (
          <Badge tone="neutral">无开放候选，与基线一致</Badge>
        )}
      </div>
    </button>
  );
}
