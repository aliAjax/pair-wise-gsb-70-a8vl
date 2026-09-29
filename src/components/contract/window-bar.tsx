import { Plus, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import type { ApiContract } from '../../models/contract';
import type { EditWindow } from '../../store/review-store';

interface WindowBarProps {
  contract: ApiContract;
  windows: EditWindow[];
  activeWindow: EditWindow | undefined;
  onSelectWindow: (windowId: string) => void;
  onAddWindow: (label: string, author: string) => void;
  onRemoveWindow: (windowId: string) => void;
  onAuthorChange: (author: string) => void;
  onSyncBaseline: () => void;
  syncing: boolean;
}

export function WindowBar({
  contract,
  windows,
  activeWindow,
  onSelectWindow,
  onAddWindow,
  onRemoveWindow,
  onAuthorChange,
  onSyncBaseline,
  syncing,
}: WindowBarProps) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [author, setAuthor] = useState('');

  // 当前激活窗口是否还停留在过期基线上（它名下有携带旧基线的候选）
  const stale = activeWindow
    ? contract.candidates.some(
        (candidate) =>
          candidate.windowId === activeWindow.id &&
          candidate.baselineId !== contract.baselineId,
      )
    : false;

  return (
    <CardShell>
      <div className="flex flex-wrap items-center gap-2">
        {windows.map((window) => {
          const isActive = activeWindow?.id === window.id;
          const windowStale = contract.candidates.some(
            (candidate) =>
              candidate.windowId === window.id &&
              candidate.baselineId !== contract.baselineId,
          );
          return (
            <button
              key={window.id}
              type="button"
              onClick={() => onSelectWindow(window.id)}
              className={
                isActive
                  ? 'flex items-center gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-900'
                  : 'flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50'
              }
            >
              {window.label}
              {windowStale && <Badge tone="amber">基线过期</Badge>}
              {windows.length > 1 && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`关闭 ${window.label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveWindow(window.id);
                  }}
                  className="text-slate-400 hover:text-red-600"
                >
                  <X className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
        <Button size="sm" variant="ghost" onClick={() => setAdding((value) => !value)}>
          <Plus className="h-3.5 w-3.5" />
          新窗口
        </Button>
      </div>

      {adding && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-500">窗口名</label>
            <Input
              className="h-8 w-32 text-xs"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="例如 窗口 2"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-500">作者</label>
            <Input
              className="h-8 w-40 text-xs"
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              placeholder="本窗口补充内容的来源"
            />
          </div>
          <Button
            size="sm"
            onClick={() => {
              onAddWindow(label, author);
              setLabel('');
              setAuthor('');
              setAdding(false);
            }}
          >
            从当前基线开新窗口
          </Button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs text-slate-600">
        <Badge tone="slate">基线 {contract.baselineLabel}</Badge>
        {activeWindow && (
          <div className="flex items-center gap-2">
            <span>本窗口作者</span>
            <Input
              className="h-7 w-40 text-xs"
              value={activeWindow.author}
              onChange={(event) => onAuthorChange(event.target.value)}
            />
          </div>
        )}
        {stale && (
          <div className="flex items-center gap-2">
            <Badge tone="red">基线已过期</Badge>
            <Button size="sm" variant="secondary" disabled={syncing} onClick={onSyncBaseline}>
              <RefreshCw className="h-3.5 w-3.5" />
              {syncing ? '同步中' : '同步到最新基线后重新提交'}
            </Button>
          </div>
        )}
        <span className="text-slate-400">
          各窗口从同一基线开始；不同字段的补充自动合并，同字段不同取值保留双方供选择。
        </span>
      </div>
    </CardShell>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-4">{children}</div>;
}
