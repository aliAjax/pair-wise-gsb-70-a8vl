import { FileText, History, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Textarea } from '../ui/textarea';
import type { ContractVersion } from '../../models/contract';

interface VersionActionsProps {
  version: ContractVersion;
  rollingBack: boolean;
  onRollback: (reason: string) => void;
}

export function VersionActions({ version, rollingBack, onRollback }: VersionActionsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (version.status === 'rolled_back') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="slate">已回滚</Badge>
        <Button size="sm" variant="ghost" onClick={() => setReportOpen(true)}>
          <FileText className="h-3.5 w-3.5" />
          查看发布报告
        </Button>
        <Dialog open={reportOpen} onOpenChange={setReportOpen}>
          <SnapshotReportDialog version={version} />
        </Dialog>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setReportOpen(true)}>
          <FileText className="h-3.5 w-3.5" />
          快照报告
        </Button>
        <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)}>
          <Undo2 className="h-3.5 w-3.5" />
          回滚此快照
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>回滚 v{version.version} 发布快照</DialogTitle>
            <DialogDescription>
              只会恢复该快照收集的 {version.changeIds.length} 项变化与调用方影响，
              把它们重新打回评审工作副本；其他快照、旧版本定义和报告记录都保留可查，不需要整版撤回。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-700">回滚原因（记入快照）</label>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如：枚举扩展在生产触发调用方解析异常，先恢复并补充兜底方案"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!reason.trim() || rollingBack}
              onClick={() => {
                onRollback(reason.trim());
                setReason('');
                setConfirmOpen(false);
              }}
            >
              <History className="h-4 w-4" />
              {rollingBack ? '回滚中' : '确认只回滚该快照'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <SnapshotReportDialog version={version} />
      </Dialog>
    </>
  );
}

function SnapshotReportDialog({ version }: { version: ContractVersion }) {
  return (
    <DialogContent className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>
          v{version.version} 发布报告 {version.status === 'rolled_back' && '（已回滚存档）'}
        </DialogTitle>
        <DialogDescription>
          发布于 {new Date(version.releasedAt).toLocaleString('zh-CN')} · 快照校验值 {version.checksum}
        </DialogDescription>
      </DialogHeader>
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-4 font-mono text-[11px] leading-5 text-slate-100">
        {version.report || '该历史版本生成于报告归档能力上线前，无独立报告。'}
      </pre>
    </DialogContent>
  );
}
