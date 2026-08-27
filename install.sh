#!/usr/bin/env bash
set -euo pipefail

REPO="matrixdurden/opencode-kit"
REF="${OPENCODE_KIT_REF:-main}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
INSTALL_DIR="${OPENCODE_KIT_HOME:-$DATA_HOME/opencode-kit}"
ACCOUNT_ROOT="$DATA_HOME/jr-codex-switch"
ACCOUNT_DIR="$ACCOUNT_ROOT/accounts"
ARCHIVE_URL="https://github.com/$REPO/archive/refs/heads/$REF.tar.gz"

fail() {
    echo "opencode-kit: $*" >&2
    exit 1
}

command -v opencode >/dev/null 2>&1 || fail "OpenCode must be installed first."
command -v curl >/dev/null 2>&1 || fail "curl is required."
command -v tar >/dev/null 2>&1 || fail "tar is required."

case "$INSTALL_DIR" in
    ""|"/"|"$HOME") fail "Refusing unsafe install directory: $INSTALL_DIR" ;;
esac

parent_dir="$(dirname "$INSTALL_DIR")"
stage_dir="$parent_dir/.opencode-kit-install.$$"

cleanup() {
    rm -rf "$stage_dir"
}
trap cleanup EXIT INT TERM

mkdir -p "$parent_dir" "$stage_dir"

echo "Downloading opencode-kit..."
curl -fsSL "$ARCHIVE_URL" | tar -xzf - -C "$stage_dir" --strip-components=1

[[ -f "$stage_dir/package.json" && -f "$stage_dir/src/server.js" ]] || 
    fail "Downloaded archive is incomplete."

rm -rf "$INSTALL_DIR"
mv "$stage_dir" "$INSTALL_DIR"
trap - EXIT INT TERM

mkdir -p "$ACCOUNT_DIR"
chmod 700 "$ACCOUNT_ROOT" "$ACCOUNT_DIR"

plugin_uri="file://$INSTALL_DIR"
echo "Registering OpenCode plugin..."
opencode plugin --global --force "$plugin_uri"

cat <<EOF

opencode-kit installed successfully.

Location: $INSTALL_DIR
Plugin:   $plugin_uri

Restart OpenCode, then use /codex.
EOF
