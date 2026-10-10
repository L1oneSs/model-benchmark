#!/usr/bin/env bash
# Download all benchmark TF.js weights and vocabularies. Python also runs on Windows.
# Agent/ONNX/Chrome models use separate download mechanisms.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v python3 >/dev/null || { echo "Нужен python3"; exit 1; }
exec python3 "$SCRIPT_DIR/fetch-models.py" "$@"
