# AGENTS.md — Sparky AI Assistant on Bedrock AgentCore

Full-stack AI assistant: React frontend on AWS Amplify, Python backend on Amazon Bedrock AgentCore Runtime. Monorepo with four backend services, a Vite+React frontend, Terraform infrastructure, and built-in system skills.

## Project structure

```
backend/
  sparky/              # Main agent runtime — LangGraph + FastAPI on AgentCore
  core_services/       # Sync API runtime — FastAPI on AgentCore (CRUD for history, tools, skills, search, cron jobs)
  kb_indexer/          # Lambda: SQS → Bedrock Knowledge Base ingestion
  expiry_cleanup/      # Lambda: SQS → KB doc + AgentCore Memory cleanup
  cron_executor/       # Lambda: SQS → Scheduled cron job execution via AgentCore
src/                   # React frontend (Vite + Tailwind + shadcn/ui)
  components/Agent/    # Chat UI: AgentInterface, ChatInput, CanvasPanel, BrowserSessionIndicator
  pages/               # Agent, ToolConfig, Skills, Projects, CronJobs, Landingpage
  services/            # API clients (auth, skills, toolConfig, projects, cronJobs, chartExport)
infra/                 # Terraform (AWS provider >= 6.26.0, Terraform >= 1.5)
system-skills/         # Built-in skills deployed to S3 (create-ppt, create-pdf, skill-authoring-best-practices)
deployment.sh          # Interactive deployment wizard
destroy.sh             # Teardown script
```

## Prerequisites

- AWS CLI configured with credentials
- Terraform >= 1.5
- Docker with buildx (ARM64 image builds)
- Node.js >= 20, npm
- Python 3.12
- `jq`

## Build and run commands

### Frontend

```bash
npm install          # Install dependencies
npm run dev          # Local dev server (Vite, port 5173)
npm run build        # Production build → dist/
npm run lint         # ESLint
npm run lint:fix     # ESLint with auto-fix
npm run format       # Prettier
npm test             # Vitest (run once)
```

### Backend

Each backend service is a standalone Python package. No shared virtualenv — each has its own `requirements.txt`.

```bash
# Sparky agent runtime
cd backend/sparky
pip install -r requirements.txt
python -m agent                    # Starts FastAPI on port 8080

# Core Services runtime
cd backend/core_services
pip install -r requirements.txt
python -m agent                    # Starts FastAPI on port 8080
```

Lambdas (`kb_indexer`, `expiry_cleanup`) use only boto3 from the Lambda runtime — no extra dependencies.

### Infrastructure

```bash
cd infra
terraform init
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

Or use the deployment wizard from the project root:

```bash
./deployment.sh    # Interactive: backend, frontend, or both
./destroy.sh       # Teardown
```

The build script `infra/build.sh` packages Lambda code into `infra/build/`.

## Architecture overview

Two AgentCore runtimes (Docker containers on ECR), two Lambdas, DynamoDB tables, S3 buckets, Cognito auth, Amplify hosting, Bedrock Knowledge Base, and AgentCore Memory.

- **Sparky runtime** (`backend/sparky/`): Streaming agent. FastAPI + LangGraph + LangChain AWS. Handles chat, tool execution, canvas, browser, code interpreter. Uses DynamoDB checkpointer with S3 offload for conversation state. Entry point: `agent.py`. Graph definition: `graph.py`. Prompt: `prompt.py`. Streaming: `streaming.py`.
- **Core Services runtime** (`backend/core_services/`): Sync CRUD API. Chat history, tool config, MCP server management, skills CRUD, KB search. Entry point: `agent.py`. Route handlers: `handlers.py`.
- **kb_indexer Lambda**: Triggered by SQS. Ingests conversation documents into Bedrock Knowledge Base.
- **expiry_cleanup Lambda**: Triggered by SQS (via EventBridge Pipe from DynamoDB Stream REMOVE events). Cleans up expired KB docs and AgentCore Memory events.
- **Frontend**: Vite + React 18 + Tailwind CSS + shadcn/ui. Auth via AWS Amplify + Cognito. Hosted on Amplify.

## Key backend files

| File | Purpose |
|------|---------|
| `backend/sparky/agent.py` | FastAPI app, `/invocations` endpoint, request routing |
| `backend/sparky/graph.py` | LangGraph agent graph, state definition (Canvas, MessagesState) |
| `backend/sparky/agent_manager.py` | Agent lifecycle, tool registration, model creation |
| `backend/sparky/tools.py` | Tool definitions: Tavily search, code interpreter, skills, download links |
| `backend/sparky/canvas.py` | Canvas tool definitions (6 types: document, html, code, diagram, svg, mermaid) |
| `backend/sparky/browser.py` | Browser tool via Playwright/CDP |
| `backend/sparky/streaming.py` | SSE streaming, stream state management, reconnection support |
| `backend/sparky/prompt.py` | System prompt construction |
| `backend/sparky/config.py` | Model config parsing, Bedrock client, checkpointer setup |
| `backend/sparky/mcp_lifecycle_manager.py` | MCP server connection lifecycle |
| `backend/sparky/hybrid_checkpointer.py` | DynamoDB + in-memory cache checkpointer |
| `backend/sparky/research_agent.py` | Research mode sub-agent |
| `backend/core_services/agent.py` | Core Services FastAPI app |
| `backend/core_services/handlers.py` | All sync API route handlers |
| `backend/core_services/skills_service.py` | Skills CRUD and S3 sync |
| `backend/core_services/tool_config_service.py` | Per-user tool configuration |
| `backend/core_services/cron_service.py` | Cron job CRUD, EventBridge Scheduler management |
| `backend/cron_executor/handler.py` | Cron job executor Lambda (SQS → AgentCore invoke) |

## Key frontend files

| File | Purpose |
|------|---------|
| `src/App.jsx` | Root component, auth flow, theme, sidebar layout |
| `src/config.js` | Amplify/Cognito config, model config parsing |
| `src/components/Agent/AgentInterface.jsx` | Main chat interface |
| `src/components/Agent/ChatInput.jsx` | Message input with attachments, model selector |
| `src/components/Agent/CanvasPanel.jsx` | Side panel for canvas content |
| `src/components/Agent/context/api.js` | Backend API client |
| `src/components/Agent/context/streamChunkHandler.js` | SSE stream chunk processing |
| `src/components/Agent/useChatSessionFunctions.js` | Chat session state management |
| `src/pages/ToolConfig/ToolConfigPage.jsx` | Tool and MCP server configuration UI |
| `src/pages/Skills/SkillsPage.jsx` | Skills management UI |
| `src/pages/Projects/ProjectsPage.jsx` | Projects management UI |
| `src/pages/CronJobs/CronJobsPage.jsx` | Cron jobs management UI (list, detail, create/edit, execution history) |
| `src/services/cronJobsService.js` | Cron jobs API client |

## Terraform modules

All in `infra/`. Key files:

| File | Resources |
|------|-----------|
| `sparky.tf` | Sparky AgentCore runtime, ECR repo, IAM roles |
| `core_services.tf` | Core Services AgentCore runtime, ECR repo, IAM roles |
| `cognito.tf` | User pool, app client, domain |
| `dynamodb.tf` | Chat history, tool config, skills tables |
| `s3.tf` | Artifact and skills buckets |
| `kb_indexing.tf` | KB indexer Lambda, SQS queue, Bedrock Knowledge Base, data source |
| `expiry_cleanup.tf` | Expiry cleanup Lambda, SQS queue, EventBridge Pipe |
| `projects.tf` | Project DynamoDB tables, S3 bucket, Bedrock KB for projects |
| `amplify.tf` | Amplify app and branch |
| `checkpointer.tf` | Checkpoint DynamoDB table and S3 bucket |
| `agentcore_memory.tf` | AgentCore Memory resource |
| `system_skills.tf` | S3 upload of system-skills to skills bucket |
| `cron_jobs.tf` | Cron job DynamoDB tables, SQS queue, executor Lambda, EventBridge Scheduler IAM |
| `project_memory.tf` | Project memory AgentCore resource |
| `variables.tf` | All input variables including model config |

## Code style

### Frontend (JavaScript/JSX)

- ESLint + Prettier enforced
- Double quotes, semicolons, 2-space indent, Unix line endings, trailing commas (es5)
- `printWidth: 100`
- React 18 with automatic JSX runtime (no `import React`)
- Functional components only, hooks for state
- Path alias: `@/` → `src/`
- Tailwind CSS for styling, shadcn/ui components in `src/components/ui/`

### Backend (Python)

- Python 3.12, no shared virtualenv across services
- FastAPI for HTTP, uvicorn for serving
- Type hints used throughout (TypedDict, Optional, etc.)
- Logging via `logging` module, structured format
- Async/await for I/O-bound operations
- No linter config committed — follow existing patterns (snake_case, docstrings on public functions)

### Infrastructure (Terraform)

- HCL formatting: `terraform fmt`
- Variables in `variables.tf`, outputs in `outputs.tf`, locals in `locals.tf`
- Resource naming: `${var.env}-sparky-*`
- Default tags applied via provider block

## Testing

### Frontend

```bash
npm test              # Vitest, jsdom environment, run once
```

Test files live alongside source. Vitest config in `vitest.config.js`. Uses `@testing-library/react` and `@testing-library/jest-dom`.

### Backend

No test framework is currently configured for the Python backend. When adding tests, use `pytest` and follow the existing module structure.

## Docker builds

Both runtimes use multi-stage Docker builds: Node 20 slim → Python 3.12 slim. The Node toolchain (node, npm, npx) is copied into the Python image for MCP server support.

```dockerfile
# Pattern used by both Dockerfiles
FROM node:20-slim AS node
FROM python:3.12-slim
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
```

Images run as non-root user `bedrock_agentcore` (UID 1000). Sparky exposes ports 8080 and 8000. Core Services exposes port 8080.

## Environment variables

### Sparky runtime (required)

- `SPARKY_MODEL_CONFIG` — JSON blob from Terraform with model definitions
- `MEMORY_ID` — AgentCore Memory resource ID
- `CHECKPOINT_TABLE` — DynamoDB table for LangGraph checkpoints
- `CHECKPOINT_BUCKET` — S3 bucket for checkpoint offload (optional)
- `REGION` — AWS region

### Core Services runtime

- `CHAT_HISTORY_TABLE`, `TOOL_CONFIG_TABLE`, `KB_ID`, `RERANK_MODEL_ARN`, `MODEL_ID`, `REGION`

### Frontend (.env generated by deployment.sh)

- `VITE_APP_SPARKY` — Sparky AgentCore runtime ARN
- `VITE_COGNITO_DOMAIN`, `VITE_COGNITO_REGION`, `VITE_USER_POOL_ID`, `VITE_APP_CLIENT_ID`
- `VITE_REDIRECT_SIGN_IN`, `VITE_REDIRECT_SIGN_OUT`
- `VITE_SPARKY_MODEL_CONFIG` — JSON model config for frontend model selector

## Model configuration

All model config is centralized in `infra/variables.tf` (`sparky_models` variable). Single source of truth for backend and frontend. Each model has: `id`, `model_id`, `label`, `description`, `max_tokens`, `reasoning_type` (budget or effort), `budget_mapping`/`effort_mapping`, and optional `beta_flags`.

Default models: Claude Opus 4.6, Sonnet 4.6, Opus 4.5, Haiku 4.5.

To add a model: add an entry to `sparky_models.models` in `variables.tf` and redeploy.

## System skills

Located in `system-skills/`. Each skill has a `SKILL.md` (YAML frontmatter + instruction prompt), optional `scripts/` and `references/` directories. Terraform syncs them to S3 on deploy.

Current skills: `create-ppt`, `create-pdf`, `skill-authoring-best-practices`.

## Security considerations

- All API requests require Cognito JWT tokens validated by AgentCore runtime
- Session ownership validated before processing (user_sub from JWT)
- Docker containers run as non-root
- DynamoDB TTL and S3 lifecycle for data expiry (configurable 30-365 days)
- No secrets in code — all sensitive config via environment variables from Terraform
- CORS configured on FastAPI apps
- Code interpreter and browser run in sandboxed AgentCore sessions

## Common tasks

### Add a new tool to the agent

1. Define the tool function in `backend/sparky/tools.py` using `@tool` decorator
2. Register it in `backend/sparky/agent.py` lifespan (add to `ALL_AVAILABLE_TOOLS`)
3. Add to `CORE_TOOLS` or `OPTIONAL_TOOL_NAMES` in `backend/sparky/agent_manager.py`
4. If configurable, add a `ToolDefinition` in `backend/sparky/tool_registry.py`

### Add a new system skill

1. Create `system-skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`) and instruction prompt
2. Optionally add `scripts/` and `references/` directories
3. Run `terraform apply` to sync to S3

### Add a new frontend page

1. Create page component in `src/pages/<Name>/`
2. Add route in `src/components/AppLayoutMFE/AppLayoutMFE.jsx`
3. Add sidebar navigation in `src/components/Sidebar/`

### Add a new Bedrock model

1. Add entry to `sparky_models` in `infra/variables.tf`
2. Redeploy backend (`./deployment.sh`)

### Add a cron job

1. User creates a job via the `/cron-jobs` UI (name, schedule expression, prompt)
2. `core_services` writes to `cron_jobs` DynamoDB table and creates an EventBridge Scheduler schedule
3. EventBridge sends `{job_id, user_id}` to the `cron-execution` SQS queue on schedule
4. `cron_executor` Lambda reads the job, invokes Sparky AgentCore runtime with the prompt, and records the execution result
5. User views execution history and output in the UI

Key files: `backend/core_services/cron_service.py`, `backend/cron_executor/handler.py`, `infra/cron_jobs.tf`, `src/pages/CronJobs/CronJobsPage.jsx`
