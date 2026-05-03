#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
CLI="$ROOT/tools/ota-cli/bin/ota.js"
CONFIG="$ROOT/ota.config.json"

# ── Colours ───────────────────────────────────────────────────────────────────
BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║        OTA Bundle & Publish          ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Read defaults from ota.config.json ───────────────────────────────────────
DEFAULT_SERVER=$(node -e "try{const c=require('$CONFIG');console.log(c.serverUrl||'')}catch(e){console.log('')}" 2>/dev/null)
DEFAULT_SECRET=$(node -e "try{const c=require('$CONFIG');console.log(c.secret||'')}catch(e){console.log('')}" 2>/dev/null)
DEFAULT_CHANNEL=$(node -e "try{const c=require('$CONFIG');console.log(c.channel||'production')}catch(e){console.log('production')}" 2>/dev/null)
DEFAULT_APP_VER=$(node -e "try{const c=require('$CONFIG');console.log(c.appVersion||'>=1.0.0')}catch(e){console.log('>=1.0.0')}" 2>/dev/null)

# ── Prompt helpers ────────────────────────────────────────────────────────────
prompt() {
  local var_name="$1"
  local display="$2"
  local default="$3"
  local input

  if [[ -n "$default" ]]; then
    echo -ne "${BOLD}$display${NC} ${YELLOW}[$default]${NC}: "
  else
    echo -ne "${BOLD}$display${NC}: "
  fi

  read -r input
  if [[ -z "$input" && -n "$default" ]]; then
    input="$default"
  fi

  # Validate non-empty
  while [[ -z "$input" ]]; do
    echo -e "${RED}This field is required.${NC}"
    echo -ne "${BOLD}$display${NC}: "
    read -r input
  done

  printf -v "$var_name" '%s' "$input"
}

prompt_select() {
  local var_name="$1"
  local display="$2"
  local default="$3"
  shift 3
  local options=("$@")

  echo -e "${BOLD}$display${NC}"
  for i in "${!options[@]}"; do
    if [[ "${options[$i]}" == "$default" ]]; then
      echo -e "  ${GREEN}$(($i+1)). ${options[$i]} (default)${NC}"
    else
      echo "  $(($i+1)). ${options[$i]}"
    fi
  done
  echo -ne "Choice [1-${#options[@]}]: "
  read -r choice

  if [[ -z "$choice" ]]; then
    printf -v "$var_name" '%s' "$default"
  else
    local idx=$(( choice - 1 ))
    if [[ $idx -ge 0 && $idx -lt ${#options[@]} ]]; then
      printf -v "$var_name" '%s' "${options[$idx]}"
    else
      printf -v "$var_name" '%s' "$default"
    fi
  fi
}

# ── Collect inputs ────────────────────────────────────────────────────────────
prompt LABEL       "Version label (e.g. v1.0.11)"   ""
prompt_select PLATFORM "Platform"                   "android" "android" "ios" "both"
prompt APP_VERSION "Min app version (semver range)" "$DEFAULT_APP_VER"

# Use config values directly — no prompt needed
SERVER="$DEFAULT_SERVER"
SECRET="$DEFAULT_SECRET"
CHANNEL="$DEFAULT_CHANNEL"

# Optional: mandatory flag
echo -ne "${BOLD}Mandatory update?${NC} ${YELLOW}[y/N]${NC}: "
read -r mandatory_input
MANDATORY="false"
[[ "$mandatory_input" =~ ^[Yy]$ ]] && MANDATORY="true"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}── Summary ─────────────────────────────────${NC}"
echo -e "  Label      : ${GREEN}$LABEL${NC}"
echo -e "  Platform   : ${GREEN}$PLATFORM${NC}"
echo -e "  Channel    : ${GREEN}$CHANNEL${NC}"
echo -e "  App version: ${GREEN}$APP_VERSION${NC}"
echo -e "  Mandatory  : ${GREEN}$MANDATORY${NC}"
echo -e "  Server     : ${GREEN}$SERVER${NC}"
echo -e "  (Server/Secret/Channel loaded from ota.config.json)"
echo -e "${BOLD}${CYAN}────────────────────────────────────────────${NC}"
echo ""
echo -ne "${BOLD}Proceed? [Y/n]:${NC} "
read -r confirm
[[ "$confirm" =~ ^[Nn]$ ]] && echo "Aborted." && exit 0

# ── Step 1: Build CLI if dist is missing ─────────────────────────────────────
if [[ ! -d "$ROOT/tools/ota-cli/dist" ]]; then
  echo ""
  echo -e "${YELLOW}Building OTA CLI...${NC}"
  (cd "$ROOT/tools/ota-cli" && npm install && npm run build)
fi

# ── Step 2: Bundle ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}[1/2] Bundling...${NC}"
OTA_CLI_COMPILED=1 node "$CLI" bundle \
  --label "$LABEL" \
  --platform "$PLATFORM"

# ── Step 3: Publish ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}[2/2] Publishing...${NC}"
OTA_CLI_COMPILED=1 node "$CLI" publish \
  --label "$LABEL" \
  --platform "$PLATFORM" \
  --server "$SERVER" \
  --secret "$SECRET" \
  --channel "$CHANNEL" \
  --app-version "$APP_VERSION" \
  --mandatory "$MANDATORY"

echo ""
echo -e "${GREEN}${BOLD}✅ Done! Release '$LABEL' published to $SERVER${NC}"
echo ""
