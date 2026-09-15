# TeachMate 智能作业批改系统

> 基于 **Pi Agent Runtime 单一多模态模型** 与 **文件系统轻量 RAG** 的多学科智能阅卷系统。提供**原图导入、题目与标准答案解析、教师复核、按题型评分、证据核验、学生诊断报告与量化分析**全流程闭环能力。

---

## 🏗️ 系统架构与服务矩阵

系统采用 **pnpm Monorepo** 架构，核心模块及其运行端口规划如下：

| 模块名称 | 目录路径 | 默认端口 | 职责说明 |
| :--- | :--- | :--- | :--- |
| **`@teachmate/web`** | `app/web` | `http://localhost:8003` | React 18 + Tailwind 现代化响应式控制看板（批量批改、教师复核、学生报告、变式订正、学情统计） |
| **`@teachmate/server`** | `app/server` | `http://localhost:8004` | Express 后端 API，管理试卷库、提交批次、SSE 流式事件分发与学情聚合 |
| **`@teachmate/file-server`** | `app/file-server` | `http://localhost:8002` | 本地上传与静态文件服务，供后端及前端读取试卷与答卷 |
| **`@teachmate/agent-engine`** | `app/agent-engine` | - | Pi Runtime、VisionAnswerAgent、Router、Rubric、ChineseExpert、Feedback 评分引擎 |
| **`@teachmate/eval`** | `app/evaluation` | - | 语文阅读理解自动化评测与准确度评估基准 |
| **`knowledge-base`** | `knowledge-base/` | - | 统编版语文结构化课文切片与轻量 Catalog 索引知识库 |

---

## ⚡ 快速开始 (Quick Start)

### 1. 环境准备
- **Node.js**：`>= 22.0.0`（项目使用内置 `node:sqlite`）
- **包管理器**：`pnpm >= 9.0.0`

### 2. 安装项目依赖
进入 `/app` 根目录安装 monorepo 依赖：
```bash
cd app
pnpm install
```

### 3. 配置环境变量
不配置密钥时可浏览内置示例数据；导入试卷、识别答卷和真实 Agent 批改需要配置对应 API Key。

若需连接真实多模态模型，可在 `/app` 目录下复制配置：
```bash
cp .env.example .env
```
根据需要编辑 `.env`。业务只读取一个 Pi 多模态模型配置，厂商切换不影响业务代码：
```ini
# 1. 基础服务端口与数据库
PORT=8004
FILE_SERVER_PORT=8002
FILE_SERVER_URL=http://localhost:8002
SQLITE_DB_PATH=data/teachmate.sqlite

# 2. Pi Agent 统一多模态模型
PI_RUNTIME=pi
PI_MODEL_PROVIDER=deepseek
PI_MODEL_ID=deepseek-flash
PI_MODEL_API_KEY=your_api_key_here
PI_MODEL_BASE_URL=https://api.deepseek.com
PI_MODEL_SUPPORTS_IMAGES=true
PI_MODEL_REASONING_EFFORT=high
PI_MODEL_TIMEOUT_MS=180000
PI_MODEL_MAX_IMAGES_PER_RUN=8

# 常用提供商 BaseURL 参考：
# - DeepSeek 官方 : https://api.deepseek.com
# - 阿里通义千问   : https://dashscope.aliyuncs.com/compatible-mode/v1
# - 智谱 AI 官方  : https://open.bigmodel.cn/api/paas/v4
# - 月之暗面 Kimi : https://api.moonshot.cn/v1
# - 本地 Ollama   : http://localhost:11434/v1
# - OpenAI 官方   : https://api.openai.com/v1

# 视觉证据不足时自动进入 REVIEW_PENDING，不会静默退化为文本评分
```

---

## 🚀 启动与运行

### 桌面客户端（教师交付版）

项目已提供 Electron 桌面入口，将 Web、API、SQLite、上传文件和知识库整合为一个本地应用。构建完整安装包前需要联网安装 Electron 依赖，并在目标平台执行构建：

```bash
cd app
pnpm install
pnpm desktop:package
```

产物位于仓库根目录 `release/`：Windows 生成 NSIS 安装程序与 portable `.exe`，macOS 生成 `.dmg` 与 `.zip`。桌面运行时数据写入系统用户数据目录，不会随着应用更新覆盖；AI 批改仍需联网访问配置的 Pi 模型。

### 方式一：一键并行启动全栈应用（推荐）
在 `/app` 目录下执行：
```bash
pnpm dev
```
该命令将**同时启动**：
- 🌐 前端控制台：[http://localhost:8003](http://localhost:8003)
- 🔌 后端 API 服务：[http://localhost:8004](http://localhost:8004)
- 📁 静态文件服务：[http://localhost:8002](http://localhost:8002)

---

### 方式二：分模块独立启动
如果你需要单独调试某个服务，可在 `/app` 目录下运行对应指令：

```bash
# 1. 启动 Web 前端 (端口 8003)
pnpm dev:web

# 2. 启动 Backend Server (端口 8004, API & SSE)
pnpm dev:server

# 3. 启动 File Server (端口 8002, 静态文件映射)
pnpm dev:files
```

---

启动上述三个服务即可；图片分析和评分均由配置的 Pi 多模态模型完成。

---

## 🧪 评测与自动化测试

### 1. 运行系统自动化评测 (Evaluation)
测试多 Agent 批改在初中语文阅读理解数据集上的打分准确率、知识点覆盖率与耗时：
```bash
cd app
pnpm eval
```

### 2. 运行单元测试
```bash
cd app
pnpm test
```

### 3. 运行构建检查
```bash
cd app
pnpm build
```

完整流程、API、数据库字段和清理规则见 [`docs/TeachMate-当前架构与实施指南.md`](docs/TeachMate-当前架构与实施指南.md)。

---

## 📖 核心功能看板与交互指南

打开浏览器访问 **`http://localhost:8003`**：

1. **试卷导入与自动配分 (Exam Import & Auto Scoring)**
   - 试卷图片直接交由 Pi Vision Agent 解析题型、题目、答案与原卷已有分值；未标注分值的试卷由程序级配分引擎按题型权重两级自动配分。
   - 未填写总分时默认按 **100 分**计算，最终题目分值合计严格等于试卷总分；原卷明确分值与教师手工分值永不被覆盖。
   - 导入后展示配分结果摘要（识别原有分值 / 自动分配 / 自动配分题数），支持「重新自动配分」与逐题手工改分。
2. **批量作业批改 (Batch Grading)**
   - 勾选或一键批改班级作业，实时查看多 Agent 批改流式进度与步骤级打分耗时。
3. **教师复核工作台 (Teacher Review)**
   - 教师复核 AI 评分，提供**采分点级**覆盖标引（绿色命中/红色缺失）以及错因多标签修正。
4. **学生诊断报告 (Student Report)**
   - 展示得分率、答题雷达图、采分步骤树（Step-by-Step Breakdown）与个性化多维诊断评语。
5. **主观题即时订正 (Student Revision)**
   - 仅对未满分的填空、简答和论述等可订正题目开放二次作答，Agent 重判后同步更新本题与答卷总分。
   - 选择题、判断题按标准答案直接判分并提供错因说明，不进入二次订正队列。
6. **学情统计与薄弱点透视 (Analytics)**
   - 全班分数分布、高频丢分题型分布及典型错因根因归因分析。

---

## 📂 原始图片与 Pi Agent 输入说明

- **文件存放路径**：`app/file-server/uploads/`
- **文件列表查看**：浏览器访问 `http://localhost:8002/` 或 `http://localhost:8002/list`
- **文件直链格式**：`http://localhost:8002/files/<文件名>`
- **Pi Agent 图片输入**：原始 JPG/PNG/GIF/WebP 以原生 image part 传入 `deepseek-flash`，视觉证据持久化到 SQLite；逐题评分使用同一模型的文本思考模式和 Tool Calls，避免重复上传整份答卷。

---

## 🛠️ 常见问题 (FAQ)

### Q1: 启动时提示端口被占用？
- 默认端口：前端 `8003`、后端 `8004`、文件服务 `8002`；图片分析由配置的 Pi Runtime 执行。
- 可通过环境变量覆盖：例如 `PORT=8005 pnpm dev:server` 或修改对应子包配置。
