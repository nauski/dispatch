#!/usr/bin/env bash
set -uo pipefail

# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  Dispatch Daemon Installer                                                  ║
# ║                                                                              ║
# ║  Usage:                                                                      ║
# ║    curl -fsSL your-server:3000/install.sh | sudo bash                  ║
# ║    — or —                                                                    ║
# ║    sudo ./install.sh          (from repo root)                               ║
# ║                                                                              ║
# ║  Handles: Node.js 22, Claude Code CLI, git clone, build, config, systemd    ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

INSTALL_DIR="/opt/dispatch"
CONFIG_DIR="/etc/dispatch"
CONFIG_FILE="$CONFIG_DIR/daemon.json"
DAEMON_USER="${DISPATCH_USER:-dispatch}"
REPO_URL="${DISPATCH_REPO_URL:-https://github.com/nauski/dispatch.git}"
REPO_HTTPS="${DISPATCH_REPO_HTTPS:-https://github.com/nauski/dispatch.git}"
SPINNER_LOG=$(mktemp /tmp/dispatch-install-XXXXXX.log)

# When piped via curl | bash, stdin is the script — redirect interactive
# input from /dev/tty so read/confirm/ask work properly.
exec 3</dev/tty 2>/dev/null || exec 3<&0

# ─── Colors & UI ─────────────────────────────────────────────────────────────

BOLD='\033[1m'
DIM='\033[2m'
ITALIC='\033[3m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'

info() { echo -e "  ${GREEN}>>>${NC} $1"; }
warn() { echo -e "  ${YELLOW}!! ${NC} $1"; }
err() { echo -e "  ${RED}!!!${NC} $1"; }
step() { echo -e "\n ${CYAN}${BOLD}[$1/$TOTAL_STEPS]${NC} ${BOLD}$2${NC}"; }
dim() { echo -e "  ${DIM}$1${NC}"; }
ok() { echo -e "  ${GREEN}${BOLD}OK ${NC} $1"; }

# Animated spinner — runs command in background, shows progress
spin() {
  local pid=$1 msg="${2:-Working...}"
  local chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0
  tput civis 2>/dev/null || true
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${CYAN}%s${NC} ${DIM}%s${NC}" "${chars:$((i % 10)):1}" "$msg"
    sleep 0.08
    i=$((i + 1))
  done
  local rc=0
  wait "$pid" || rc=$?
  tput cnorm 2>/dev/null || true
  printf "\r%-70s\r" " "
  return $rc
}

with_spinner() {
  local msg="$1"
  shift
  "$@" >>"$SPINNER_LOG" 2>&1 &
  if ! spin $! "$msg"; then
    err "$msg — failed! Last output:"
    tail -10 "$SPINNER_LOG" | while IFS= read -r line; do dim "  $line"; done
    exit 1
  fi
}

# All reads come from fd 3 (/dev/tty when piped, stdin otherwise)
ask() {
  local prompt="$1" default="$2" var_name="$3"
  if [[ -n "$default" ]]; then
    printf "  ${BOLD}?${NC} %s ${DIM}[%s]${NC}: " "$prompt" "$default"
  else
    printf "  ${BOLD}?${NC} %s: " "$prompt"
  fi
  read -r value <&3
  eval "$var_name=\"\${value:-\$default}\""
}

ask_secret() {
  local prompt="$1" var_name="$2"
  printf "  ${BOLD}?${NC} %s: " "$prompt"
  read -rs value <&3
  echo ""
  eval "$var_name=\"\$value\""
}

confirm() {
  local prompt="$1" default="${2:-y}"
  local hint="Y/n"
  [[ "$default" == "n" ]] && hint="y/N"
  printf "  ${BOLD}?${NC} %s ${DIM}[%s]${NC}: " "$prompt" "$hint"
  read -r answer <&3
  answer="${answer:-$default}"
  [[ "${answer,,}" == "y" || "${answer,,}" == "yes" ]]
}

cleanup() {
  tput cnorm 2>/dev/null || true
  exec 3<&- 2>/dev/null || true
  rm -f "$SPINNER_LOG" 2>/dev/null || true
}
trap cleanup EXIT

TOTAL_STEPS=8

# ─── Banner ───────────────────────────────────────────────────────────────────

clear 2>/dev/null || true
echo ""
echo -e "${CYAN}"
cat <<'BANNER'

        ·····························
       ·· ┌──────────────────────┐ ··
      ·   │    D I S P A T C H   │   ·
       ·· └──────────────────────┘ ··
        ·····························

BANNER
echo -e "${NC}"
echo -e "  ${BOLD}Agent Daemon Installer${NC}"
echo -e "  ${DIM}Sets up everything needed to run dispatch agents on this machine.${NC}"
echo ""
echo -e "  ${DIM}────────────────────────────────────────────────────────${NC}"
echo ""

# ─── Root check ──────────────────────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root."
  echo ""
  echo -e "  ${DIM}Usage:${NC}"
  echo -e "    ${CYAN}curl -fsSL your-server:3000/install.sh | sudo bash${NC}"
  echo -e "    ${CYAN}sudo ./install.sh${NC}"
  echo ""
  exit 1
fi

# ─── OS detection ────────────────────────────────────────────────────────────

if [[ -f /etc/os-release ]]; then
  source /etc/os-release
  dim "Detected: $PRETTY_NAME"
  if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
    warn "This installer is built for Ubuntu/Debian"
    if ! confirm "Continue on $ID anyway?" "n"; then exit 0; fi
  fi
else
  warn "Cannot detect OS"
  if ! confirm "Continue anyway?" "n"; then exit 0; fi
fi

# ─── Execution mode ──────────────────────────────────────────────────────────

echo -e "  ${BOLD}What does this machine do?${NC}"
echo ""
echo -e "  ${DIM}  1) ${NC}${BOLD}Hands only${NC} ${DIM}(default) — executes tools, AI brain runs elsewhere${NC}"
echo -e "  ${DIM}     No Claude CLI needed. Just Node.js.${NC}"
echo ""
echo -e "  ${DIM}  2) ${NC}${BOLD}Hands + brain${NC} ${DIM}— executes tools AND runs AI for remote machines${NC}"
echo -e "  ${DIM}     Installs Claude CLI. This machine drives thin daemons elsewhere.${NC}"
echo ""
echo -e "  ${DIM}  3) ${NC}${BOLD}Standalone${NC} ${DIM}— AI + tools, no remote execution${NC}"
echo -e "  ${DIM}     Installs Claude CLI. Tasks run entirely on this machine.${NC}"
echo ""
ask "Mode" "1" EXEC_MODE_CHOICE
case "$EXEC_MODE_CHOICE" in
2 | brain) EXEC_MODE="executor"; INSTALL_RUNNER=true ;;
3 | standalone | local) EXEC_MODE="local"; INSTALL_RUNNER=false ;;
*) EXEC_MODE="executor"; INSTALL_RUNNER=false ;;
esac

case "$EXEC_MODE_CHOICE" in
2*) ok "Mode: hands + brain (executor + runner)" ;;
3*) ok "Mode: standalone" ;;
*) ok "Mode: hands only (executor)" ;;
esac
echo ""

# ─── Step 1: Git ─────────────────────────────────────────────────────────────

step 1 "Git"

if command -v git &>/dev/null; then
  ok "git $(git --version | cut -d' ' -f3)"
else
  info "Installing git..."
  with_spinner "apt-get install git" apt-get update -qq && apt-get install -y -qq git
  ok "git installed"
fi

# ─── Step 2: Node.js 22 ──────────────────────────────────────────────────────

step 2 "Node.js 22"

NEED_NODE=false
if command -v node &>/dev/null; then
  NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
  if [[ "$NODE_MAJOR" -ge 22 ]]; then
    ok "Node.js $(node -v)"
  else
    warn "Found Node.js $(node -v) but 22+ is required"
    NEED_NODE=true
  fi
else
  NEED_NODE=true
fi

if [[ "$NEED_NODE" == "true" ]]; then
  info "Installing Node.js 22 via NodeSource..."
  with_spinner "Adding NodeSource repository" bash -c \
    "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"
  with_spinner "Installing nodejs" apt-get install -y -qq nodejs
  ok "Node.js $(node -v)"
fi

# ─── Step 3: Claude Code CLI ─────────────────────────────────────────────────

step 3 "Claude Code CLI"

if [[ "$EXEC_MODE" == "executor" ]] && ! $INSTALL_RUNNER; then
  ok "Skipped (not needed for hands-only mode)"
else
  if command -v claude &>/dev/null; then
    ok "Claude CLI at $(which claude)"
  else
    info "Installing Claude Code CLI..."
    with_spinner "npm install -g @anthropic-ai/claude-code" \
      npm install -g @anthropic-ai/claude-code
    if command -v claude &>/dev/null; then
      ok "Claude CLI installed"
    else
      err "Installation failed — try manually: npm install -g @anthropic-ai/claude-code"
      exit 1
    fi
  fi
fi

# ─── Step 4: Clone & build ───────────────────────────────────────────────────

step 4 "Clone & build"

# Detect if we're inside the repo already
REPO_DIR=""
if [[ -f "./package.json" ]] && grep -q '"dispatch"' ./package.json 2>/dev/null; then
  REPO_DIR="$(pwd)"
  ok "Already in dispatch repo at $REPO_DIR"
elif [[ -f "/tmp/dispatch/package.json" ]]; then
  REPO_DIR="/tmp/dispatch"
  info "Using existing clone at $REPO_DIR"
else
  info "Cloning dispatch repository..."
  # Try SSH non-interactively (no host key prompts), fall back to HTTPS
  if GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new" \
    git clone --depth 1 "$REPO_URL" /tmp/dispatch 2>/dev/null; then
    ok "Cloned via SSH"
  elif git clone --depth 1 "$REPO_HTTPS" /tmp/dispatch 2>/dev/null; then
    ok "Cloned via HTTPS"
  else
    err "Failed to clone repository"
    err "Ensure you have access to $REPO_URL"
    err "Or clone manually and run: sudo ./install.sh"
    exit 1
  fi
  REPO_DIR="/tmp/dispatch"
fi

cd "$REPO_DIR"
info "Installing npm dependencies..."
with_spinner "npm install" npm install
info "Building packages..."
with_spinner "npm run build" npm run build
ok "Build complete"

# ─── Step 5: System user ─────────────────────────────────────────────────────

step 5 "System user"

if id "$DAEMON_USER" &>/dev/null; then
  ok "User '$DAEMON_USER' exists"
else
  useradd --system --create-home --shell /usr/sbin/nologin "$DAEMON_USER"
  ok "Created user '$DAEMON_USER'"
fi

if [[ "$EXEC_MODE" == "local" ]] || $INSTALL_RUNNER; then
  DAEMON_HOME=$(getent passwd "$DAEMON_USER" | cut -d: -f6)
  CLAUDE_DIR="${DAEMON_HOME:-/home/$DAEMON_USER}/.claude"
  mkdir -p "$CLAUDE_DIR"

  if [[ ! -f "$CLAUDE_DIR/.credentials.json" ]]; then
    # Try to copy credentials from the current sudo user
    SUDO_USER_HOME=$(getent passwd "${SUDO_USER:-$USER}" | cut -d: -f6)
    if [[ -n "$SUDO_USER_HOME" && -f "$SUDO_USER_HOME/.claude/.credentials.json" ]]; then
      info "Copying Claude credentials from $SUDO_USER_HOME..."
      cp "$SUDO_USER_HOME/.claude/.credentials.json" "$CLAUDE_DIR/.credentials.json"
      ok "Claude credentials copied"
    else
      warn "No Claude credentials found to copy"
      echo -e "  ${DIM}After install, copy credentials manually:${NC}"
      echo -e "  ${DIM}  sudo cp ~/.claude/.credentials.json $CLAUDE_DIR/.credentials.json${NC}"
      echo -e "  ${DIM}  sudo chown $DAEMON_USER:$DAEMON_USER $CLAUDE_DIR/.credentials.json${NC}"
    fi
  else
    ok "Claude credentials already present"
  fi

  echo '{}' >"$CLAUDE_DIR/settings.json" 2>/dev/null || true
  chown -R "$DAEMON_USER:$DAEMON_USER" "$CLAUDE_DIR"
fi

# ─── Step 6: Install binaries ────────────────────────────────────────────────

step 6 "Install binaries"

# Daemon
info "Copying daemon artifacts..."
mkdir -p "$INSTALL_DIR/daemon"
cp -r packages/daemon/dist/* "$INSTALL_DIR/daemon/"
cp packages/daemon/package.json "$INSTALL_DIR/daemon/"
with_spinner "Installing daemon dependencies" bash -c \
  "cd $INSTALL_DIR/daemon && npm install --omit=dev --no-audit --no-fund"
ok "Daemon installed"

# MCP server (only needed for local mode — executor doesn't use it)
if [[ "$EXEC_MODE" == "local" ]]; then
  info "Copying MCP artifacts..."
  mkdir -p "$INSTALL_DIR/mcp"
  cp -r packages/mcp/dist/* "$INSTALL_DIR/mcp/"
  cp packages/mcp/package.json "$INSTALL_DIR/mcp/"
  with_spinner "Installing MCP dependencies" bash -c \
    "cd $INSTALL_DIR/mcp && npm install --omit=dev --no-audit --no-fund"
  ok "MCP server installed"
fi

# Runner (if requested)
if $INSTALL_RUNNER; then
  info "Copying runner artifacts..."
  mkdir -p "$INSTALL_DIR/runner"
  cp -r packages/runner/dist/* "$INSTALL_DIR/runner/"
  cp packages/runner/package.json "$INSTALL_DIR/runner/"
  with_spinner "Installing runner dependencies" bash -c \
    "cd $INSTALL_DIR/runner && npm install --omit=dev --no-audit --no-fund"
  ok "Runner installed"
fi

# Wrapper scripts
cat >/usr/local/bin/dispatch-daemon <<'WRAPPER'
#!/usr/bin/env bash
exec node /opt/dispatch/daemon/index.js "$@"
WRAPPER
chmod +x /usr/local/bin/dispatch-daemon

if [[ "$EXEC_MODE" == "local" ]]; then
  cat >/usr/local/bin/dispatch-mcp <<'WRAPPER'
#!/usr/bin/env bash
exec node /opt/dispatch/mcp/index.js "$@"
WRAPPER
  chmod +x /usr/local/bin/dispatch-mcp
fi

if $INSTALL_RUNNER; then
  cat >/usr/local/bin/dispatch-runner <<'WRAPPER'
#!/usr/bin/env bash
exec node /opt/dispatch/runner/index.js "$@"
WRAPPER
  chmod +x /usr/local/bin/dispatch-runner
fi

ok "Installed to /usr/local/bin/"

# ─── Step 7: Interactive config ──────────────────────────────────────────────

step 7 "Configure"

SKIP_CONFIG=false
if [[ -f "$CONFIG_FILE" ]]; then
  warn "Config already exists at $CONFIG_FILE"
  if ! confirm "Overwrite with fresh config?" "n"; then
    SKIP_CONFIG=true
    ok "Keeping existing config"
  fi
fi

if [[ "$SKIP_CONFIG" == "false" ]]; then
  echo ""
  echo -e "  ${DIM}Let's configure the daemon. Press Enter to accept ${BOLD}[defaults]${NC}${DIM}.${NC}"
  echo ""

  # ── Basics ──
  DEFAULT_MACHINE=$(hostname -s 2>/dev/null || hostname)
  ask "Machine name" "$DEFAULT_MACHINE" MACHINE_NAME
  ask "Dispatch server URL" "wss://your-server:3000" SERVER_URL

  NPROC=$(nproc 2>/dev/null || echo 4)
  DEFAULT_CONCURRENT=$((NPROC > 8 ? 8 : NPROC))
  ask "Max concurrent sessions" "$DEFAULT_CONCURRENT" MAX_CONCURRENT

  # ── Auth ──
  echo ""
  echo -e "  ${DIM}── Authentication ──${NC}"
  echo -e "  ${DIM}  1) ${NC}${BOLD}Shared key${NC} ${DIM}(default) — generate a random key, register it in the web UI${NC}"
  echo -e "  ${DIM}  2) ${NC}${BOLD}Keycloak${NC} ${DIM}— OAuth2 client credentials flow${NC}"
  echo ""
  ask "Auth method" "1" AUTH_METHOD_CHOICE
  AUTH_METHOD="key"
  [[ "$AUTH_METHOD_CHOICE" == "2" || "$AUTH_METHOD_CHOICE" == "keycloak" ]] && AUTH_METHOD="keycloak"

  AUTH_KEY=""
  TOKEN_ENDPOINT=""
  CLIENT_ID=""
  CLIENT_SECRET=""

  if [[ "$AUTH_METHOD" == "key" ]]; then
    AUTH_KEY=$(openssl rand -hex 32)
    ok "API key generated (will be shown at the end)"
  else
    ask "Token endpoint" "https://keycloak.example.com/realms/master/protocol/openid-connect/token" TOKEN_ENDPOINT
    ask "Client ID" "dispatch-daemon" CLIENT_ID
    ask_secret "Client secret" CLIENT_SECRET
    [[ -z "$CLIENT_SECRET" ]] && {
      warn "Empty secret — edit $CONFIG_FILE before starting"
      CLIENT_SECRET="CHANGEME"
    }
  fi

  # ── Roles ──
  echo ""
  echo -e "  ${DIM}── Roles ──${NC}"
  echo -e "  ${DIM}Each role has a name and a working directory.${NC}"
  echo -e "  ${DIM}Tasks assigned to a role execute in that directory.${NC}"
  echo ""

  declare -A ROLES
  ROLE_ORDER=()

  while true; do
    ask "Role name (empty to finish)" "" ROLE_NAME
    [[ -z "$ROLE_NAME" ]] && break

    DAEMON_HOME=$(getent passwd "$DAEMON_USER" | cut -d: -f6)
    DEFAULT_WORKDIR="${DAEMON_HOME:-/home/$DAEMON_USER}/$ROLE_NAME"
    echo -e "  ${DIM}  Working directory: 1) ${DEFAULT_WORKDIR} (default)  2) custom path${NC}"
    ask "  Working directory" "1" WORKDIR_CHOICE
    case "$WORKDIR_CHOICE" in
    1) ROLE_WORKDIR="$DEFAULT_WORKDIR" ;;
    2)
      ask "  Enter path" "" ROLE_WORKDIR
      [[ -z "$ROLE_WORKDIR" ]] && { warn "Skipped — no workDir"; continue; }
      ;;
    *)
      # Treat any other input as a literal path
      ROLE_WORKDIR="$WORKDIR_CHOICE"
      ;;
    esac

    ROLE_PROVIDER="claude-cli"
    ROLE_MODEL=""
    ROLE_TOOLS=""

    if [[ "$EXEC_MODE" == "local" ]]; then
      # Provider selection only matters for local mode
      echo -e "  ${DIM}  Providers: 1) claude-cli  2) openai  3) openrouter  4) mistral${NC}"
      ask "  Provider" "1" PROVIDER_CHOICE
      case "$PROVIDER_CHOICE" in
      2 | openai) ROLE_PROVIDER="openai" ;;
      3 | openrouter) ROLE_PROVIDER="openrouter" ;;
      4 | mistral) ROLE_PROVIDER="mistral" ;;
      *) ROLE_PROVIDER="claude-cli" ;;
      esac

      if [[ "$ROLE_PROVIDER" != "claude-cli" ]]; then
        case "$ROLE_PROVIDER" in
        openai) DEF_MODEL="gpt-4.1" ;;
        openrouter) DEF_MODEL="anthropic/claude-sonnet-4" ;;
        mistral) DEF_MODEL="mistral-large-latest" ;;
        esac
        ask "  Model" "$DEF_MODEL" ROLE_MODEL
      fi
    fi

    if confirm "  Allow Bash tool?" "y"; then
      ROLE_TOOLS='["Read","Glob","Grep","Edit","Write","Bash"]'
    fi

    # Build role JSON
    RJSON="\"workDir\": \"$ROLE_WORKDIR\""
    [[ "$ROLE_PROVIDER" != "claude-cli" ]] && RJSON+=", \"provider\": \"$ROLE_PROVIDER\""
    [[ -n "$ROLE_MODEL" ]] && RJSON+=", \"model\": \"$ROLE_MODEL\""
    [[ -n "$ROLE_TOOLS" ]] && RJSON+=", \"allowedTools\": $ROLE_TOOLS"
    ROLES["$ROLE_NAME"]="{ $RJSON }"
    ROLE_ORDER+=("$ROLE_NAME")

    ok "Role '$ROLE_NAME'"
    echo ""
  done

  if [[ ${#ROLE_ORDER[@]} -eq 0 ]]; then
    warn "No roles added — creating placeholder"
    ROLES["example"]='{ "workDir": "/tmp/dispatch-example" }'
    ROLE_ORDER+=("example")
  fi

  # ── API keys ──
  NEEDS_OPENAI=false NEEDS_OPENROUTER=false NEEDS_MISTRAL=false
  for name in "${ROLE_ORDER[@]}"; do
    case "${ROLES[$name]}" in
    *openai*) NEEDS_OPENAI=true ;;
    *openrouter*) NEEDS_OPENROUTER=true ;;
    *mistral*) NEEDS_MISTRAL=true ;;
    esac
  done

  APIKEY_OPENAI="" APIKEY_OPENROUTER="" APIKEY_MISTRAL=""
  if $NEEDS_OPENAI || $NEEDS_OPENROUTER || $NEEDS_MISTRAL; then
    echo ""
    echo -e "  ${DIM}── API keys ──${NC}"
    $NEEDS_OPENAI && ask_secret "OpenAI API key" APIKEY_OPENAI
    $NEEDS_OPENROUTER && ask_secret "OpenRouter API key" APIKEY_OPENROUTER
    $NEEDS_MISTRAL && ask_secret "Mistral API key" APIKEY_MISTRAL
  fi

  # ── Write config ──
  mkdir -p "$CONFIG_DIR"

  ROLES_JSON=""
  for i in "${!ROLE_ORDER[@]}"; do
    name="${ROLE_ORDER[$i]}"
    [[ $i -gt 0 ]] && ROLES_JSON+=","
    ROLES_JSON+=$'\n'"    \"$name\": ${ROLES[$name]}"
  done

  APIKEYS_JSON=""
  if $NEEDS_OPENAI || $NEEDS_OPENROUTER || $NEEDS_MISTRAL; then
    APIKEYS_JSON=$',\n  "apiKeys": {'
    first=true
    if $NEEDS_OPENAI; then
      $first || APIKEYS_JSON+=","
      APIKEYS_JSON+=$'\n'"    \"openai\": \"$APIKEY_OPENAI\""
      first=false
    fi
    if $NEEDS_OPENROUTER; then
      $first || APIKEYS_JSON+=","
      APIKEYS_JSON+=$'\n'"    \"openrouter\": \"$APIKEY_OPENROUTER\""
      first=false
    fi
    if $NEEDS_MISTRAL; then
      $first || APIKEYS_JSON+=","
      APIKEYS_JSON+=$'\n'"    \"mistral\": \"$APIKEY_MISTRAL\""
      first=false
    fi
    APIKEYS_JSON+=$'\n  }'
  fi

  # Build mode line
  MODE_JSON=""
  [[ "$EXEC_MODE" == "executor" ]] && MODE_JSON=$',\n  "mode": "executor"'

  # Build dispatchMcpPath (only relevant for local mode)
  MCP_PATH_JSON=""
  [[ "$EXEC_MODE" == "local" ]] && MCP_PATH_JSON=$',\n  "dispatchMcpPath": "/usr/local/bin/dispatch-mcp"'

  cat >"$CONFIG_FILE" <<CONFIGEOF
{
  "serverUrl": "$SERVER_URL",
  "machineName": "$MACHINE_NAME",
  "maxConcurrent": $MAX_CONCURRENT$MODE_JSON$MCP_PATH_JSON,
  "roles": {$ROLES_JSON
  }$APIKEYS_JSON,
  "auth": {$(
    if [[ "$AUTH_METHOD" == "key" ]]; then
      echo "
    \"key\": \"$AUTH_KEY\""
    else
      echo "
    \"tokenEndpoint\": \"$TOKEN_ENDPOINT\",
    \"clientId\": \"$CLIENT_ID\",
    \"clientSecret\": \"$CLIENT_SECRET\""
    fi
  )
  }
}
CONFIGEOF

  chmod 600 "$CONFIG_FILE"
  chown "$DAEMON_USER:$DAEMON_USER" "$CONFIG_FILE"
  ok "Config written to $CONFIG_FILE"

  # Create workDirs if needed
  for name in "${ROLE_ORDER[@]}"; do
    workdir=$(echo "${ROLES[$name]}" | grep -oP '"workDir":\s*"\K[^"]+')
    if [[ -n "$workdir" && ! -d "$workdir" ]]; then
      warn "Directory '$workdir' does not exist"
      if confirm "  Create it and set owner to $DAEMON_USER?" "y"; then
        mkdir -p "$workdir"
        chown "$DAEMON_USER:$DAEMON_USER" "$workdir"
        ok "Created $workdir"
      fi
    fi
  done

  # ── Runner config ──
  if $INSTALL_RUNNER; then
    RUNNER_CONFIG_FILE="$CONFIG_DIR/runner.json"

    # Default runner roles to the same roles as the executor
    DEFAULT_RUNNER_ROLES=$(IFS=,; echo "${ROLE_ORDER[*]}")
    RUNNER_ROLES_JSON=""
    first=true
    for rname in "${ROLE_ORDER[@]}"; do
      $first || RUNNER_ROLES_JSON+=", "
      RUNNER_ROLES_JSON+="\"$rname\""
      first=false
    done

    echo ""
    echo -e "  ${DIM}── Runner (AI brain) ──${NC}"
    dim "  The runner will drive AI sessions for: ${DEFAULT_RUNNER_ROLES}"

    ask "Runner machine name" "${MACHINE_NAME}-runner" RUNNER_MACHINE_NAME

    cat >"$RUNNER_CONFIG_FILE" <<RUNNEREOF
{
  "serverUrl": "$SERVER_URL",
  "machineName": "$RUNNER_MACHINE_NAME",
  "maxConcurrent": $MAX_CONCURRENT,
  "claudePath": "claude",
  "dispatchMcpPath": "/usr/local/bin/dispatch-mcp",
  "roles": [$RUNNER_ROLES_JSON],
  "auth": {$(
      if [[ "$AUTH_METHOD" == "key" ]]; then
        echo "
    \"key\": \"$AUTH_KEY\""
      else
        echo "
    \"tokenEndpoint\": \"$TOKEN_ENDPOINT\",
    \"clientId\": \"$CLIENT_ID\",
    \"clientSecret\": \"$CLIENT_SECRET\""
      fi
    )
  }
}
RUNNEREOF

    chmod 600 "$RUNNER_CONFIG_FILE"
    chown "$DAEMON_USER:$DAEMON_USER" "$RUNNER_CONFIG_FILE"
    ok "Runner config written to $RUNNER_CONFIG_FILE"
  fi
fi

# ─── Step 8: Systemd ─────────────────────────────────────────────────────────

step 8 "Systemd service"

cat >/etc/systemd/system/dispatch-daemon.service <<UNIT
[Unit]
Description=Dispatch Agent Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$DAEMON_USER
ExecStart=/usr/local/bin/dispatch-daemon
Environment=DISPATCH_CONFIG=$CONFIG_FILE
Environment=NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT

if $INSTALL_RUNNER; then
  cat >/etc/systemd/system/dispatch-runner.service <<UNIT
[Unit]
Description=Dispatch Runner (server-side agentic execution)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$DAEMON_USER
ExecStart=/usr/local/bin/dispatch-runner
Environment=RUNNER_CONFIG=$CONFIG_DIR/runner.json
Environment=NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
fi

systemctl daemon-reload
ok "Service(s) installed"

# ─── Cleanup temp clone ──────────────────────────────────────────────────────

if [[ -d "/tmp/dispatch" && "$REPO_DIR" == "/tmp/dispatch" ]]; then
  if confirm "Clean up temporary clone at /tmp/dispatch?" "y"; then
    rm -rf /tmp/dispatch
    ok "Cleaned up"
  fi
fi

# ─── Finish ──────────────────────────────────────────────────────────────────

echo ""
echo -e "  ${DIM}────────────────────────────────────────────────────────${NC}"
echo ""
echo -e "  ${GREEN}${BOLD}Installation complete!${NC}"
echo ""
DISPLAY_MODE="$EXEC_MODE"
$INSTALL_RUNNER && DISPLAY_MODE="executor + runner"
echo -e "  ${BOLD}Installed (${DISPLAY_MODE}):${NC}"
dim "    /usr/local/bin/dispatch-daemon"
if [[ "$EXEC_MODE" == "local" ]]; then
  dim "    /usr/local/bin/dispatch-mcp"
fi
if $INSTALL_RUNNER; then
  dim "    /usr/local/bin/dispatch-runner"
fi
dim "    $CONFIG_FILE"
dim "    dispatch-daemon.service"
if $INSTALL_RUNNER; then
  dim "    $CONFIG_DIR/runner.json"
  dim "    dispatch-runner.service"
fi
echo ""

if [[ -n "$AUTH_KEY" ]]; then
  echo -e "  ${BOLD}Your API key:${NC}"
  echo ""
  echo -e "    ${CYAN}${AUTH_KEY}${NC}"
  echo ""
  echo -e "  ${DIM}Register this key in the Dispatch web UI:${NC}"
  echo -e "  ${DIM}  Open ${BOLD}Settings > API Keys${NC}${DIM} and paste the key with a name for this machine.${NC}"
  echo -e "  ${DIM}  The daemon will not authenticate until the key is registered.${NC}"
  echo ""
fi

if grep -q "CHANGEME" "$CONFIG_FILE" 2>/dev/null; then
  warn "Config has placeholders — edit before starting:"
  echo -e "    ${CYAN}sudo vim $CONFIG_FILE${NC}"
  echo ""
fi

NEEDS_CLAUDE_LOGIN=false
if [[ "$EXEC_MODE" == "local" ]] || $INSTALL_RUNNER; then
  DAEMON_HOME=$(getent passwd "$DAEMON_USER" | cut -d: -f6)
  if [[ ! -f "${DAEMON_HOME:-/home/$DAEMON_USER}/.claude/.credentials.json" ]]; then
    NEEDS_CLAUDE_LOGIN=true
  fi
fi

if $NEEDS_CLAUDE_LOGIN; then
  echo -e "  ${BOLD}Before starting — authenticate Claude CLI:${NC}"
  echo ""
  echo -e "    ${CYAN}sudo su -s /bin/bash $DAEMON_USER -c 'claude /login'${NC}"
  echo ""
  echo -e "  ${DIM}This opens an OAuth URL — paste it in your browser, then copy the code back.${NC}"
  echo -e "  ${DIM}Only needed once.${NC}"
  echo ""
fi

if [[ "$EXEC_MODE" == "executor" ]] && ! $INSTALL_RUNNER; then
  echo -e "  ${BOLD}Next steps:${NC}"
  echo ""
  echo -e "  ${DIM}This machine is hands-only — it runs tools but not AI.${NC}"
  echo -e "  ${DIM}To complete the setup:${NC}"
  echo ""
  echo -e "  ${DIM}  1. Register the API key in the Dispatch web UI (see above)${NC}"
  echo -e "  ${DIM}  2. Make sure a runner is installed somewhere (install.sh option 2)${NC}"
  echo -e "  ${DIM}  3. The runner drives AI, this machine executes the tools${NC}"
  echo ""
fi

echo -e "  ${BOLD}Commands:${NC}"
echo ""
echo -e "    ${CYAN}sudo systemctl enable --now dispatch-daemon${NC}   ${DIM}# start daemon${NC}"
echo -e "    ${CYAN}sudo journalctl -fu dispatch-daemon${NC}           ${DIM}# daemon logs${NC}"
if $INSTALL_RUNNER; then
  echo -e "    ${CYAN}sudo systemctl enable --now dispatch-runner${NC}   ${DIM}# start runner${NC}"
  echo -e "    ${CYAN}sudo journalctl -fu dispatch-runner${NC}           ${DIM}# runner logs${NC}"
fi
echo -e "    ${CYAN}sudo vim $CONFIG_FILE${NC}          ${DIM}# daemon config${NC}"
if $INSTALL_RUNNER; then
  echo -e "    ${CYAN}sudo vim $CONFIG_DIR/runner.json${NC}         ${DIM}# runner config${NC}"
fi
echo -e "    ${CYAN}sudo systemctl restart dispatch-daemon${NC}        ${DIM}# after config change${NC}"
echo ""

if ! grep -q "CHANGEME" "$CONFIG_FILE" 2>/dev/null; then
  if confirm "Start the services now?" "y"; then
    systemctl enable --now dispatch-daemon
    if $INSTALL_RUNNER; then
      systemctl enable --now dispatch-runner
    fi
    echo ""
    ok "Services started! Showing logs for 5s..."
    echo ""
    JOURNAL_UNITS="-u dispatch-daemon"
    $INSTALL_RUNNER && JOURNAL_UNITS+=" -u dispatch-runner"
    timeout 5 journalctl -f $JOURNAL_UNITS --no-pager 2>/dev/null || true
    echo ""
  fi
fi

echo -e "  ${DIM}Happy dispatching.${NC}"
echo ""
