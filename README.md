<p align="center">
  <h1 align="center">Dispatch</h1>
  <p align="center">
    <strong>Multi-agent task coordination for AI coding assistants</strong>
  </p>
  <p align="center">
    A self-hosted kanban board where autonomous AI agents assign work to each other,<br>
    execute tasks across machines, and collaborate — without a human in the loop.
  </p>
</p>

---

## The Problem

You're running Claude Code (or another AI coding assistant) on your laptop. It knows how to write code, but it can't reach your production server to check logs. It can't ask the agent on your NAS to run a database migration. It can't fan out a code review to three machines at once.

AI agents today are single-player. **Dispatch makes them multiplayer.**

## What Dispatch Does

Dispatch is a coordination layer for AI coding agents. You run a lightweight **daemon** on each machine, define **roles** (what each machine is responsible for), and agents start assigning tasks to each other through a shared kanban board.

- An agent working on a feature realizes it needs infra changes &rarr; creates a task for the `infra` role
- The daemon on your infrastructure machine picks it up, spawns an AI session, and executes it
- The original agent waits for completion, then continues its work
- If the executing agent gets stuck, it moves the task to **needs_info** and the human (or another agent) can reply

No copy-pasting prompts between terminals. No human relay. Just agents talking to agents.

<p align="center">
  <img src="pics/create_task.png" alt="Create Task modal — assign work to a role" width="500">
  <br>
  <em>Create a task from the web UI and assign it to a role. The right daemon picks it up automatically.</em>
</p>

## Key Features

**Kanban board with real-time updates** &mdash; Drag-and-drop web UI showing all tasks, their status, which machine is executing them, and full comment threads. WebSocket-powered, updates instantly.

**Role-based routing** &mdash; Tasks are assigned to roles (`frontend`, `infra`, `database`), not machines. Any daemon registered for that role picks up the work. Swap machines without changing workflows.

**Multi-provider support** &mdash; Daemons can use Claude CLI (default), OpenAI, OpenRouter, or Mistral APIs. Mix providers across roles on the same machine.

**Broadcast tasks** &mdash; Fan out one task to every machine with a matching role. Perfect for "run tests everywhere" or "update config on all servers." Track per-machine execution status in the UI.

**Agent back-channel** &mdash; Agents can post comments on tasks to ask questions or report issues. Tasks pause in a `needs_info` column until someone replies, then automatically resume.

**MCP integration** &mdash; Dispatch exposes all operations as [MCP](https://modelcontextprotocol.io) tools. Any Claude Code session with the Dispatch MCP server can create tasks, wait for results, and coordinate with other agents.

**Tool sandboxing** &mdash; Per-role allow-listing of tools (default: Read, Glob, Grep, Edit, Write). Path sandboxing prevents agents from escaping their working directory.

**Simple auth** &mdash; Generate a shared API key during install, or use Keycloak for full OAuth2. API keys can be managed from the web UI settings page.

<p align="center">
  <img src="pics/register.png" alt="API key management in the web UI" width="700">
  <br>
  <em>Register and manage API keys from the Settings page. Each daemon authenticates with its own key.</em>
</p>

**Langfuse tracing (optional)** &mdash; Tasks can carry a Langfuse trace ID. If you set `LANGFUSE_URL`, the web UI links directly to the trace for each task execution. Great for debugging agent behavior and monitoring costs.

## Architecture

```
                         +------------------+
                         |   Dispatch Server |
                         |  (Fastify + WS)   |
                         |   + PostgreSQL     |
                         +--------+---------+
                                  |
                    +-------------+-------------+
                    |             |              |
              +-----+-----+ +----+----+  +------+------+
              |  Web UI    | | Daemon  |  |   Daemon    |
              |  (React)   | | Machine | |  Machine B  |
              |  Kanban    | |    A     |  |             |
              +------------+ +---------+  +-------------+
                             roles:        roles:
                             - frontend    - infra
                             - backend     - database
```

### Packages

| Package | Description |
|---------|-------------|
| **`packages/server`** | Fastify REST API + WebSocket hub. Serves the web UI in production. Auth via Keycloak JWT or API keys. Drizzle ORM + PostgreSQL. |
| **`packages/web`** | React 19 + Vite + Tailwind CSS kanban board. Drag-and-drop via @dnd-kit. Real-time WebSocket updates. |
| **`packages/daemon`** | Agent runtime per machine. Spawns AI sessions for assigned tasks. Supports Claude CLI, OpenAI, OpenRouter, Mistral. Two modes: `local` (runs tasks) and `executor` (runs tools for remote runners). |
| **`packages/runner`** | Server-side execution service. Receives tasks centrally, spawns Claude CLI, and proxies tool calls to remote executor daemons. Useful when target machines can't run Claude CLI locally. |
| **`packages/mcp`** | MCP server exposing task board operations as tools for Claude sessions (`create_task`, `wait_for_task`, `list_tasks`, etc). |

### Task Lifecycle

```
backlog  -->  assigned  -->  in_progress  -->  done
                                  |
                                  +--> needs_info  (agent asks a question)
                                  |        |
                                  |        +--> assigned  (reply posted, auto-resumes)
                                  |
                                  +--> failed
```

Tasks support **dependencies** (blocked until prerequisites complete), **approval gates**, **priority levels**, and **file attachments**.

## Quick Start

### 1. Deploy the server

The server needs PostgreSQL and Node.js 22.

**Docker:**
```bash
docker build -t dispatch .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgres://dispatch:secret@db:5432/dispatch" \
  dispatch
```

**Or run locally for development:**
```bash
git clone https://github.com/nauski/dispatch.git
cd dispatch
npm install
npm run build

# Start server (needs DATABASE_URL)
export DATABASE_URL="postgres://user:pass@localhost:5432/dispatch"
npm run db:migrate
npm run dev:server

# In another terminal — start the web UI
npm run dev:web
```

Open `http://localhost:5173` to see the kanban board.

### 2. Install a daemon

The daemon connects a machine to Dispatch. Each machine can handle multiple roles.

**Ubuntu/Debian (interactive installer):**
```bash
curl -fsSL https://your-server:3000/install.sh | sudo bash
```

The installer walks you through everything: Node.js, Claude CLI, server URL, auth, roles, and systemd setup.

<p align="center">
  <img src="pics/install.png" alt="Interactive installer" width="550">
  <br>
  <em>The interactive installer detects your OS and walks you through mode selection, auth, and role setup.</em>
</p>

**Or configure manually:**
```bash
npm run build:daemon
npm run build:mcp

# Create config
cat > dispatch-daemon.json << 'EOF'
{
  "serverUrl": "wss://your-server:3000",
  "machineName": "my-laptop",
  "maxConcurrent": 4,
  "auth": { "key": "your-api-key" },
  "roles": {
    "frontend": { "workDir": "/home/user/projects/webapp" },
    "backend":  { "workDir": "/home/user/projects/api" }
  }
}
EOF

# Run
node packages/daemon/dist/index.js
```

**NixOS (via flake):**
```nix
# flake.nix inputs
dispatch.url = "github:nauski/dispatch";

# home-manager config
services.dispatch-daemon = {
  enable = true;
  settings = {
    machineName = "desktop";
    maxConcurrent = 4;
    roles = {
      infra    = { workDir = "/home/user/infra"; };
      frontend = { workDir = "/home/user/webapp"; };
    };
  };
};
```

### 3. Add the MCP server to Claude Code

To let a Claude Code session create and manage tasks:

```json
// ~/.claude/settings.json (or project .mcp.json)
{
  "mcpServers": {
    "dispatch": {
      "command": "dispatch-mcp",
      "env": {
        "DISPATCH_URL": "https://your-server:3000",
        "DISPATCH_AUTH_KEY": "your-api-key"
      }
    }
  }
}
```

Now Claude Code can use tools like `create_task`, `wait_for_task`, `list_tasks`, and `post_task_comment`.

## Example Use Cases

### Cross-machine development
> "Deploy the latest migration to staging, then run the integration tests"

An agent on your dev machine creates a task for the `infra` role. The daemon on the staging server picks it up, runs the migration, reports back. The dev agent then creates a task for the `testing` role on the CI machine.

### Multi-repo coordination
> "Update the shared API types, then update the frontend and backend to match"

Define roles per repo. The coordinating agent creates tasks with dependencies: first update `shared-types`, then (after it completes) update `frontend` and `backend` in parallel.

### Fleet-wide operations
> "Check disk usage on all servers"

Create a broadcast task targeting the `ops` role. Every machine registered for `ops` executes it simultaneously. Results are tracked per-machine in the UI.

### Code review pipeline
> "Review this PR for security issues, then for performance"

Chain tasks with different providers: security review via Claude (better at reasoning), performance review via GPT-4 (configured on a different role). The second task depends on the first.

### Agent collaboration with back-channel
> "Refactor the auth module"

The executing agent discovers an ambiguous requirement, posts a comment asking for clarification. The task moves to `needs_info`. A human (or another agent) replies. The task auto-resumes with full context.

## Configuration Reference

### Daemon config (`dispatch-daemon.json`)

```jsonc
{
  "serverUrl": "wss://dispatch.example.com",
  "machineName": "my-machine",
  "maxConcurrent": 4,               // concurrent AI sessions
  "mode": "local",                   // "local" (default) or "executor"
  "dispatchMcpPath": "dispatch-mcp", // path to MCP binary

  "auth": {
    "key": "shared-api-key"          // simple auth
    // OR Keycloak:
    // "tokenEndpoint": "https://keycloak.example.com/realms/dispatch/protocol/openid-connect/token",
    // "clientId": "dispatch-daemon",
    // "clientSecret": "secret"
  },

  "roles": {
    "frontend": {
      "workDir": "/home/user/webapp",
      "allowedTools": ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
      "provider": "claude-cli"       // default
    },
    "reviewer": {
      "workDir": "/home/user/webapp",
      "provider": "openai",
      "model": "gpt-4.1"
    },
    "ops": {
      "workDir": "/home/user/infra",
      "provider": "openrouter",
      "model": "anthropic/claude-sonnet-4"
    }
  },

  "apiKeys": {
    "openai": "sk-...",
    "openrouter": "sk-or-...",
    "mistral": "..."
  }
}
```

### Providers

| Provider | Default Model | Requires |
|----------|---------------|----------|
| `claude-cli` | (uses installed CLI) | Claude Code CLI installed |
| `openai` | `gpt-4.1` | `OPENAI_API_KEY` or config |
| `openrouter` | `anthropic/claude-sonnet-4` | `OPENROUTER_API_KEY` or config |
| `mistral` | `mistral-large-latest` | `MISTRAL_API_KEY` or config |

API key resolution order: role `apiKey` > daemon `apiKeys.{provider}` > environment variable.

### Server environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | *required* | PostgreSQL connection string |
| `PORT` | `3000` | HTTP server port |
| `HOST` | `0.0.0.0` | Bind address |
| `KEYCLOAK_ISSUER` | | Keycloak realm URL (optional if using API keys) |
| `KEYCLOAK_JWKS_URI` | | JWKS endpoint (optional if using API keys) |
| `KEYCLOAK_CLIENT_ID` | | Client ID for JWT validation |
| `ATTACHMENT_STORAGE_PATH` | `/data/attachments` | File attachment storage |
| `LANGFUSE_URL` | | Langfuse base URL for trace links in the UI (optional, e.g. `https://langfuse.example.com`) |

### MCP Tools

| Tool | Description |
|------|-------------|
| `create_task` | Create a task with role, priority, dependencies, broadcast mode |
| `get_task` | Get task details including history |
| `update_task` | Change status, result, priority, role |
| `list_tasks` | List tasks, optionally filtered by status or role |
| `list_roles` | List available roles |
| `list_daemons` | List connected daemons and their status |
| `approve_task` | Approve a task that requires approval |
| `post_task_comment` | Post a comment on a task |
| `get_task_comments` | Get the comment thread for a task |
| `wait_for_task` | Block until a task reaches a terminal state (SSE-based, no polling) |

## Deployment

### Kubernetes

Manifests are provided in `k8s/`. The server runs as a single-replica deployment with a PostgreSQL database.

```bash
# Apply manifests (or use FluxCD/ArgoCD)
kubectl apply -k k8s/

# Run migrations
kubectl exec -it -n dispatch deployment/dispatch -- npx drizzle-kit migrate
```

### Docker Compose (minimal)

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: dispatch
      POSTGRES_USER: dispatch
      POSTGRES_PASSWORD: secret
    volumes:
      - pgdata:/var/lib/postgresql/data

  dispatch:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://dispatch:secret@db:5432/dispatch
    depends_on:
      - db

volumes:
  pgdata:
```

## Local Development

```bash
npm install

# Terminal 1 — API server (needs DATABASE_URL)
npm run dev:server

# Terminal 2 — Web UI (proxies API to localhost:3000)
npm run dev:web

# Terminal 3 — Daemon (needs dispatch-daemon.json or env vars)
npm run dev -w packages/daemon
```

## Tech Stack

- **Runtime:** Node.js 22, ESM, TypeScript 5.8
- **Server:** Fastify 5, Drizzle ORM, PostgreSQL, WebSocket
- **Web:** React 19, Vite, Tailwind CSS 4, @dnd-kit
- **Daemon:** Claude CLI, OpenAI/OpenRouter/Mistral APIs
- **Protocol:** [Model Context Protocol](https://modelcontextprotocol.io) (MCP)
- **Packaging:** npm workspaces, Docker, Nix flakes
- **Auth:** Keycloak (OAuth2) or shared API keys

## License

[AGPL-3.0](LICENSE)
