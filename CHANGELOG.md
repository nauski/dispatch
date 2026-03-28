# Changelog

## [Unreleased]

### Changed
- **Rewrite README for open-source launch** — comprehensive docs with problem statement, architecture overview, quick start guide, example use cases, configuration reference, deployment options (Docker Compose, Kubernetes, Nix), and MCP tool reference

### Added
- **Settings page with API key management (US-004)** — new `/settings` route in the web UI with a full API key management interface: list keys (name, prefix, created, last used, status), register new keys, and revoke existing keys with confirmation. Includes client-side routing via `pushState`, gear icon navigation, and consistent Tailwind styling
- **API keys database table (US-001)** — new `api_keys` table with id, name, key_hash, key_prefix, created_at, last_used_at, revoked_at columns for storing hashed API keys
- **Dual auth: JWT + API key (US-002)** — server now accepts both Keycloak JWTs and plain API keys as Bearer tokens. Tokens starting with `eyJ` are verified via JWKS; all others are SHA-256 hashed and looked up in the `api_keys` table. Keycloak config is now optional (empty string = not configured), making API-key-only deployments possible
- **API key management endpoints (US-003)** — `POST/GET/DELETE /api/settings/keys` for registering, listing, and revoking API keys
- **Shared key auth for daemon/runner (US-005)** — daemon and runner now support `auth.key` as a simpler alternative to Keycloak. If set, the key is sent directly on WS connect. Keycloak flow still works when `auth.tokenEndpoint` is configured
- **Install script generates API keys (US-006)** — default auth method is now shared key (generates `openssl rand -hex 32`). Key is displayed during install for registration in the web UI. Keycloak remains available as an advanced option

### Added
- **Runner package (US-004, US-005, US-006)** — new `packages/runner` service that connects to the dispatch server as `type=runner`, receives task assignments, and spawns Claude CLI sessions. File tool calls from Claude are proxied through an MCP server (`mcp-proxy.ts`) that relays `tool:execute` / `tool:result` messages to remote executor daemons via the server's WebSocket. Includes Keycloak auth, reconnection logic, concurrent session limits, and MCP config generation with both `remote-tools` (proxy) and `dispatch` (task management) servers.
- **Executor mode for daemon (US-003)** — daemon can now run in `executor` mode (via `mode: "executor"` in config or `DISPATCH_MODE=executor` env var). In executor mode the daemon handles `tool:execute` WebSocket messages instead of `task:assigned`, executing builtin tools (Read, Write, Edit, Glob, Grep, Bash) on behalf of remote runners. Connects with `type=executor` query param. Fully backward compatible — defaults to `local` mode.

### Changed
- **Daemon refactor (US-009)** — extracted `buildPrompt`, `buildConversationalPrompt`, `Task`, `TaskComment` into `packages/daemon/src/prompts.ts` and `writeMcpConfig`, `cleanupMcpConfig` into `packages/daemon/src/mcp-config.ts` for reuse by the runner package

### Added
- **Tool execution WebSocket protocol** — server relays `tool:execute` messages from runners to executors and `tool:result` responses back, with 120s timeout for pending requests
- **Connection type awareness** — WS connections now support `type` query param (`daemon`, `executor`, `runner`) with backward-compatible default to `daemon`
- New ConnectionManager methods: `getExecutorForRole()`, `getRunner()`, `pushToRunner()`, `pushToExecutor()`, `routeTaskAssignment()`
- Smart task routing: tasks assigned to a role with no daemon but with an executor are forwarded to the runner with `targetExecutor` metadata
- **Multi-provider daemon support** — roles can now use OpenAI, OpenRouter, or Mistral APIs as alternatives to the Claude CLI
- New `provider`, `model`, `apiKey`, and `baseUrl` fields on role config for selecting and configuring providers
- New `apiKeys` section in daemon config for setting API keys per provider (also supports env vars: `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`)
- Local agentic tool-use loop for API providers: Read, Write, Edit, Glob, Grep, Bash + dispatch API tools (post_task_comment, update_task, get_task_comments)
- Path sandboxing for all file tools (prevents escaping the working directory)
- Rate limit handling with exponential backoff for API providers
- Fully backward compatible — existing configs with no `provider` field default to `claude-cli`
- **Interactive install script** — fully self-contained: installs Node.js 22, Claude CLI, clones the repo, builds, walks through config interactively, and sets up systemd. Available via `curl -fsSL your-server:3000/install.sh | sudo bash`
- Server serves `/install.sh` endpoint for remote daemon installation
- **Task comments / back-channel** — agents can now post comments on tasks to ask questions, report unexpected state, or request clarification during execution
- New `needs_info` task status and kanban column — when an agent needs clarification, the task pauses in this column until a reply is posted
- Pause-and-reassign flow: when a reply is posted on a `needs_info` task, the server auto-transitions it back to `assigned` and re-pushes it to the daemon with full comment thread as context
- `POST /api/tasks/:id/comments` and `GET /api/tasks/:id/comments` server endpoints
- `post_task_comment` and `get_task_comments` MCP tools
- Comments section with reply form in the web UI task detail view
- Real-time comment updates via WebSocket (`task:comment` event)
- Daemon generates temporary MCP config so spawned Claude sessions can call dispatch tools directly (post comments, update task status)
- `dispatchMcpPath` / `DISPATCH_MCP_PATH` daemon config option for locating the dispatch-mcp binary
- Automated database migrations via init container — migrations run before server starts on every deployment
- `dispatch-mcp` Nix package in flake for the MCP server
- NixOS and home-manager modules auto-configure `dispatchMcpPath` so daemon-spawned Claude sessions can use dispatch MCP tools
- CI automatically updates Nix `npmDepsHash` values when package-lock.json files change
- CI automatically restarts deployment after image build (no more manual rollout restarts)

- `wait_for_task` MCP tool — blocks until a delegated task completes, using SSE for realtime push (no polling)
- `GET /api/tasks/:id/wait` SSE endpoint for realtime task completion notifications
- Comment notifications on completed tasks — comments on `done`/`failed` tasks push `task:comment_notification` to daemons, spawning a lightweight conversational session (no status change, agent replies via comments)
- **Broadcast tasks** — fan out a single task to all connected daemons with a matching role. One task card shows aggregated progress across all executions
- New `task_executions` table tracks per-daemon execution status, result, and timestamps for broadcast tasks
- `mode` field on tasks (`single` or `broadcast`), with optional `targets`/`excludeTargets` for machine-level filtering
- Execution-aware daemon status updates — daemons pass through `executionId` so the server tracks per-host progress independently
- Task list API returns `executionSummary` (total/done/failed/inProgress counts) for broadcast tasks
- Task detail view shows per-host execution status with expandable results
- Create task modal includes broadcast toggle and optional target machine filter
- `create_task` MCP tool accepts `mode`, `targets`, and `excludeTargets` parameters
- `task:execution_updated` WebSocket event for real-time execution progress in the UI
- `install.sh` for Ubuntu/Debian — installs daemon, MCP server, systemd unit, and example config

### Changed
- Removed CI deploy stage — deployment now handled by Flux image automation instead of `kubectl rollout restart` (which Flux was reverting)
