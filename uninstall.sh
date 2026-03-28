#!/usr/bin/env bash
set -uo pipefail

# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  Dispatch Daemon Uninstaller                                                ║
# ║                                                                              ║
# ║  Usage:                                                                      ║
# ║    curl -fsSL your-server:3000/uninstall.sh | sudo bash                ║
# ║    — or —                                                                    ║
# ║    sudo ./uninstall.sh                                                       ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

INSTALL_DIR="/opt/dispatch"
CONFIG_DIR="/etc/dispatch"
DAEMON_USER="${DISPATCH_USER:-dispatch}"

# ─── Colors & UI ─────────────────────────────────────────────────────────────

BOLD='\033[1m'
DIM='\033[2m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { echo -e "  ${GREEN}>>>${NC} $1"; }
warn() { echo -e "  ${YELLOW}!! ${NC} $1"; }
err() { echo -e "  ${RED}!!!${NC} $1"; }
dim() { echo -e "  ${DIM}$1${NC}"; }
ok() { echo -e "  ${GREEN}${BOLD}OK ${NC} $1"; }

exec 3</dev/tty 2>/dev/null || exec 3<&0

confirm() {
  local prompt="$1" default="${2:-y}"
  local hint="Y/n"
  [[ "$default" == "n" ]] && hint="y/N"
  printf "  ${BOLD}?${NC} %s ${DIM}[%s]${NC}: " "$prompt" "$hint"
  read -r answer <&3
  answer="${answer:-$default}"
  [[ "${answer,,}" == "y" || "${answer,,}" == "yes" ]]
}

cleanup() { exec 3<&- 2>/dev/null || true; }
trap cleanup EXIT

# ─── Banner ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${RED}"
cat <<'BANNER'

        ·····························
       ·· ┌──────────────────────┐ ··
      ·   │    D I S P A T C H   │   ·
       ·· └──────────────────────┘ ··
        ·····························

BANNER
echo -e "${NC}"
echo -e "  ${BOLD}Uninstaller${NC}"
echo ""
echo -e "  ${DIM}────────────────────────────────────────────────────────${NC}"
echo ""

if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root."
  echo -e "  ${DIM}Usage: curl -fsSL your-server:3000/uninstall.sh | sudo bash${NC}"
  exit 1
fi

# ─── Show what will be removed ────────────────────────────────────────────────

echo -e "  ${BOLD}The following will be removed:${NC}"
echo ""

FOUND=false

for svc in dispatch-daemon dispatch-runner; do
  if systemctl is-enabled "$svc" &>/dev/null || [[ -f "/etc/systemd/system/$svc.service" ]]; then
    dim "    $svc.service (systemd)"
    FOUND=true
  fi
done

for bin in dispatch-daemon dispatch-mcp dispatch-runner; do
  if [[ -f "/usr/local/bin/$bin" ]]; then
    dim "    /usr/local/bin/$bin"
    FOUND=true
  fi
done

if [[ -d "$INSTALL_DIR" ]]; then
  dim "    $INSTALL_DIR/ (binaries + deps)"
  FOUND=true
fi

if [[ -d "$CONFIG_DIR" ]]; then
  dim "    $CONFIG_DIR/ (config files)"
  FOUND=true
fi

if id "$DAEMON_USER" &>/dev/null; then
  dim "    '$DAEMON_USER' system user + home directory"
  FOUND=true
fi

echo ""

if ! $FOUND; then
  info "Nothing to uninstall — dispatch doesn't appear to be installed."
  exit 0
fi

if ! confirm "Proceed with uninstall?" "n"; then
  echo ""
  dim "  Cancelled."
  exit 0
fi

echo ""

# ─── Stop services ───────────────────────────────────────────────────────────

for svc in dispatch-daemon dispatch-runner; do
  if systemctl is-active "$svc" &>/dev/null; then
    info "Stopping $svc..."
    systemctl stop "$svc"
    ok "Stopped $svc"
  fi
  if systemctl is-enabled "$svc" &>/dev/null; then
    systemctl disable "$svc" &>/dev/null
  fi
done

# ─── Remove systemd units ───────────────────────────────────────────────────

for svc in dispatch-daemon dispatch-runner; do
  if [[ -f "/etc/systemd/system/$svc.service" ]]; then
    rm -f "/etc/systemd/system/$svc.service"
    ok "Removed $svc.service"
  fi
done
systemctl daemon-reload

# ─── Remove binaries ────────────────────────────────────────────────────────

for bin in dispatch-daemon dispatch-mcp dispatch-runner; do
  if [[ -f "/usr/local/bin/$bin" ]]; then
    rm -f "/usr/local/bin/$bin"
    ok "Removed /usr/local/bin/$bin"
  fi
done

# ─── Remove install directory ────────────────────────────────────────────────

if [[ -d "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  ok "Removed $INSTALL_DIR/"
fi

# ─── Config ──────────────────────────────────────────────────────────────────

if [[ -d "$CONFIG_DIR" ]]; then
  if confirm "Remove config files ($CONFIG_DIR)?" "y"; then
    rm -rf "$CONFIG_DIR"
    ok "Removed $CONFIG_DIR/"
  else
    warn "Kept $CONFIG_DIR/"
  fi
fi

# ─── System user ─────────────────────────────────────────────────────────────

if id "$DAEMON_USER" &>/dev/null; then
  if confirm "Remove '$DAEMON_USER' system user and home directory?" "y"; then
    userdel -r "$DAEMON_USER" 2>/dev/null
    ok "Removed user '$DAEMON_USER'"
  else
    warn "Kept user '$DAEMON_USER'"
  fi
fi

# ─── Done ────────────────────────────────────────────────────────────────────

echo ""
echo -e "  ${DIM}────────────────────────────────────────────────────────${NC}"
echo ""
echo -e "  ${GREEN}${BOLD}Uninstall complete.${NC}"
echo ""
dim "  Node.js and Claude CLI were not removed (they may be used by other tools)."
echo ""
