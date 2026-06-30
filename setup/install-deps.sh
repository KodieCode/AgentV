#!/usr/bin/env bash
# install-deps — install the AgentV system stack on a bare Ubuntu 24.04 server.
#
# Installs: Node 22 (via nvm) + pm2, nginx, certbot (+ nginx plugin), tmux,
# MySQL client, jq, git, gh, curl. Idempotent — anything already present is
# skipped. Prints versions at the end.
#
# Manual one-time steps (NOT done here — they need interactive login):
#   • Claude Code CLI  — install + `claude` login (Anthropic account/subscription)
#   • gh auth login    — authenticate the GitHub CLI for PR operations
#
# Run as a normal user with sudo rights:  ./setup/install-deps.sh
set -euo pipefail

echo "▶ AgentV install-deps (Ubuntu 24.04 target)"

# ── helpers ───────────────────────────────────────────────────────────────
have() { command -v "$1" >/dev/null 2>&1; }
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if have sudo; then SUDO="sudo"; else
    echo "✗ not root and sudo not found — re-run as root or install sudo first" >&2
    exit 1
  fi
fi

APT_UPDATED=0
apt_refresh() { [ "$APT_UPDATED" -eq 1 ] || { $SUDO apt-get update -y; APT_UPDATED=1; }; }
apt_need() {
  # apt_need <command-to-test> <apt-package>
  if have "$1"; then
    echo "  ✓ $1 present — skip"
  else
    echo "  • installing $2 (provides $1)…"
    apt_refresh
    $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y "$2"
  fi
}

# ── 1. base apt packages ────────────────────────────────────────────────────
echo "── base packages"
apt_need curl   curl
apt_need git    git
apt_need jq     jq
apt_need tmux   tmux
# MySQL client (Ubuntu 24.04 ships the MySQL 8 client as mysql-client-core-8.0 via mysql-client)
if have mysql; then
  echo "  ✓ mysql client present — skip"
else
  echo "  • installing mysql-client…"
  apt_refresh
  $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y mysql-client || \
    $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y default-mysql-client
fi

# ── 2. nginx ─────────────────────────────────────────────────────────────────
echo "── nginx"
apt_need nginx nginx

# ── 3. certbot + nginx plugin ─────────────────────────────────────────────────
echo "── certbot (+ nginx plugin)"
if have certbot; then
  echo "  ✓ certbot present — skip"
else
  echo "  • installing certbot + python3-certbot-nginx…"
  apt_refresh
  $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
fi

# ── 4. GitHub CLI (gh) ─────────────────────────────────────────────────────────
echo "── gh (GitHub CLI)"
if have gh; then
  echo "  ✓ gh present — skip"
else
  echo "  • adding GitHub CLI apt repo + installing…"
  $SUDO mkdir -p -m 755 /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/githubcli-archive-keyring.gpg ]; then
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | $SUDO tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
    $SUDO chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  fi
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | $SUDO tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  $SUDO apt-get update -y
  $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y gh
fi

# ── 5. Node 22 via nvm + pm2 ────────────────────────────────────────────────────
echo "── Node 22 (nvm) + pm2"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "  • installing nvm…"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
else
  echo "  ✓ nvm present — skip install"
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

if nvm ls 22 >/dev/null 2>&1; then
  echo "  ✓ Node 22 already installed via nvm"
else
  echo "  • installing Node 22 LTS…"
  nvm install 22
fi
nvm alias default 22 >/dev/null 2>&1 || true
nvm use 22 >/dev/null 2>&1 || true

if have pm2; then
  echo "  ✓ pm2 present — skip"
else
  echo "  • installing pm2 globally…"
  npm install -g pm2
fi

# ── versions ───────────────────────────────────────────────────────────────────
echo
echo "== installed versions =="
ver() { if have "$1"; then printf "  %-10s %s\n" "$1" "$($1 --version 2>/dev/null | head -1)"; else printf "  %-10s MISSING\n" "$1"; fi; }
ver node
ver npm
ver pm2
ver nginx
ver certbot
ver tmux
ver mysql
ver git
ver gh
ver jq

echo
echo "✔ install-deps finished."
echo
echo "Manual one-time steps still required before ./setup/bootstrap.sh:"
echo "  1. Install the Claude Code CLI and log in once:   claude   (then complete /login)"
echo "  2. Authenticate the GitHub CLI for PR operations: gh auth login"
echo "  3. Persist pm2 across reboots (after first start): pm2 startup && pm2 save"
echo "  4. nvm only affects new shells — 'source ~/.bashrc' or re-login so 'node' is on PATH."
