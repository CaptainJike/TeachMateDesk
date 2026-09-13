# TeachMate 当前架构与实施指南

> 版本：2026-09
> 状态：以当前代码为准

## 1. 产品闭环

TeachMate 不再把图像先转换为中间文字再评分。所有试卷和学生答卷图片由同一个 Pi Agent Runtime 直接理解。

```text
试卷图片导入
  → Pi VisionAnswerAgent 提取题目、选项、分值、标准答案和 Rubric
  → 教师复核并审核试卷
  → 学生答卷图片批量导入
  → Agent 提取身份、题目区域、最终答案和视觉证据
  → 教师确认身份与高风险答案
  → 按题型选择确定性规则或 Rubric 模型评分
  → 保存分数、证据、置信度和复核任务
  → 教师最终核验
  → 学生报告、主观题订正和班级量化分析
```

## 2. 技术边界

### 2.1 Pi Agent Runtime

`app/agent-engine/src/runtime/` 提供运行时抽象：

- `RuntimeImage`：JPEG、PNG、WebP 的 base64 图片输入；
- `LegacyGradingRuntime`：离线兼容和测试运行时；
- `PiGradingRuntime`：生产 Pi SDK 运行时；
- 图片请求必须使用 Pi 原生 `images` 参数；
- 图片模型不可用时直接失败并进入人工复核，禁止静默文本降级。

### 2.2 VisionAnswerAgent

`app/agent-engine/src/agents/vision-answer.agent.ts` 负责：

- 试卷题目、题型、选项、分值、标准答案和评分标准提取；
- 学生姓名、班级、学号候选识别；
- 页面方向、栏布局和题目区域判断；
- 手写答案和最终作答判断；
- 划掉答案、跨题风险、不确定区域和证据定位；
- JSON 结构化输出和 `reviewRequired` 标记。

### 2.3 GradingService

`app/server/src/services/grading.service.ts` 负责：

- 试卷版本校验和已审核限制；
- 批量答卷幂等导入；
- 选择题、判断题等客观题的快速规则比对；
- 填空题和主观题的 Rubric 评分；
- 每题增量持久化；
- 评分证据、置信度和人工复核任务；
- SSE 进度及失败重试。

## 3. 当前 API

### 试卷

- `GET /api/exams`
- `GET /api/exams/:id`
- `POST /api/exams`：文本草稿导入
- `POST /api/exams/import`：图片导入并由 Vision Agent 解析
- `PUT /api/exams/:examId/questions/:qId`
- `PUT /api/exams/:examId/questions/:qId/rubric`
- `POST /api/exams/:id/audit`
- `DELETE /api/exams/:id`

### 学生答卷

- `POST /api/submissions/preview-files`：原图视觉预览
- `POST /api/submissions/confirm-batch`：教师确认后创建批改任务
- `DELETE /api/submissions/import-batches/:batchId`
- `POST /api/submissions/:id/retry`
- `POST /api/submissions/:submissionId/grading-details/:detailId/review`
- `POST /api/revision`：仅对未满分的填空/简答/论述等非客观题进行二次订正，重判后同步更新本题和答卷总分；选择题、判断题直接按标准答案判分，不进入订正队列
- `GET /api/grading/sse/:submissionId`

系统不再提供 `/api/ocr/*` 接口，也不再接入专用图像文字识别服务。

## 4. 环境变量

```env
PORT=8004
FILE_SERVER_PORT=8002
FILE_SERVER_URL=http://localhost:8002
SQLITE_DB_PATH=data/teachmate.sqlite

PI_RUNTIME=pi
PI_MODEL_PROVIDER=deepseek
PI_MODEL_ID=deepseek-flash
PI_MODEL_API_KEY=
PI_MODEL_BASE_URL=https://api.deepseek.com
PI_MODEL_SUPPORTS_IMAGES=true
PI_MODEL_TIMEOUT_MS=180000
PI_MODEL_MAX_IMAGES_PER_RUN=8
PI_MODEL_REASONING_EFFORT=high  # 文字评分/反馈启用 DeepSeek 思考模式
```

## 5. 桌面交付形态

`app/desktop` 提供 Electron 主进程和 electron-builder 配置。桌面应用启动一个随机回环端口的 Express 服务，由同一服务托管 React 构建产物、API、SSE 和 `/files` 上传证据；开发环境仍可使用独立的 8002 文件服务。

运行时数据库、上传图片和日志写入 Electron `userData` 目录，知识库作为只读资源随应用分发。构建命令为 `cd app && pnpm desktop:package`，可产出 Windows NSIS/portable、macOS DMG/ZIP 和 Linux AppImage/ZIP。不同操作系统及 CPU 架构需要分别构建；正式发布应配置平台代码签名和公证。

模型选择只改变环境变量，不改变业务代码、数据库或前端协议。当前默认选择 `deepseek-flash`。该模型同时支持文本、图片、JSON Output、Tool Calls 和思考模式；Pi 运行时会兼容旧版 Pi 模型目录，确保官方模型 ID 能被正确解析。`deepseek-v4-pro` 如果不支持图像输入，则不能用于本项目主链路。

## 5. 数据模型

SQLite 当前核心表：

- `exams`：试卷元数据、源文件、视觉页面证据、题目 JSON；
- `submissions`：学生身份、源文件、身份证据、视觉答案证据和总分；
- `agent_execution_logs`：Agent 调用和评分审计；
- `workflow_runs`：导入、批改、订正任务状态；
- `workflow_steps`：任务步骤和增量输出；
- `review_tasks`：题目级人工复核任务；
- `grading_events`：SSE 历史事件。

评分详情必须保留：

- `student_evidence`；
- `answer_region`；
- `vision_confidence`；
- `grading_route`；
- `agent_model`；
- `review_required`；
- `review_reason`。

旧的 `raw_image_path` 已从数据库结构迁移移除，统一使用 `source_files_json`。

## 6. 题型评分策略

| 题型 | 默认方式 | 风险处理 |
|---|---|---|
| 单选、判断 | 标准化答案后确定性比对 | 无标准答案或证据异常时复核 |
| 多选 | 选项集合标准化比对 | 顺序、漏选、多选冲突时复核 |
| 填空 | 原图证据 + 标准答案语义和书写核验 | 错别字、公式、单位不清时复核 |
| 简答、阅读 | Rubric 分步评分 | 证据为空、跨题或低置信度时复核 |
| 作文、论述 | 多维 Rubric + 原图证据 | 不做无证据自动定稿 |

模型不得从标准答案反推学生答案。所有自动完成的题目必须能够回溯到学生原始图片和证据区域。

## 7. 本地开发和清理规则

```bash
cd app
pnpm install
pnpm build
pnpm dev
```

以下内容属于运行时或生成物，不应提交：

- `dist/`、`node_modules/`、`.pnpm-store/`；
- `.env`；
- `app/file-server/uploads/` 中的运行时上传文件；
- `app/logs/`；
- SQLite 备份文件；
- 临时截图、渲染结果和压缩包。

保留的文档以 `docs/TeachMate-Pi-Agent-多模态阅卷整改方案.md` 和本文为准；其他设计文档必须与本文及当前代码一致，否则应删除或更新。
