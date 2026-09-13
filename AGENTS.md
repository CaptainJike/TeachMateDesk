# TeachMate Repository Guidelines

## Product boundary

TeachMate is a teacher-facing exam management and multimodal grading system. The canonical workflow is:

```text
exam image import → question/answer/rubric extraction → teacher audit
→ student submission image import → identity and answer evidence review
→ type-aware grading → evidence review → score confirmation → analytics/revision
```

Images are sent directly to the configured Pi Agent Runtime. Do not add a dedicated text-recognition provider or a second vision vendor. If the model cannot accept images, fail the run into `REVIEW_PENDING`; never silently fall back to text-only grading.

## Repository structure

- `app/agent-engine/src/`: Pi runtime adapter, multimodal vision agent, scoring agents, tools and retrieval.
- `app/server/src/`: Express REST/SSE API, SQLite store and domain services.
- `app/web/src/`: React/Vite teacher workbench.
- `app/file-server/`: static access to original exam and submission images.
- `app/evaluation/`: benchmark runner and datasets.
- `knowledge-base/`: versioned textbook Markdown and indexes.
- `docs/`: current architecture, workflow and acceptance documentation.

Generated files are not product source: `dist/`, `node_modules/`, `.pnpm-store/`, `.env`, runtime uploads, logs, backups and screenshots must remain out of version control.

## Development commands

Run commands from `app/` with Node 22+ and pnpm 9+:

```bash
pnpm install
pnpm build
pnpm dev
pnpm dev:web
pnpm dev:server
pnpm dev:files
pnpm test
pnpm eval
```

For environments without a global pnpm binary, use `npx pnpm@9 <command>`.

## Configuration

Copy `app/.env.example` to `app/.env` and configure one model only:

```env
PI_RUNTIME=pi
PI_MODEL_PROVIDER=deepseek
PI_MODEL_ID=deepseek-flash
PI_MODEL_API_KEY=
PI_MODEL_BASE_URL=https://api.deepseek.com
PI_MODEL_SUPPORTS_IMAGES=true
PI_MODEL_TIMEOUT_MS=180000
PI_MODEL_MAX_IMAGES_PER_RUN=8
```

Do not introduce legacy provider variables or commit API keys.

## Coding conventions

TypeScript is strict and ESM-based. Use two spaces, double quotes, semicolons, and `.js` extensions for relative imports. Use `PascalCase` for components/classes and `camelCase` for functions/variables. Keep HTTP handlers thin; put workflow and domain behavior in services or the agent engine.

Every multimodal result must retain evidence, confidence, review state and the original source reference. A question with missing evidence, cross-question risk, invalid schema or low confidence must be reviewable and must not be auto-finalized.

## Database and workflow rules

- Treat `app/data/teachmate.sqlite` as local runtime state, not a fixture archive.
- Keep source images in `source_files_json`; do not reintroduce obsolete image-path fields.
- Persist identity evidence, vision answers, grading evidence, workflow steps and SSE history.
- Use the current event names: `VISION_ANALYSIS`, `ANSWER_EVIDENCE_EXTRACTED`, `GRADING_ROUTE_SELECTED`, `RUBRIC_GRADING`, `FEEDBACK_GENERATING`.
- Retry must be idempotent and must not duplicate submissions or scores.

## Testing and delivery

Build before running compiled tests:

```bash
pnpm build
pnpm --filter @teachmate/server test
```

Model-dependent tests require a valid `PI_MODEL_API_KEY`; offline tests must use deterministic fakes. When changing the user workflow, update `docs/TeachMate-当前架构与实施指南.md` and the root README. Never add API keys, student data, runtime logs or generated screenshots to the repository.
