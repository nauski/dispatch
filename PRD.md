# PRD: Server-Side Agentic Execution with Remote Tool Execution

## Introduction

Currently, each daemon machine needs Claude CLI installed and authenticated — a convoluted setup involving Node.js, npm global install, OAuth login, ToS acceptance, and folder trust. This PRD introduces **server-side execution mode**: the LLM runs on a central **runner** service (using the user's Claude Max subscription), and daemons become thin **tool executors** that only need Node.js.

Both modes coexist: roles can be configured for local execution (current behavior) or server-side execution (new). The install script defaults to server-side mode, making new machine setup a simple `curl | bash` with zero LLM dependencies.

## Goals

- Daemon machines require only Node.js — no Claude CLI, no OAuth login, no ToS
- Central runner uses existing Claude Max subscription (OAuth token relay via CLI)
- Both local and server-side execution modes coexist, configured per role
- Same role/tool configuration model for both modes (Read, Write, Edit, Glob, Grep, Bash, dispatch tools)
- Install script defaults to server-side mode (thin executor)
- Architecture supports adding multi-provider API execution later

## Architecture

```
                          ┌─────────────────────┐
                          │   Dispatch Server    │
                          │  (Fastify + WS hub)  │
                          └──┬──────┬──────┬────┘
                             │      │      │
               task:assigned │      │      │ tool:execute / tool:result
              + tool routing │      │      │
                             │      │      │
                    ┌────────┴──┐ ┌─┴──────┴────────┐
                    │  Runner   │ │  Executor Daemon  │
                    │ (has LLM) │ │  (just tools)     │
                    └───────────┘ └───────────────────┘
                    Machine A      Machine B (target)
```

**Connection types on the server:**
- `daemon` — current full daemon, handles tasks + tools locally
- `executor` — thin daemon, only executes tool calls
- `runner` — runs LLM sessions, routes tool calls to executors via server

**Task routing:**
1. Task assigned to role X
2. Server checks: is there a `daemon` connected for X? → push to daemon (legacy)
3. Otherwise: find `executor` for X, find `runner` → push task to runner with executor target
4. Runner drives LLM loop, sends `tool:execute` through server to executor
5. Executor runs tool, returns `tool:result` through server to runner

**Tool routing split:**
- File/system tools (Read, Write, Edit, Glob, Grep, Bash) → proxied to executor via WS
- Dispatch tools (post_task_comment, update_task, get_task_comments) → runner calls server REST API directly (no need to proxy)

**Runner LLM execution:**
- Phase 1: spawns `claude -p` with a proxy MCP server that routes file tools to executor
- Phase 2 (later): direct API calls via openai-compat style agentic loop

## User Stories

### US-001: Server — Tool execution WebSocket protocol

**Description:** As a developer, I need the server to route tool execution messages between runners and executors so that LLM sessions can execute tools on remote machines.

**Acceptance Criteria:**
- [ ] New WS message type `tool:execute`: `{type: "tool:execute", requestId: string, targetRole: string, tool: string, params: object}`
- [ ] New WS message type `tool:result`: `{type: "tool:result", requestId: string, output: string, error: boolean}`
- [ ] Server routes `tool:execute` from runner to the executor connected for `targetRole`
- [ ] Server routes `tool:result` from executor back to the runner that sent the request
- [ ] If executor is not connected, return error result immediately
- [ ] Typecheck passes

### US-002: Server — Connection type awareness and task routing

**Description:** As a developer, I need the server to distinguish between daemon, executor, and runner connections so tasks are routed correctly.

**Acceptance Criteria:**
- [ ] ConnectionManager tracks connection type: `daemon | executor | runner`
- [ ] WS handshake accepts `type` query parameter (default `daemon` for backward compat)
- [ ] Task assignment logic: daemon for role → push to daemon; executor for role → push to runner with `{targetExecutor}` metadata
- [ ] Runner connections register which roles they can handle (or all server-side roles)
- [ ] Existing daemon connections work unchanged (backward compatible)
- [ ] Typecheck passes

### US-003: Daemon — Executor mode

**Description:** As a machine operator, I want to run a thin daemon that only executes tool calls so I don't need Claude CLI installed.

**Acceptance Criteria:**
- [ ] New config option `mode: "local" | "executor"` (default `"local"` for backward compat)
- [ ] In executor mode, daemon connects with `type=executor` query param
- [ ] Executor handles `tool:execute` messages using existing `tools/` implementations (Read, Write, Edit, Glob, Grep, Bash)
- [ ] Tool execution respects `allowedTools` config per role
- [ ] Tool execution uses role's `workDir` as sandbox
- [ ] Sends `tool:result` back to server
- [ ] Does NOT handle `task:assigned` messages (ignores them)
- [ ] Typecheck passes

### US-004: Runner — Package skeleton and server connection

**Description:** As a developer, I need the runner service structure so it can connect to the dispatch server, receive task assignments, and report results.

**Acceptance Criteria:**
- [ ] New `packages/runner/` with package.json, tsconfig.json, src/index.ts
- [ ] Connects to dispatch server WS with `type=runner`
- [ ] Authenticates via Keycloak (same as daemon)
- [ ] Receives `task:assigned` messages
- [ ] Sends `task:status` messages (in_progress, done, failed)
- [ ] Config: `serverUrl`, `machineName`, `auth`, `maxConcurrent`, `roles` (roles it handles)
- [ ] Reconnects on disconnect (same pattern as daemon)
- [ ] Typecheck passes

### US-005: Runner — MCP proxy server for remote tool execution

**Description:** As a developer, I need an MCP server that exposes file/system tools but executes them on a remote executor daemon via the dispatch server WebSocket.

**Acceptance Criteria:**
- [ ] New MCP server in `packages/runner/src/mcp-proxy.ts` (or similar)
- [ ] Exposes tools: Read, Write, Edit, Glob, Grep, Bash (matching executor's tool definitions)
- [ ] Each tool call sends `tool:execute` to the dispatch server WS
- [ ] Waits for `tool:result` response (with timeout, default 120s)
- [ ] MCP server accepts env vars: `DISPATCH_WS_URL`, `TARGET_ROLE`, auth credentials
- [ ] Maintains persistent WS connection to server (reuses runner's connection or opens its own)
- [ ] Tool definitions match the schemas in `packages/daemon/src/tools/`
- [ ] Typecheck passes

### US-006: Runner — Task execution with Claude CLI

**Description:** As an operator, I want the runner to use my Claude Max subscription to execute tasks so I don't need a separate API key.

**Acceptance Criteria:**
- [ ] Runner spawns `claude -p` for each task (same pattern as current daemon)
- [ ] MCP config includes: proxy MCP server (file tools → executor) + dispatch MCP server (task comments/updates → server API)
- [ ] `--allowedTools` includes proxy tools + dispatch MCP tools
- [ ] Prompt building reuses `buildPrompt` / `buildConversationalPrompt` from daemon
- [ ] Task result reported to server on completion
- [ ] Comment notifications handled (same as daemon's `handleCommentNotification`)
- [ ] `maxConcurrent` limits respected
- [ ] Typecheck passes

### US-007: Runner — Config, build, and deployment

**Description:** As an operator, I want to deploy the runner alongside my dispatch server with minimal configuration.

**Acceptance Criteria:**
- [ ] Runner config file: `runner.json` with `serverUrl`, `auth`, `maxConcurrent`, `claudePath`
- [ ] Add `build:runner` to root package.json
- [ ] Add runner to `npm run build`
- [ ] Systemd service template for runner
- [ ] Runner can run on same machine as server or separately
- [ ] Dockerfile updated to include runner (optional, can be toggled)
- [ ] CHANGELOG and README updated
- [ ] Typecheck passes

### US-008: Install script — Execution mode selection

**Description:** As a machine operator, I want the install script to ask whether I want local or server-side execution so the right components are installed.

**Acceptance Criteria:**
- [ ] New question during install: "How should this machine run tasks?" with options: 1) Locally (needs Claude CLI) 2) Server-side (thin executor, no Claude needed)
- [ ] Option 1 (local): current full install — Node.js, Claude CLI, full daemon, MCP server
- [ ] Option 2 (server-side): Node.js only, daemon in executor mode, no Claude CLI install, no MCP server needed
- [ ] Default: option 2 (server-side)
- [ ] Executor mode config generated with `"mode": "executor"`
- [ ] Skip Claude CLI install + login instructions for executor mode
- [ ] End-of-install instructions differ per mode
- [ ] Typecheck passes (for any generated configs)

### US-009: Shared prompt/config utilities

**Description:** As a developer, I need the prompt building and config loading logic shared between daemon and runner so we don't duplicate code.

**Acceptance Criteria:**
- [ ] Extract `buildPrompt`, `buildConversationalPrompt` to a shared location (e.g., `packages/daemon/src/prompts.ts` or a shared package)
- [ ] Runner imports and reuses these functions
- [ ] MCP config generation (for Claude CLI) extracted and shared
- [ ] No behavior change to existing daemon
- [ ] Typecheck passes

## Non-Goals

- No multi-provider support in runner for Phase 1 (Anthropic API, OpenAI, etc.) — Claude CLI only
- No streaming of tool output — tool results are returned in full when complete
- No direct runner-to-executor connections (always routed through server)
- No web UI changes — tasks look the same regardless of execution mode
- No changes to the MCP package (`packages/mcp`)
- No runner auto-scaling or load balancing

## Technical Considerations

- **Reuse existing code:** The `tools/` directory in the daemon package already implements all file/system tools. The executor mode just wires incoming WS messages to these implementations.
- **Prompt reuse:** `buildPrompt` and `buildConversationalPrompt` are provider-agnostic (markdown) and work for both local and server-side execution.
- **MCP proxy complexity:** The proxy MCP server needs a persistent WS connection to the dispatch server. Since it's spawned as a child process by `claude -p`, it must manage its own connection lifecycle. Consider using the runner's existing WS connection via IPC/stdin-stdout instead.
- **Request correlation:** `tool:execute` / `tool:result` messages use `requestId` (UUID) for correlation. The server maintains a map of pending requests to route results back.
- **Timeouts:** If an executor disconnects mid-tool-execution, the server should return an error result to the runner after a timeout.
- **OAuth token sharing:** The runner uses the Claude CLI, which manages its own OAuth tokens. The operator runs `claude /login` once on the runner machine. This is a one-time setup vs. per-target-machine setup.
- **Later: multi-provider:** Phase 2 adds an API-based agentic loop to the runner (reusing `openai-compat.ts` pattern with Anthropic API support). Tool execution uses the same WS protocol — only the LLM driver changes.

## Implementation Order

1. US-001 + US-002 (server WS protocol + routing) — foundation
2. US-003 (daemon executor mode) — can test with manual WS messages
3. US-009 (extract shared utilities) — needed before runner
4. US-004 (runner skeleton) — connects and receives tasks
5. US-005 (MCP proxy) — enables remote tool execution
6. US-006 (runner task execution) — end-to-end flow works
7. US-007 (runner deployment) — production-ready
8. US-008 (install script) — user-facing install experience
