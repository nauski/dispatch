#!/usr/bin/env bash
set -euo pipefail

GITLAB_HOST="example.com"
CONFIG_DIR="$HOME/.config/dispatch"
SERVICE_DIR="$HOME/.config/systemd/user"

echo "=== Dispatch Daemon Installer ==="

# 1. Configure npm to use GitLab registry for @dispatch scope
echo "Configuring npm registry..."
npm config set @dispatch:registry "https://${GITLAB_HOST}/api/v4/projects/dispatch/packages/npm/"

# 2. Install the daemon globally
echo "Installing @dispatch/daemon..."
npm install -g @dispatch/daemon

# 3. Create config directory
mkdir -p "$CONFIG_DIR"

# 4. Create config file if it doesn't exist
if [ ! -f "$CONFIG_DIR/daemon.json" ]; then
  HOSTNAME=$(hostname)
  cat > "$CONFIG_DIR/daemon.json" << CONF
{
  "serverUrl": "wss://your-server:3000",
  "token": "REPLACE_WITH_SERVICE_ACCOUNT_TOKEN",
  "machineName": "${HOSTNAME}",
  "maxConcurrent": 4,
  "roles": {
    "example": {
      "workDir": "${HOME}/example-repo"
    }
  }
}
CONF
  echo "Created config at $CONFIG_DIR/daemon.json — edit it with your token and roles."
else
  echo "Config already exists at $CONFIG_DIR/daemon.json"
fi

# 5. Install systemd user service
mkdir -p "$SERVICE_DIR"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/dispatch-daemon.service" "$SERVICE_DIR/"

systemctl --user daemon-reload
systemctl --user enable dispatch-daemon

echo ""
echo "=== Installation complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit $CONFIG_DIR/daemon.json"
echo "     - Set your Keycloak service account token"
echo "     - Configure roles and their working directories"
echo "  2. Start the daemon:"
echo "     systemctl --user start dispatch-daemon"
echo "  3. Check status:"
echo "     systemctl --user status dispatch-daemon"
echo "     journalctl --user -u dispatch-daemon -f"
