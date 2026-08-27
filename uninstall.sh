#!/usr/bin/env bash
set -euo pipefail

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
INSTALL_DIR="${OPENCODE_KIT_HOME:-$DATA_HOME/opencode-kit}"
ACCOUNT_ROOT="$DATA_HOME/jr-codex-switch"
PLUGIN_URI="file://$INSTALL_DIR"
PURGE=0

fail() {
    echo "opencode-kit: $*" >&2
    exit 1
}

for arg in "$@"; do
    case "$arg" in
        --purge) PURGE=1 ;;
        -h|--help)
            echo "Usage: uninstall.sh [--purge]"
            echo "  --purge  Also delete saved Codex account credentials."
            exit 0
            ;;
        *) fail "Unknown argument: $arg" ;;
    esac
done

remove_plugin_entry() {
    local config="$1"

    [[ -f "$config" ]] || return 0
    grep -Fq "$PLUGIN_URI" "$config" || return 0

    if command -v python3 >/dev/null 2>&1; then
        python3 - "$config" "$PLUGIN_URI" <<'PY'
import json
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
plugin = sys.argv[2]
text = path.read_text()
quoted = re.escape(json.dumps(plugin))

for pattern in (quoted + r"\s*,", r",\s*" + quoted, quoted):
    updated, count = re.subn(pattern, "", text, count=1)
    if count:
        path.write_text(updated)
        break
PY
    elif command -v node >/dev/null 2>&1; then
        node - "$config" "$PLUGIN_URI" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const plugin = process.argv[3];
let text = fs.readFileSync(file, "utf8");
const quoted = JSON.stringify(plugin).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
for (const pattern of [new RegExp(quoted + "\\s*,"), new RegExp(",\\s*" + quoted), new RegExp(quoted)]) {
    const updated = text.replace(pattern, "");
    if (updated !== text) {
        fs.writeFileSync(file, updated);
        break;
    }
}
NODE
    elif command -v perl >/dev/null 2>&1; then
        PLUGIN_URI="$PLUGIN_URI" perl -0pi -e '$q = "\"" . $ENV{"PLUGIN_URI"} . "\""; if (!s/\Q$q\E\s*,//) { if (!s/,\s*\Q$q\E//) { s/\Q$q\E//; } }' "$config"
    else
        fail "Cannot safely edit $config. Install python3, node, or perl and run uninstall again."
    fi

    echo "Removed plugin entry from $config"
}

remove_plugin_entry "$CONFIG_HOME/opencode/opencode.json"
remove_plugin_entry "$CONFIG_HOME/opencode/opencode.jsonc"
remove_plugin_entry "$HOME/.opencode/opencode.json"
remove_plugin_entry "$HOME/.opencode/opencode.jsonc"

case "$INSTALL_DIR" in
    ""|"/"|"$HOME") fail "Refusing unsafe install directory: $INSTALL_DIR" ;;
    *) rm -rf "$INSTALL_DIR" ;;
esac

if [[ "$PURGE" -eq 1 ]]; then
    rm -rf "$ACCOUNT_ROOT"
    echo "Removed saved Codex account credentials."
else
    echo "Saved Codex account credentials were kept in $ACCOUNT_ROOT"
fi

cat <<EOF

opencode-kit uninstalled successfully.
Restart OpenCode to finish removal.
EOF
