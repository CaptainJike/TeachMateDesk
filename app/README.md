# TeachMate App Monorepo

TeachMate 通过 Pi Agent Runtime 和一个可配置的多模态模型完成试卷导入、答卷视觉分析、逐题评分、教师复核和学情分析。

## 目录结构
```
app/
├── agent-engine/    # Pi Runtime、VisionAnswerAgent、评分 Agent 与工具
├── server/          # Express API、SQLite、SSE 和业务流程
├── web/             # Vite + React 18 教师工作台
├── file-server/     # 原始试卷/答卷图片静态访问服务
└── evaluation/      # 评测集与评估脚本
```

## 常用开发命令
```bash
pnpm install
pnpm dev
pnpm dev:web
pnpm dev:server
pnpm dev:files
pnpm test
pnpm eval
```

复制 `.env.example` 为 `.env`，只配置一个 Pi 模型：

```env
PI_RUNTIME=pi
PI_MODEL_PROVIDER=deepseek
PI_MODEL_ID=deepseek-flash
PI_MODEL_API_KEY=
PI_MODEL_BASE_URL=https://api.deepseek.com
PI_MODEL_SUPPORTS_IMAGES=true
PI_MODEL_REASONING_EFFORT=high
```

图片必须进入 Pi Agent 的原生图片输入；视觉分析失败或证据不足会进入 `REVIEW_PENDING`，不会静默退化成文本评分。
