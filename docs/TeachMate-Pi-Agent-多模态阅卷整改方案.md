# TeachMate：基于 Pi Agent 单一多模态模型的阅卷整改方案

## 1. 整改结论

TeachMate 不再采用传统 OCR 或第三方 OCR 作为阅卷前置链路，也不再在 Qwen OCR、百度 OCR、腾讯 OCR、火山 OCR 之间切换。

本项目统一采用：

```text
一个可配置的多模态模型
        ↓
Pi Agent Runtime
        ↓
图片理解、题目定位、答案提取、证据核验、评分、错因分析
```

OCR 不再是业务依赖，也不再承担以下职责：

- 题目—答案匹配；
- 学生答案提取；
- 姓名识别；
- 版面阅读顺序判断；
- 数学公式转写；
- 批改前的事实判断。

图片事实由 Pi Agent 调用的多模态模型直接判断。

---

## 2. 对当前问题的明确回答

### 2.1 是否只能配置一种模型？

可以。TeachMate 只保留一个统一的视觉模型配置：

```env
PI_MODEL_PROVIDER=deepseek
PI_MODEL_ID=deepseek-flash
PI_MODEL_API_KEY=
PI_MODEL_BASE_URL=https://api.deepseek.com
```

业务代码不直接绑定 Qwen、百度、腾讯或火山 SDK。图片通过 Pi Agent Runtime 的原生多模态输入处理；文字评分、Tool Calls 和结构化结果仍走同一 DeepSeek 官方 Chat Completions 链路。

### 2.2 当前 DeepSeek 能否继续使用？

可以继续作为首选候选，但必须确认当前账号和 Endpoint 对图片输入开放。

DeepSeek 官方视觉文档已经提供图片输入能力，支持通过 OpenAI-compatible Chat Completions 的多模态 content 传入图片，也支持 base64 和外部图片 URL：

- [DeepSeek Vision 官方文档](https://api-docs.deepseek.com/guides/vision/)

当前 TeachMate 日志中的模型是：

```text
deepseek-flash
```

问题不在于代码不能使用图片，而在于当前代码调用 DeepSeek 时只发送了文本：

```text
题干 + 标准答案 + 学生 OCR 文本
```

没有发送：

```text
原始试卷图片
```

因此必须先用一个最小图片请求验证实际 Endpoint：

```text
输入：一张包含简单手写算式的图片
输出：图片中的原始手写内容和位置说明
```

如果当前账号的 `deepseek-flash` 返回不支持图片，则任务必须进入 `REVIEW_PENDING`，不能退化为纯文本。业务层仍然只知道 Pi Agent，不知道具体厂商。

### 2.3 Pi Agent 是否能承担完整阅卷业务？

可以承担主要业务，但不是让模型自由发挥，而是由 Pi Agent 统一负责：

- 接收图片；
- 管理多轮 Agent 会话；
- 组织阅卷工具；
- 调用结构化输出；
- 执行题目级批改；
- 保存证据和事件；
- 处理失败、重试和教师复核。

多模态模型负责视觉理解，Pi Agent 负责流程、工具和状态管理，TeachMate 业务层负责权限、数据库和教师审核。

---

## 3. 目标架构

```text
┌──────────────────────┐
│ 学生原始试卷图片      │
└──────────┬───────────┘
           │ image parts
           ▼
┌──────────────────────┐
│ Pi Agent Runtime      │
│ 单一多模态模型         │
└──────────┬───────────┘
           │
           ├── 页面方向和页面结构判断
           ├── 学生身份候选识别
           ├── 题目区域和答案区域定位
           ├── 手写答案理解
           ├── 涂改和最终答案判断
           ├── 题目答案配对
           ├── Rubric 逐步评分
           └── 错因与订正建议
           │
           ▼
┌──────────────────────┐
│ 结构化阅卷结果         │
│ 证据、分数、置信度      │
│ reviewRequired         │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ SQLite / SSE / Web UI │
└──────────────────────┘
```

### 明确禁止的旧链路

```text
图片 → OCR Markdown → 字符串匹配 → 文本模型评分
```

以及：

```text
题干匹配失败 → 按题号顺序猜答案
```

---

## 4. Pi Runtime 改造要求

现有文件：

```text
app/agent-engine/src/runtime/grading-runtime.ts
app/agent-engine/src/runtime/pi-runtime.ts
```

需要从只支持文本：

```ts
run(context, prompt): Promise<string>
```

扩展为支持图片：

```ts
export interface RuntimeImage {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
  filename?: string;
}

export interface RuntimeRunContext {
  runId: string;
  model: ModelInfo;
  systemPrompt: string;
  tools?: AgentTool[];
  images?: RuntimeImage[];
}

export interface GradingRuntime {
  run(
    context: RuntimeRunContext,
    prompt: string,
    images?: RuntimeImage[]
  ): Promise<string>;
  abort(runId: string): Promise<void>;
}
```

Pi SDK 的调用方式采用其原生图片参数：

```ts
await session.prompt(prompt, {
  images: images.map((image) => ({
    type: "image",
    data: image.data,
    mimeType: image.mediaType,
  })),
});
```

不得在业务代码中自行拼接厂商特定的 OCR 请求格式。

---

## 5. 阅卷 Agent 的职责划分

### 5.1 `VisionAnswerAgent`

负责直接查看学生原始图片，并输出：

- 页面列表；
- 图片方向；
- 学生姓名候选；
- 班级/学号候选；
- 题目区域；
- 学生答案区域；
- 最终答案；
- 被划掉答案；
- 不确定区域；
- 视觉证据；
- 置信度。

### 5.2 `GradingAgent`

负责根据：

- 题干；
- 标准答案；
- Rubric；
- VisionAnswerAgent 提取的图片答案证据；
- 学生实际作答文本；

以 DeepSeek 思考模式逐题评分，并通过 Tool Calls 核验采分点。原始图片只在视觉分析阶段通过 Pi Agent 发送一次，避免每道题重复传输整份答卷；原图引用和证据仍然保留，证据不足时进入人工复核。

### 5.3 `FeedbackAgent`

根据已经核验过的评分证据生成：

- 失分原因；
- 错误类型；
- 启发式订正建议；
- 推荐复习知识点。

如果模型无法确认图片内容，必须输出 `reviewRequired: true`，不得猜测。

---

## 6. 统一结构化输出

视觉识别使用 DeepSeek JSON Output（`response_format: { type: "json_object" }`）；文字评分使用思考模式和 Tool Calls，业务层再对工具核验结果做 schema 校验，禁止把自由文本直接当作最终分数。

### 6.1 视觉识别结果

```json
{
  "identity": {
    "studentName": "",
    "className": "",
    "studentNumber": "",
    "confidence": 0.0,
    "evidence": ""
  },
  "pages": [
    {
      "page": 1,
      "rotation": 0,
      "layout": "single_column",
      "confidence": 0.0
    }
  ],
  "answers": [
    {
      "questionId": "q_5",
      "questionNumber": "5",
      "studentAnswer": "",
      "answerEvidence": "",
      "answerRegion": {
        "page": 1,
        "description": "第5题题干下方手写区域"
      },
      "confidence": 0.0,
      "isCrossQuestionRisk": false,
      "reviewRequired": false,
      "reviewReason": ""
    }
  ]
}
```

### 6.2 评分结果

```json
{
  "questionId": "q_5",
  "score": 0,
  "maxScore": 10,
  "stepEvaluations": [],
  "studentEvidence": [],
  "confidence": 0.0,
  "reviewRequired": false,
  "reviewReason": "",
  "feedback": ""
}
```

模型必须引用图片中的学生证据，不允许凭标准答案推测学生作答。

---

## 7. 服务端流程改造

### 当前流程

```text
previewStudentAnswerFiles()
  → parseFile()
  → extractStudentIdentity()
  → extractAnswersFromMarkdown()
  → startBatchGrading(answers)
  → text-only Agent
```

### 新流程

```text
previewStudentAnswerFiles()
  → 保存原始图片引用
  → Pi VisionAnswerAgent 直接查看图片
  → 返回 identity + answers + evidence
  → 教师确认预览
  → startBatchGrading()
  → GradingAgent 以证据文本 + Rubric 进行思考模式评分
```

`startBatchGrading()` 不再接收 OCR 生成的最终答案作为唯一输入，而是接收：

```ts
interface MultimodalSubmissionInput {
  submissionId: string;
  sourceFiles: string[];
  identity?: IdentityEvidence;
  visionAnswers?: VisionAnswer[];
}
```

`visionAnswers` 是 Agent 的初步观察结果，不是不可质疑的事实。评分 Agent 使用证据文本评分；证据缺失或置信度不足时必须保留复核状态，教师可通过原始图片引用回看。

---

## 8. 数据和状态调整

保留现有：

- `REVIEW_PENDING`；
- `FAILED`；
- `RETRYING`；
- 逐题增量保存；
- 评分证据；
- 教师复核任务；
- SSE 历史事件。

将事件名称从 OCR 语义改为视觉 Agent 语义：

```text
OCR_PARSING              → VISION_ANALYSIS
QUESTIONS_PARSED         → ANSWER_EVIDENCE_EXTRACTED
ROUTING_DOMAIN           → GRADING_ROUTE_SELECTED
RUBRIC_MATCHING          → RUBRIC_GRADING
FEEDBACK_GENERATING      → FEEDBACK_GENERATING
```

数据库中可以保留旧字段以兼容历史数据，但新任务不应再写入“已完成 OCR”这一事实。

---

## 9. 配置方案

只保留一个多模态模型配置位置，不暴露真实 Key：

```env
# Pi Agent 统一视觉模型
PI_RUNTIME=pi
PI_MODEL_PROVIDER=deepseek
PI_MODEL_ID=deepseek-flash
PI_MODEL_API_KEY=
PI_MODEL_BASE_URL=https://api.deepseek.com

# 视觉输入必须开启，否则任务直接进入 REVIEW_PENDING
PI_MODEL_SUPPORTS_IMAGES=true
PI_MODEL_TIMEOUT_MS=180000
PI_MODEL_MAX_IMAGES_PER_RUN=8
```

如果 DeepSeek 当前账号或 Endpoint 不支持图片，只改：

```env
PI_MODEL_PROVIDER=<另一家支持视觉的厂商>
PI_MODEL_ID=<该厂商的视觉模型>
PI_MODEL_API_KEY=
PI_MODEL_BASE_URL=<该厂商兼容接口>
```

业务代码、Agent、数据库和前端不应该随厂商变化。

---

## 10. 候选模型调研结论

### 首选：DeepSeek 视觉模型

理由：

- 当前项目已经配置 DeepSeek；
- Pi SDK 支持图片 prompt；
- DeepSeek 官方已经提供 Vision API 文档；
- 使用 OpenAI-compatible 格式，接入成本低；
- 可以继续复用现有模型配置和思考能力。

前提：必须使用实际支持图片的模型 ID，并用最小图片请求验证当前账号权限。

### 备选：Qwen-VL 系列

阿里云官方资料显示 Qwen-VL/OCR 支持图像、结构化数据、公式和文档理解。但本整改方案不再把它作为 OCR 使用，而只能作为 Pi Runtime 的另一个多模态模型配置候选。

资料：

- [Alibaba Cloud Qwen-VL OCR](https://www.alibabacloud.com/help/en/model-studio/qwenvl-ocr)
- [Qwen-OCR 官方说明](https://help.aliyun.com/en/model-studio/qwen-vl-ocr)

### 不作为首选

百度、腾讯、火山等专用 OCR 服务不进入本方案主链路。原因不是它们没有能力，而是本项目明确要求：

```text
统一通过 Pi Agent 的开放能力完成阅卷业务
```

因此不再增加 OCR 专用厂商依赖。

---

## 11. 分阶段实施计划

### 阶段一：验证 Pi 图片能力

- 增加 `RuntimeImage`；
- 接通 `session.prompt(..., { images })`；
- 用一张真实试卷验证图片输入；
- 验证模型能读出手写答案和题号；
- 验证结构化 JSON 输出。

验收：

```text
模型确实收到图片
模型能返回图片中的手写内容
不经过 OCR
```

### 阶段二：替换学生答卷预览

- 停止调用 Qwen OCR；
- 预览阶段直接调用 VisionAnswerAgent；
- 展示姓名、题目答案、置信度和风险；
- 保存原图和 Agent 证据。

### 阶段三：替换评分主链路

- `grading.service.ts` 直接传递原图；
- 每道题回看图片；
- 使用结构化评分结果；
- 保留逐题增量落库。

### 阶段四：移除 OCR 依赖

- 删除正式流程中的 `ocr.service.ts` 调用；
- 删除 `extractAnswersFromMarkdown()` 主流程调用；
- 删除题号 fallback；
- 删除 Qwen、火山等 OCR Provider 配置；
- 保留历史兼容代码或完成归档。

### 阶段五：Pi Agent 闭环

- 图片分析；
- Rubric 评分；
- 工具调用；
- 证据校验；
- 教师复核；
- 订正反馈；
- 重试和事件重放；
- 全部由 Pi Runtime 统一管理。

---

## 12. 验收标准

### 必须满足

- 不调用任何 OCR 厂商 API；
- 学生原图实际传入 Pi Agent；
- 每道题都有图片证据；
- 题目答案错位时进入复核；
- 不能根据标准答案反推学生答案；
- 图片识别失败不会整份答卷归零；
- 模型更换只需修改环境变量；
- DeepSeek 不支持图片时明确失败，不静默退化为文本评分。

### 重点测试样本

```text
1. 横向拍摄的数学试卷
2. 竖向拍摄但内容横向的试卷
3. 左右分栏试卷
4. 同一页存在多道题和多个小问
5. 学生答案写在题干旁边
6. 有划掉、涂改和二次作答
7. 数学公式和单位
8. 多张同一学生答卷
9. 答案跨题或写错位置
10. 完全未作答试卷
```

核心指标：

```text
题目—答案错配率：≤ 2%
不确定答案误自动评分率：0%
原图证据缺失的自动完成率：0%
所有评分结果可回溯到原始图片：100%
```

---

## 13. 最终决策

本项目后续不再继续扩展 OCR 供应商，也不再把 OCR 作为阅卷基础设施。

最终方案是：

```text
一个配置的多模态模型
+ Pi Agent Runtime
+ Pi 原生图片输入
+ Agent 工具和结构化输出
+ TeachMate 数据库与教师审核
```

当前 DeepSeek 可以继续使用，但必须使用实际支持 Vision 的模型 Endpoint，并完成图片输入验证。若当前 Endpoint 不支持图片，只替换模型配置，不改变 TeachMate 业务架构。
