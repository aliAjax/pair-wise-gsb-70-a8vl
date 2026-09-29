import { Check, CornerUpLeft, Layers3, Save } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import {
  CHANGE_KIND_LABELS,
  type ApiContract,
  type ContractChange,
  type FieldConflict,
  type MergeableField,
  type ReviewState,
} from '../../models/contract';
import { CompatibilityBadge, ReviewStateBadge } from './compatibility-badge';
import { ConflictCard } from './conflict-card';

interface ChangeReviewItemProps {
  contract: ApiContract;
  change: ContractChange;
  /** 当前激活窗口在该字段上的草稿初值（来自它自己已提交的候选）。 */
  activeWindowId: string;
  activeWindowLabel: string;
  onSubmitField: (changeId: string, field: MergeableField, value: string) => void;
  onReview: (changeId: string, state: ReviewState, comment: string) => void;
  onExemption: (changeId: string, reason: string) => void;
  onResolveConflict: (
    changeId: string,
    field: MergeableField,
    keepCandidateId: string,
  ) => void;
  resolving: boolean;
  submitting: boolean;
  /** 各字段合并结果（含来源/冲突），由页面统一计算。 */
  fields: Record<
    MergeableField,
    {
      value: string;
      source: 'baseline' | 'candidate';
      windowLabel?: string;
      author?: string;
      conflict: FieldConflict | null;
    }
  >;
}

export function ChangeReviewItem({
  contract,
  change,
  activeWindowId,
  activeWindowLabel,
  onSubmitField,
  onReview,
  onExemption,
  onResolveConflict,
  resolving,
  submitting,
  fields,
}: ChangeReviewItemProps) {
  const myCandidateValue = (field: MergeableField) =>
    contract.candidates.find(
      (candidate) =>
        candidate.changeId === change.id &&
        candidate.field === field &&
        candidate.windowId === activeWindowId &&
        candidate.resolution !== 'discarded',
    )?.value;

  const [impact, setImpact] = useState(myCandidateValue('impactStatement') ?? fields.impactStatement.value);
  const [migration, setMigration] = useState(
    myCandidateValue('migrationPlan') ?? fields.migrationPlan.value,
  );
  const [comment, setComment] = useState(fields.reviewComment.value);
  const [exemptionReason, setExemptionReason] = useState('');
  const [showExemption, setShowExemption] = useState(false);

  const conflictFields: MergeableField[] = (
    [
      'impactStatement',
      'migrationPlan',
      'reviewState',
      'reviewer',
      'reviewComment',
    ] as const
  ).filter((field) => fields[field].conflict);

  return (
    <article className="border-b border-slate-200 px-4 py-4 last:border-0">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-sky-900">
              {change.method} {change.path}
            </span>
            <CompatibilityBadge value={change.compatibility} />
            <ReviewStateBadge value={fields.reviewState.value as ReviewState} />
          </div>
          <h3 className="mt-2 text-sm font-semibold text-slate-900">
            {CHANGE_KIND_LABELS[change.kind]}
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{change.rationale}</p>
        </div>
        <div className="text-left text-xs text-slate-500 lg:text-right">
          <div>评审人：{fields.reviewer.value || '未指定'}</div>
          <div className="mt-1">结论：{fields.reviewComment.value || '尚无意见'}</div>
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

      {conflictFields.length > 0 && (
        <div className="mt-4 space-y-2">
          {conflictFields.map((field) => (
            <ConflictCard
              key={field}
              contract={contract}
              conflict={fields[field].conflict!}
              path={change.path}
              method={change.method}
              resolving={resolving}
              onResolve={(keepCandidateId) =>
                onResolveConflict(change.id, field, keepCandidateId)
              }
            />
          ))}
        </div>
      )}

      {change.compatibility !== 'compatible' && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <FieldEditor
            label="调用方影响说明"
            placeholder="受影响调用方、版本、流量和业务影响"
            value={impact}
            merged={fields.impactStatement}
            windowLabel={activeWindowLabel}
            submitting={submitting}
            onChange={setImpact}
            onSubmit={() => onSubmitField(change.id, 'impactStatement', impact)}
          />
          <FieldEditor
            label="迁移方案"
            placeholder="升级顺序、兼容层范围、回滚和截止时间"
            value={migration}
            merged={fields.migrationPlan}
            windowLabel={activeWindowLabel}
            submitting={submitting}
            onChange={setMigration}
            onSubmit={() => onSubmitField(change.id, 'migrationPlan', migration)}
          />
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 xl:flex-row xl:items-end">
        <div className="min-w-0 flex-1">
          <label className="mb-1.5 block text-xs font-medium text-slate-700">
            评审意见（{activeWindowLabel}）
          </label>
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
          <Button variant="secondary" size="sm" onClick={() => setShowExemption((value) => !value)}>
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

function FieldEditor({
  label,
  placeholder,
  value,
  merged,
  windowLabel,
  submitting,
  onChange,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  value: string;
  merged: {
    value: string;
    source: 'baseline' | 'candidate';
    windowLabel?: string;
    author?: string;
    conflict: FieldConflict | null;
  };
  windowLabel: string;
  submitting: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-slate-700">{label}</label>
        {merged.source === 'candidate' && !merged.conflict && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-700">
            <Save className="h-3 w-3" />
            已合并自 {merged.windowLabel}
            {merged.author ? ` · ${merged.author}` : ''}
          </span>
        )}
      </div>
      <Textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-slate-400">
          以「{windowLabel}」身份提交候选，与其他窗口的补充自动合并
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={submitting || value === merged.value}
          onClick={onSubmit}
        >
          <Save className="h-3.5 w-3.5" />
          提交候选
        </Button>
      </div>
    </div>
  );
}
