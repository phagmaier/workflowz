#!/bin/sh
# Creates files only. Run from any directory; no daemon or provider is started.
set -eu
umask 077
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
lab=$(mktemp -d /tmp/workflowz-owner-XXXXXX)
mkdir "$lab/state" "$lab/project" "$lab/opencode"
mkdir "$lab/opencode/config" "$lab/opencode/data" "$lab/opencode/cache" "$lab/opencode/state"
cp "$source_dir/workflow.yaml" "$lab/workflow.yaml"
cp "$source_dir/project/greeting.txt" "$source_dir/project/check.mjs" "$lab/project/"
cp "$source_dir/opencode.json" "$lab/opencode/config/opencode.json"
printf '%s\n' 'Workflowz owner walkthrough v1' > "$lab/.workflowz-owner-walkthrough"
cat > "$lab/environment.sh" <<EOF
# Source only in the walkthrough subshell. No global harness files are changed.
export WF_LAB='$lab'
export XDG_CONFIG_HOME='$lab/opencode/xdg-config'
export XDG_DATA_HOME='$lab/opencode/data'
export XDG_CACHE_HOME='$lab/opencode/cache'
export XDG_STATE_HOME='$lab/opencode/state'
export OPENCODE_CONFIG_DIR='$lab/opencode/config'
export OPENCODE_DB='$lab/opencode/opencode.db'
export OPENCODE_DISABLE_MODELS_FETCH=1
export OPENCODE_CONFIG_PROJECT_DISABLE=1
export OPENCODE_DISABLE_CLAUDE_CODE=1
unset OPENCODE_CONFIG OPENCODE_MODELS_PATH
unset OPENAI_API_KEY MODEL_API_KEY META_API_KEY ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
unset GEMINI_API_KEY GOOGLE_GENERATIVE_AI_API_KEY OPENROUTER_API_KEY
EOF
printf '%s\n' "$lab"
