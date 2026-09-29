import { CircleAlert, Combine, Handshake, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { FIELD_LABELS, type Candidate, type CandidateFieldEdit } from '../../models/candidate';

interface ConflictPanelProps {
  candidate: Candidate;
  resolving: boolean;
  onResolve: (input: {
    changeId: string;
    field: CandidateFieldEdit['field'] | 'openapi';
    choice: 'mine' | 'theirs' | 'combined';
    combinedValue?: string;
  }) => void;
}

export function ConflictPanel({ candidate, resolving, onResolve }: ConflictPanelProps) {
  const fieldConflicts = candidate.fieldEdits.filter((edit) => edit.resolution === 'conflict');
  const openApiConflict =
    candidate.openApiEdit?.resolution === 'conflict' ? candidate.openApiEdit : undefined;

  if (!fieldConflicts.length && !openApiConflict) {
    return null;
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50/60 p-4">
      <div className="flex items-center gap-2">
        <CircleAlert className="h-4 w-4 text-red-700" />
        <strong className="text-sm text-red-900">
          {candidate.windowLabel} 的候选存在 {fieldConflicts.length + (openApiConflict ? 1 : 0)} 处同字段冲突
        </strong>
      </div>
      <p className="mt-1 text-xs leading-5 text-red-800/80">
        两个窗口修改了同一字段的不同内容。系统没有覆盖任何一边：请逐处选择保留本窗口、对方或手工合并。
      </p>
      <div className="mt-3 space-y-3">
        {fieldConflicts.map((edit) => (
          <FieldConflictCard
            key={`${edit.changeId}.${edit.field}`}
            edit={edit}
            label={FIELD_LABELS[edit.field]}
            resolving={resolving}
            onResolve={(choice, combinedValue) =>
              onResolve({ changeId: edit.changeId, field: edit.field, choice, combinedValue })
            }
          />
        ))}
        {openApiConflict && (
          <FieldConflictCard
            edit={{
              changeId: '__openapi__',
              field: 'impactStatement',
              base: openApiConflict.base,
              value: openApiConflict.value,
              resolution: 'conflict',
              committedValue: openApiConflict.committedValue,
              committedSource: openApiConflict.committedSource,
            }}
            label="OpenAPI 源定义"
            resolving={resolving}
            onResolve={(choice, combinedValue) =>
              onResolve({ changeId: '__openapi__', field: 'openapi', choice, combinedValue })
            }
          />
        )}
      </div>
    </div>
  );
}

function FieldConflictCard({
  edit,
  label,
  resolving,
  onResolve,
}: {
  edit: CandidateFieldEdit;
  label: string;
  resolving: boolean;
  onResolve: (choice: 'mine' | 'theirs' | 'combined', combinedValue?: string) => void;
}) {
  const [mode, setMode] = useState<'mine' | 'theirs' | 'combined' | null>(null);
  const [combined, setCombined] = useState(
    `${edit.value}\n\n---\n${edit.committedValue ?? ''}`.replace(/\n---\n$/, ''),
  );

  return (
    <article className="rounded-md border border-red-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm text-slate-900">{label}</strong>
        <Badge tone="red">同字段冲突</Badge>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <ConflictValue
          icon={UserRound}
          title="本窗口补充"
          tone="sky"
          value={edit.value}
        />
        <ConflictValue
          icon={Handshake}
          title={`已提交值 · ${edit.committedSource ?? '对方窗口'}`}
          tone="amber"
          value={edit.committedValue ?? ''}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={resolving} onClick={() => onResolve('mine')}>
          保留本窗口
        </Button>
        <Button size="sm" variant="secondary" disabled={resolving} onClick={() => onResolve('theirs')}>
          采用对方
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMode(mode === 'combined' ? null : 'combined')}>
          <Combine className="h-3.5 w-3.5" />
          手工合并
        </Button>
      </div>
      {mode === 'combined' && (
        <div className="mt-3">
          <Textarea
            className="min-h-28 bg-white"
            value={combined}
            onChange={(event) => setCombined(event.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              disabled={resolving || !combined.trim()}
              onClick={() => {
                onResolve('combined', combined);
                setMode(null);
              }}
            >
              确认合并内容
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

function ConflictValue({
  icon: Icon,
  title,
  value,
  tone,
}: {
  icon: typeof UserRound;
  title: string;
  value: string;
  tone: 'sky' | 'amber';
}) {
  return (
    <div
      className={
        tone === 'sky'
          ? 'rounded-md border border-sky-200 bg-sky-50 p-3'
          : 'rounded-md border border-amber-200 bg-amber-50 p-3'
      }
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-slate-700">
        {value || '（空）'}
      </pre>
    </div>
  );
}
