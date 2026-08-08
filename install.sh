#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v opencode >/dev/null || {
  echo "OpenCode must be installed first." >&2
  exit 1
}

mkdir -p "${XDG_DATA_HOME:-$HOME/.local/share}/jr-codex-switch/accounts"
chmod 700 "${XDG_DATA_HOME:-$HOME/.local/share}/jr-codex-switch" "${XDG_DATA_HOME:-$HOME/.local/share}/jr-codex-switch/accounts"
opencode plugin --global "file://$root"

echo "Installed Codex Account Manager. Restart OpenCode, then use /codex."
