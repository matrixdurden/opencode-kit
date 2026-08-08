#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Remove file://$root from the global plugin list in ~/.config/opencode/opencode.json, then restart OpenCode."
echo "Saved accounts were kept."
