# API 契约兼容性审查与版本发布平台

用于后端维护者、接口评审人和调用方负责人协作处理 API 契约变化的独立前端工程。工程没有真实后端，首次运行加载本地模拟契约，后续状态写入浏览器 `localStorage`。

## 技术栈

- React 19 + TypeScript + Vite 8
- shadcn/ui 风格本地组件 + Radix UI primitives
- Zustand + persist
- TanStack Router
- TanStack Query
- Monaco Editor / Diff Editor
- Tailwind CSS 4

## 功能

- OpenAPI JSON 导入、契约列表搜索和领域/状态筛选
- 字段新增、删除、可选性、枚举与错误码变化展示
- 自动判定兼容、警告或不兼容，并要求调用方影响说明与迁移方案
- **候选式协作编辑**：两个评审窗口从同一基线各自起稿，候选携带基线标识提交
  - 不同字段的补充按三方合并自动合入，不覆盖对方窗口刚提交的迁移说明
  - 同一字段两边改成不同内容时保留双方的值与来源，逐处选择「本窗口 / 对方 / 手工合并」
  - 基线过期时可直接提交触发合并，或先「变基到最新」刷新基准
- Monaco Editor 编辑契约定义，Monaco Diff Editor 比较发布快照
- 调用方列表、示例请求生成、逐条接受、退回和兼容层豁免
- 跨契约批量评审
- **按变化集发布**：只收集「已接受（含兼容层豁免）且说明齐全」的变化进入独立快照
  - 基线过期、字段冲突未解决或仍有开放候选时，发布门禁直接挡住
  - 每次发布保留独立快照：变化副本、调用方影响、Markdown 报告、校验值与发布基线
  - 回滚一次只恢复该快照的变化与调用方影响；旧版本、其他快照和报告记录仍可查
- 工作副本 Markdown 变更报告（含字段补充来源）与 JSON 导出

## 运行

```bash
npm install
npm run dev
```

默认开发地址为 `http://localhost:18470`。

生产构建：

```bash
npm run build
```

构建输出位于 `dist`。

## 目录

```text
src/
  components/             shadcn/Radix 基础组件、业务组件、应用外壳
  data/                   本地模拟契约
  lib/                    通用工具
  models/                 契约模型、兼容性与发布门禁规则
  pages/                  工作台、详情、批量评审、发布、报告
  services/               本地持久化服务和 TanStack Query hooks
  store/                  Zustand 评审工作区状态
```
