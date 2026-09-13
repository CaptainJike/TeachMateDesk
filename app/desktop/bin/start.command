#!/bin/sh
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
open "$SCRIPT_DIR/../../TeachMate.app"
