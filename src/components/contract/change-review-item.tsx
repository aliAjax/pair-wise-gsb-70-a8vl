import { Check, CornerUpLeft, Layers3, Lock, Save } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import {
  CHANGE_KIND_LABELS,
  type ContractChange,
  type FieldProvenance,
  type ReviewState,
} from '../../models/contract';
import type { MergeableField } from '../../models/candidate';
import { CompatibilityBadge, ReviewStateBadge } from './compatibility-badge';

interface ChangeReviewItemProps {
  change: ContractChange;
  /** 当前窗口是否有开放候选；没有时说明字段只读，避免直接覆盖已提交副本 */
  canDraft: boolean;
  draftImpact: string;
  draftMigration: string;
  onDraftChange: (changeId: string, field: MergeableField, value: string) => void;
  onReview: (changeId: string, state: ReviewState, comment: string) => void;
  onExemption: (changeId: string, reason: string) => void;
}

export function ChangeReviewItem({
  change,
  canDraft,
  draftImpact,
  draftMigration,
  onDraftChange,
  onReview,
  onExemption,
}: ChangeReviewItemProps) {
  const [comment, setComment] = useState(change.reviewComment);
  const [exemptionReason, setExemptionReason] = useState('');
  const [showExemption, setShowExemption] = useState(false);

  return (
    <article className="border-b border-slate-200 px-4 py-4 last:border-0">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-sky-900">
              {change.method} {change.path}
            </span>
            <CompatibilityBadge value={change.compatibility} />
            <ReviewStateBadge value={change.reviewState} />
            {change.releasedInVersion && <Badge tone="slate">已随 v{change.releasedInVersion} 发布</Badge>}
          </div>
          <h3 className="mt-2 text-sm font-semibold text-slate-900">
            {CHANGE_KIND_LABELS[change.kind]}
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            {change.rationale}
          </p>
        </div>
        <div className="text-left text-xs text-slate-500 lg:text-right">
          <div>评审人：{change.reviewer || '未指定'}</div>
          <div className="mt-1">结论：{change.reviewComment || '尚无意见'}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            变更前
          </span>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-xs leading-5 text-slate-700">
            {change.before}
          </pre>
        </div>
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
            变更后
          </span>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-xs leading-5 text-sky-950">
            {change.after}
          </pre>
        </div>
      </div>

      {change.compatibility !== 'compatible' && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <DraftField
            label="调用方影响说明"
            placeholder="受影响调用方、版本、流量和业务影响"
            value={draftImpact}
            provenance={change.impactProvenance}
            canDraft={canDraft}
            onChange={(value) => onDraftChange(change.id, 'impactStatement', value)}
          />
          <DraftField
            label="迁移方案"
            placeholder="升级顺序、兼容层范围、回滚和截止时间"
            value={draftMigration}
            provenance={change.migrationProvenance}
            canDraft={canDraft}
            onChange={(value) => onDraftChange(change.id, 'migrationPlan', value)}
          />
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 xl:flex-row xl:items-end">
        <div className="min-w-0 flex-1">
          <label className="mb-1.5 block text-xs font-medium text-slate-700">评审意见</label>
          <Textarea
            className="min-h-16"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="说明接受、退回或豁免的依据"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onReview(change.id, 'returned', comment || '需要补充影响说明')}
          >
            <CornerUpLeft className="h-3.5 w-3.5" />
            退回
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowExemption((value) => !value)}
          >
            <Layers3 className="h-3.5 w-3.5" />
            申请兼容层
          </Button>
          <Button
            size="sm"
            onClick={() => onReview(change.id, 'accepted', comment || '影响和迁移方案已确认')}
          >
            <Check className="h-3.5 w-3.5" />
            接受
          </Button>
        </div>
      </div>

      {showExemption && (
        <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">兼容层豁免</Badge>
            <span className="text-xs text-blue-900">期限 30 天，发布报告保留记录</span>
          </div>
          <Textarea
            className="mt-3 bg-white"
            value={exemptionReason}
            onChange={(event) => setExemptionReason(event.target.value)}
            placeholder="说明为什么不能立即移除不兼容变化"
          />
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              disabled={!exemptionReason.trim()}
              onClick={() => {
                onExemption(change.id, exemptionReason);
                setExemptionReason('');
                setShowExemption(false);
              }}
            >
              登记豁免
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

function DraftField({
  label,
  placeholder,
  value,
  provenance,
  canDraft,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  provenance?: FieldProvenance;
  canDraft: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <label className="text-xs font-medium text-slate-700">{label}</label>
        {provenance && (
          <span className="inline-flex items-center gap-1 rounded-sm bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
            <Save className="h-3 w-3" />
            {provenance.source}
          </span>
        )}
      </div>
      <Textarea
        value={value}
        disabled={!canDraft}
        onChange={(event) => onChange(event.target.value)}
        placeholder={canDraft ? placeholder : '先在“协作候选”里为当前窗口发起候选，再补充说明'}
      />
      {!canDraft && (
        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-700">
          <Lock className="h-3 w-3" />
          未发起候选时只读，防止覆盖其他窗口刚提交的内容
        </p>
      )}
    </div>
  );
}
