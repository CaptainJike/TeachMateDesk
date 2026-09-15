# TeachMate 当前架构与实施指南

> 版本：2026-09
> 状态：以当前代码为准

## 1. 产品闭环

TeachMate 不再把图像先转换为中间文字再评分。所有试卷和学生答卷图片由同一个 Pi Agent Runtime 直接理解。

```text
试卷图片导入
  → Pi VisionAnswerAgent 提取题目、选项、原卷已有分值、标准答案和 Rubric
  → 程序级自动配分引擎补齐缺失分值并强制对齐试卷总分
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

- 试卷题目、题型、选项、原卷已有分值、标准答案和评分标准提取；
- 学生姓名、班级、学号候选识别；
- 页面方向、栏布局和题目区域判断；
- 手写答案和最终作答判断；
- 划掉答案、跨题风险、不确定区域和证据定位；
- JSON 结构化输出和 `reviewRequired` 标记。

### 2.3 试卷自动配分（PaperScoreService）

`app/server/src/services/paper-score/` 是独立于 AI 的程序级配分引擎，AI 只负责识别，分值计算与总分校验全部由程序完成。

```text
题型权重与归一化（score-weights.ts）
  → 固定分值保护（manual / original）
  → 剩余分数计算
  → 两级配分（大题 → 小题，按题型权重）
  → 0.5 分标准化（优先整数）
  → 尾差修正
  → 总分强校验 sum(score) === total_score
```

关键规则：

- 用户配置的总分优先，未填写时默认 **100** 分；后端再次兜底，避免前端绕过。
- 分值来源优先级：`manual` > `original` > `auto`；`ai` 推测分值不作为最终分值来源，会被重新配分。
- 原卷明确写出的分值（`original`）与教师手工分值（`manual`）永不被自动覆盖。
- 原卷分值合计超过配置总分时不自动压缩，保留原卷分值并在 `score_summary.conflict` 中提示教师。
- 评分点暂不拆分，第一阶段只保证题目级 `score_value` 正确，`rubric_steps` 由程序按比例对齐满分。
- 历史试卷不会被批量修改，教师可通过「重新自动配分」主动处理。

### 2.4 GradingService

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
- `POST /api/exams`：文本草稿导入（支持 `totalScore`，默认 100）
- `POST /api/exams/import`：图片导入并由 Vision Agent 解析 + 程序自动配分（支持 `total_score`，默认 100）
- `PUT /api/exams/:examId/questions/:qId`
- `PUT /api/exams/:examId/questions/:qId/rubric`
- `PUT /api/exams/:examId/questions/:qId/score`：教师手工设置满分，写入 `score_source=manual`
- `POST /api/exams/:id/reassign-score`：重新自动配分，`mode=keep-manual`（保留人工与原卷分值）或 `mode=full`（仅保留人工分值）
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

## 6. 数据模型

SQLite 当前核心表：

- `exams`：试卷元数据、源文件、视觉页面证据、题目 JSON、自动配分摘要 `score_summary_json`；
- `submissions`：学生身份、源文件、身份证据、视觉答案证据和总分；
- `agent_execution_logs`：Agent 调用和评分审计；
- `workflow_runs`：导入、批改、订正任务状态；
- `workflow_steps`：任务步骤和增量输出；
- `review_tasks`：题目级人工复核任务；
- `grading_events`：SSE 历史事件。

题目记录（`exams.questions_json` 内）除 `score_value` 外还保留：

- `score_source`：`original` / `ai` / `auto` / `manual`；
- `section_title`：所属大题标题，用于题型权重归一化；
- `sub_type`：AI 识别的细分题型（如 `oral_calculation`）；
- `difficulty`：`easy` / `medium` / `hard`，第一期仅作辅助权重。

评分详情必须保留：

- `student_evidence`；
- `answer_region`；
- `vision_confidence`；
- `grading_route`；
- `agent_model`；
- `review_required`；
- `review_reason`。

旧的 `raw_image_path` 已从数据库结构迁移移除，统一使用 `source_files_json`。

## 7. 题型评分策略

| 题型 | 默认方式 | 风险处理 |
|---|---|---|
| 单选、判断 | 标准化答案后确定性比对 | 无标准答案或证据异常时复核 |
| 多选 | 选项集合标准化比对 | 顺序、漏选、多选冲突时复核 |
| 填空 | 原图证据 + 标准答案语义和书写核验 | 错别字、公式、单位不清时复核 |
| 简答、阅读 | Rubric 分步评分 | 证据为空、跨题或低置信度时复核 |
| 作文、论述 | 多维 Rubric + 原图证据 | 不做无证据自动定稿 |

模型不得从标准答案反推学生答案。所有自动完成的题目必须能够回溯到学生原始图片和证据区域。

### 7.1 小学题型配分权重

自动配分不按「总分 ÷ 题数」平均，而是按题型权重两级分配。当前内置权重（`score-weights.ts`）：

| 数学 | 权重 | 语文 | 权重 | 英语 | 权重 |
|---|---:|---|---:|---|---:|
| 判断题 | 1 | 看拼音写词语 / 生字词 | 1 | 听力选择 / 单词选择 | 1 |
| 选择题 | 1.2 | 词语搭配 / 古诗填空 | 1 | 判断 / 单项选择 | 1 |
| 填空题 | 1.3 | 选择题 / 判断题 / 填空题 | 1 | 单词拼写 / 词汇填空 | 1.2 |
| 口算题 / 直接写得数 | 1 | 修改病句 / 句子仿写 | 1.5 | 连词成句 / 情景交际 | 1.5 |
| 单位换算 | 1.3 | 阅读理解客观题 | 1.5 | 阅读选择 / 阅读判断 | 1.5 |
| 看图题 | 1.5 | 阅读理解简答题 | 2 | 阅读简答 | 2 |
| 竖式计算 / 脱式计算 / 解方程 / 操作题 | 2 | 综合阅读 / 口语交际 | 3 | 写作 | 4 |
| 作图题 | 2.5 | 小练笔 | 5 | | |
| 应用题 / 解决问题 | 3 | 作文 | 10 | | |
| 综合题 | 3.5 | | | | |
| 探究题 | 4 | | | | |

题型归一化顺序：`sub_type` → 大题标题 → 题干片段 → `q_type` 兜底。难度系数（`easy 0.8 / medium 1 / hard 1.2`）已实现但第一期默认关闭，保证配分稳定可复现。

## 8. 本地开发和清理规则

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
