#!/usr/bin/env bash
set -euo pipefail

bold="\033[1m"
dim="\033[2m"
reset="\033[0m"

print_logo() {
  printf "%b" "${bold}"
  cat <<'EOF'
  ___  __  __ _   _ ___       ____ ___  _   _ _   _ _____ ____ _____ ___  ____
 / _ \|  \/  | \ | |_ _|_____/ ___/ _ \| \ | | \ | | ____/ ___|_   _/ _ \|  _ \
| | | | |\/| |  \| || |_____| |  | | | |  \| |  \| |  _|| |     | || | | | |_) |
| |_| | |  | | |\  || |     | |__| |_| | |\  | |\  | |__| |___  | || |_| |  _ <
 \___/|_|  |_|_| \_|___|     \____\___/|_| \_|_| \_|_____\____| |_| \___/|_| \_\
EOF
  printf "%b\n" "${reset}"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf "%bError:%b '%s' is required but was not found in PATH.\n" "${bold}" "${reset}" "$1" >&2
    exit 1
  fi
}

print_step() {
  printf "%b==>%b %s\n" "${bold}" "${reset}" "$1"
}

print_logo

require_command npm
require_command node

repo="${OMNI_CONNECTOR_REPO:-omnious0o0/omni-connector}"
ref="${OMNI_CONNECTOR_REF:-main}"
install_target="${OMNI_CONNECTOR_INSTALL_TARGET:-github:${repo}#${ref}}"

if [[ "${OMNI_CONNECTOR_INSTALLER_DRY_RUN:-0}" == "1" ]]; then
  print_step "Dry run enabled"
  printf "Would run: npm install -g %s\n" "${install_target}"
  printf "Would run: omni-connector --init-only\n"
  exit 0
fi

print_step "Installing omni-connector globally from ${install_target}"
npm install -g "${install_target}"

global_prefix="$(npm prefix -g)"
global_bin="${global_prefix}/bin"
if ! command -v omni-connector >/dev/null 2>&1 && [[ -x "${global_bin}/omni-connector" ]]; then
  export PATH="${global_bin}:${PATH}"
fi

if ! command -v omni-connector >/dev/null 2>&1; then
  printf "%bError:%b omni-connector is not in PATH after install.\n" "${bold}" "${reset}" >&2
  printf "Add this directory to your PATH and re-open your shell:\n"
  printf "  %s\n" "${global_bin}"
  exit 1
fi

print_step "Initializing runtime files"
omni-connector --init-only

printf "%bInstall complete.%b\n" "${bold}" "${reset}"
printf "%bRun now:%b omni-connector\n" "${bold}" "${reset}"
printf "%bDefault URL:%b http://127.0.0.1:1455\n" "${bold}" "${reset}"
printf "%bData location:%b %s\n" "${dim}" "${reset}" "${HOME}/.omni-connector/data/store.json"
