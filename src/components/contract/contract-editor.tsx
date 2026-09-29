import Editor from '@monaco-editor/react';
import { Save } from 'lucide-react';
import { Button } from '../ui/button';

interface ContractEditorProps {
  /** 当前展示的值：有候选草稿时为草稿，否则为已提交基线 */
  value: string;
  baselineValue: string;
  canDraft: boolean;
  dirty: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
  saving: boolean;
}

export function ContractEditor({
  value,
  baselineValue,
  canDraft,
  dirty,
  onChange,
  onCommit,
  saving,
}: ContractEditorProps) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div>
          <span className="text-xs font-medium text-slate-700">OpenAPI 源定义</span>
          <span className="ml-2 text-[11px] text-slate-500">
            {canDraft ? '编辑属于当前窗口候选' : '只读：先发起编辑候选'}
          </span>
        </div>
        <Button size="sm" variant="secondary" disabled={!canDraft || !dirty || saving} onClick={onCommit}>
          <Save className="h-3.5 w-3.5" />
          {saving ? '提交合并中' : '提交定义'}
        </Button>
      </div>
      <Editor
        height="430px"
        language="plaintext"
        theme="vs"
        value={value}
        onChange={(nextValue) => canDraft && onChange(nextValue ?? '')}
        options={{
          readOnly: !canDraft,
          minimap: { enabled: false },
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          lineHeight: 20,
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          automaticLayout: true,
        }}
      />
      {baselineValue !== value && canDraft && (
        <div className="border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          草稿与基线不同，点击“提交定义”才会按候选合并；其他窗口的 OpenAPI 修改不会被覆盖，同内容冲突会提示选择。
        </div>
      )}
    </div>
  );
}
