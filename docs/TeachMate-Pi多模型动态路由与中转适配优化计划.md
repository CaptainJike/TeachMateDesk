# TeachMate：Pi 多模型动态路由与第三方中转适配优化计划

> 状态：规划中，尚未实施
>
> 本文只定义后续优化方案，不代表当前代码已经支持多模型动态路由。

## 1. 目标

TeachMate 当前使用单一模型配置，并且部分运行逻辑仍围绕 DeepSeek 和 OpenAI Chat Completions 链路实现。后续需要将其升级为面向 Pi 生态的多模型运行方案：

- 支持在同一个第三方中转服务中配置 GPT 和 Claude 模型；
- 支持按任务类型自动选择模型；
- 支持不重启服务切换默认模型和运行策略；
- 支持模型健康检查、限流处理和自动降级；
- 支持记录每一次任务实际使用的厂商、模型、协议和降级原因；
- 保留原始图片、视觉证据、置信度和人工复核状态；
- 图片任务不允许静默降级为纯文本任务。

核心原则：

```text
模型配置目录
  → 能力校验
  → 任务路由
  → Pi Provider 适配
  → 健康检查与降级
  → 结果与路由审计
```

## 2. 当前调研结论

### 2.1 DeepSeek 与 Pi 存在同步滞后

当前项目安装的 Pi 依赖为 `@earendil-works/pi-coding-agent ^0.85.1`。该版本本地模型目录中的 DeepSeek 模型包括：

| Pi 模型 ID | 图片输入 | API 类型 | 上下文窗口 |
|---|---:|---|---:|
| `deepseek-v4-flash` | 否 | `openai-completions` | 1M |
| `deepseek-v4-flash-vision-exp` | 是 | `openai-completions` | 1M |
| `deepseek-v4-pro` | 否 | `openai-completions` | 1M |

项目当前使用的 `deepseek-flash` 并不是该本地目录中的精确模型 ID，现有运行时代码通过兼容别名解决了该问题。

因此，DeepSeek 并非不能接入 Pi，主要问题是：

- 官方模型命名与 Pi 模型目录不同步；
- 视觉模型和纯文本模型的目录元数据容易混淆；
- DeepSeek reasoning 需要额外处理 `reasoning_content` 和思考参数；
- 通过 OpenAI 兼容接口接入时，结构化输出、工具调用和多轮会话需要额外验证。

### 2.2 Pi 原生适配优先级

后续选择中转协议时，不应仅根据模型名称判断兼容性，而应优先使用原生 API：

```text
Claude → Anthropic Messages
GPT    → OpenAI Responses
其次   → OpenAI Chat Completions 兼容接口
```

如果 Claude 只能通过 OpenAI 兼容接口访问，则在 Pi 中属于兼容模式，不能默认认为具备 Anthropic 原生接口的全部能力。

### 2.3 相关厂商的图片模型覆盖率

根据当前 Pi 依赖中的模型元数据计算，相关厂商的图片模型覆盖率如下：

| 厂商 | 图片模型数 / 总模型数 | 图片覆盖率 | 主要 API 类型 |
|---|---:|---:|---|
| Anthropic | 14 / 14 | 100% | `anthropic-messages` |
| Google | 22 / 22 | 100% | `google-generative-ai` |
| OpenAI | 37 / 39 | 约 95% | `openai-responses` |
| DeepSeek | 1 / 3 | 约 33% | `openai-completions` |
| MiniMax | 1 / 3 | 约 33% | `anthropic-messages` |
| Z.ai | 1 / 7 | 约 14% | `openai-completions` |

该比例仅代表 Pi 模型目录中的图片能力覆盖率，不是厂商质量排名，也不是 Pi 官方兼容性评分。

参考资料：

- [Pi Model Catalog](https://pi.dev/models)
- [Pi Providers 文档](https://pi.dev/docs/latest/providers)
- [DeepSeek 官方 Pi 集成](https://api-docs.deepseek.com/quick_start/agent_integrations/pi_mono/)
- [DeepSeek Vision 文档](https://api-docs.deepseek.com/guides/vision/)
- [Pi 0.70.1 DeepSeek 修复说明](https://pi.dev/news/releases/0.70.1)

## 3. 推荐的总体方案

不再把模型配置设计为一个全局的 `provider + modelId`，而是增加以下三个层次：

```text
Model Profile 模型档案
  → Task Policy 任务策略
  → Runtime Mode 运行模式
```

### 3.1 Model Profile

每个模型档案至少包含：

- 逻辑名称；
- 厂商；
- 实际模型 ID；
- Pi API 类型；
- 中转 Base URL；
- API Key 引用；
- 是否支持图片；
- 是否支持 reasoning；
- 是否支持结构化输出；
- 是否支持工具调用；
- 上下文长度和最大输出长度；
- 输入、输出和缓存价格；
- 质量等级；
- 稳定性等级；
- 延迟等级；
- 优先级；
- 备用模型列表。

逻辑名称与实际模型 ID 分离，例如：

```text
claude-sonnet-production
  → claude-sonnet-4-6

gpt-production
  → gpt-5.4
```

这样可以在不修改业务逻辑的情况下替换模型版本。

### 3.2 Task Policy

按业务任务定义策略：

```text
vision-extraction
objective-grading
subjective-grading
feedback-generation
review-retry
```

每个任务策略包含：

- 是否强制要求图片；
- 是否强制要求 JSON 或 JSON Schema；
- 是否需要工具调用；
- 首选模型列表；
- 备用模型列表；
- 最大重试次数；
- 成本和质量偏好。

### 3.3 Runtime Mode

提供三种主要运行模式：

```text
quality-first  质量优先
balanced       平衡模式
cost-first     成本优先
```

手工指定模型时进入：

```text
manual
```

## 4. 模型路由规则

### 4.1 硬性能力过滤

模型只有在满足以下条件时才能进入候选集：

- 图片任务必须支持图片输入；
- JSON 任务必须支持当前要求的结构化输出；
- 上下文长度满足当前任务；
- API Key 和 Base URL 可用；
- 模型未被健康检查熔断；
- 当前 Pi API 类型与中转服务实际协议匹配。

不得因为成本低或优先级高而绕过能力校验。

### 4.2 候选模型评分

初始评分权重建议为：

```text
Pi/API 兼容性：30%
任务质量等级：30%
模型健康度：20%
成本：10%
延迟：10%
```

模型质量不能完全依赖厂商宣传，应使用 TeachMate 自己的试卷、学生答卷和评分 rubric 评测集确定。

## 5. 初始任务策略建议

### 5.1 视觉解析

适用于试卷导入、学生答卷导入、身份识别和答案证据提取。

硬性要求：

```text
图片输入 + 结构化输出 + 足够上下文
```

初始候选：

```text
主模型：Claude Sonnet
备用模型：GPT 主模型
```

如果 Claude 中转只提供 OpenAI 兼容接口，则需要先完成图片、JSON、工具和多轮会话探测；探测不通过时优先使用 GPT 原生 Responses。

### 5.2 客观题评分

可以使用成本更低、延迟更低的 GPT 或 Claude 模型。

主要评测指标：

- 客观题准确率；
- JSON 合法率；
- 评分结果稳定性；
- 延迟；
- 单份答卷成本。

### 5.3 主观题评分

初始建议：

```text
主模型：Claude Sonnet
复核模型：GPT 高质量模型
```

重点评测：

- Rubric 遵循能力；
- 评分理由完整度；
- 证据引用准确性；
- 边界答案处理；
- 中文反馈质量；
- 与教师评分的一致性。

### 5.4 反馈生成

默认使用低成本、低延迟模型即可；如果评分置信度低或模型之间存在明显分歧，则升级到高质量模型。

### 5.5 疑难题复核

建议采用：

```text
低成本模型初评
  → 置信度检查 / 多模型分歧检查
  → 高质量模型复核
  → 教师最终确认
```

## 6. 动态配置和切换机制

### 6.1 配置来源

建议支持以下配置来源：

1. 默认运行时配置文件；
2. 环境变量覆盖；
3. 管理接口或管理命令；
4. 当前运行环境的模型探测结果。

运行时配置文件应属于本地配置，不提交 API Key 和学生数据到版本库。

### 6.2 热加载语义

配置修改后无需重启服务：

- 新任务使用新配置；
- 已开始任务固定原模型；
- 重试任务可以按照策略使用备用模型；
- 每次切换记录配置版本和路由原因；
- 配置加载失败时继续使用上一份有效配置。

不建议在同一个任务的正常执行过程中无条件切换模型，否则可能导致视觉证据、评分理由和输出格式不一致。

### 6.3 管理能力

后续可以提供：

- 查看当前默认模型；
- 查看所有模型 Profile；
- 查看每个任务的路由策略；
- 切换质量、平衡和成本模式；
- 启用或禁用某个模型；
- 手工指定模型；
- 查看模型健康状态；
- 查看最近失败和降级记录；
- 恢复上一份有效配置。

## 7. 故障降级策略

推荐降级链：

```text
主模型
  → 同厂商备用模型
  → 另一厂商备用模型
  → REVIEW_PENDING
```

可自动切换的情况：

- 网络失败；
- 429 限流；
- 5xx 服务错误；
- 超时；
- 输出 JSON 无法解析；
- 中转服务暂时不可用。

必须进入人工复核的情况：

- 图片模型不支持图片；
- 图片内容缺失或损坏；
- 题目与答案存在跨题风险；
- 证据不足；
- 多模型评分明显冲突；
- 重试后仍无法得到合法结构化结果。

禁止以下行为：

```text
图片模型失败
  → 删除图片
  → 使用纯文本模型继续评分
```

## 8. 需要调整的代码范围

本节只记录未来实施范围，当前计划阶段不修改代码。

### 8.1 `app/agent-engine/src/providers/model-registry.ts`

从单一模型生成器改为：

- 多模型 Profile 加载；
- 配置校验；
- Pi 模型元数据归一化；
- 任务策略读取。

### 8.2 `app/agent-engine/src/runtime/pi-runtime.ts`

从 DeepSeek 专用兼容逻辑改为通用 Pi Provider 运行时：

- 按模型 API 类型创建 Pi 模型；
- 支持 Anthropic Messages；
- 支持 OpenAI Responses；
- 支持 OpenAI Completions 兼容模式；
- 统一图片输入校验；
- 保留真实模型能力检查。

### 8.3 `app/agent-engine/src/core/agent.ts`

当前逻辑固定拼接 `/chat/completions`，并包含 `isDeepSeek` 分支。后续需要：

- 按 API 类型选择请求协议；
- 将厂商特有参数移入 Provider 适配层；
- 统一处理结构化输出、reasoning 和 tool calls；
- 保留多轮消息回放；
- 记录实际模型和请求协议。

### 8.4 `app/server/src/services/vision.service.ts`

- 通过路由器选择视觉模型；
- 将任务能力要求传递给路由器；
- 记录模型选择和降级结果；
- 继续保留图片数量、类型和大小校验。

### 8.5 配置和持久化

- `.env.example` 从单模型配置改为默认策略和配置文件路径；
- 运行时保存模型 Profile、策略版本和健康状态；
- 评分和视觉分析结果保存实际使用模型；
- SSE 事件保留路由和降级信息。

## 9. 第三方中转探测清单

正式实施前，需要向中转服务确认：

1. Base URL；
2. API Key 形式；
3. GPT 实际模型 ID；
4. Claude 实际模型 ID；
5. 是否支持 OpenAI Responses；
6. 是否支持 OpenAI Chat Completions；
7. 是否支持 Anthropic Messages；
8. 图片 Base64 Data URL；
9. 多图片请求；
10. JSON Object；
11. JSON Schema；
12. Tool Calls；
13. reasoning/thinking；
14. 流式响应；
15. 超时、并发和限流策略；
16. 计费方式。

需要使用真实中转地址做最小协议矩阵测试：

```text
纯文本请求
单图片请求
多图片请求
JSON Object
JSON Schema
工具调用
多轮会话
reasoning
超时与重试
429 与 5xx 降级
```

不能仅依据中转服务的模型列表判断兼容性。

## 10. 评测与验收标准

### 10.1 离线评测

使用固定数据集比较 GPT 与 Claude：

- 试卷题目提取准确率；
- 学生身份识别准确率；
- 手写答案识别准确率；
- 题目—答案匹配准确率；
- 评分与教师评分一致率；
- 证据完整率；
- JSON 合法率；
- `reviewRequired` 召回率；
- 平均延迟；
- 单份答卷成本。

### 10.2 兼容性验收

每个启用模型必须通过：

- Pi 模型解析；
- 图片输入；
- 结构化输出；
- 多轮消息回放；
- tool call 或明确禁用工具；
- 超时和取消；
- 失败重试；
- 路由审计；
- 不支持图片时拒绝纯文本降级。

### 10.3 动态配置验收

- 修改配置后新任务使用新模型；
- 已运行任务不被配置修改影响；
- 配置格式错误不会覆盖上一份有效配置；
- 禁用主模型后自动选择备用模型；
- 主模型失败后只重试一次或按策略重试；
- 所有降级都能在日志、数据库或 SSE 中追踪。

## 11. 分阶段实施顺序

### 阶段 0：中转能力确认

完成第三方中转的模型、协议、图片、JSON、工具和限流探测，形成兼容性矩阵。

### 阶段 1：模型 Profile 和策略模型

实现多模型配置结构、配置校验和任务策略，但暂时保持单模型运行结果不变。

### 阶段 2：Provider 适配层

拆分 Anthropic Messages、OpenAI Responses 和 OpenAI Completions 兼容链路，移除业务层对 DeepSeek 的直接依赖。

### 阶段 3：任务路由

接入视觉解析、客观题评分、主观题评分和反馈生成的模型选择策略。

### 阶段 4：动态热加载

实现配置热加载、模型启停、默认策略切换和任务级配置版本。

### 阶段 5：健康检查和自动降级

加入超时、429、5xx、JSON 错误、熔断、恢复和备用模型链路。

### 阶段 6：离线评测和灰度发布

使用 TeachMate 固定评测集比较 GPT 与 Claude，先灰度启用动态路由，再决定默认策略。

## 12. 初始推荐

如果第三方中转支持原生 Anthropic Messages：

```text
视觉解析：Claude Sonnet 主模型，GPT 备用
主观题评分：Claude Sonnet 主模型，GPT 复核
结构化和快速任务：根据评测选择 GPT 或 Claude 低价模型
```

如果第三方中转只有 OpenAI 兼容接口：

```text
GPT 作为默认主模型
Claude 作为兼容模式备用模型
```

最终默认模型不应永久写死为 GPT 或 Claude，而应由以下因素共同决定：

```text
任务类型
是否包含图片
模型能力
中转健康状态
成本模式
离线评测质量
当前限流情况
```

当前阶段的最终决策是：

> **优先建设模型目录、能力路由和动态健康切换；不要继续围绕某一个 DeepSeek 模型 ID 增加专用兼容补丁。**
