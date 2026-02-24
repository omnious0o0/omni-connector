#!/usr/bin/env bash
set -euo pipefail

export GIT_TERMINAL_PROMPT=0
export GCM_INTERACTIVE=never
export GH_PROMPT_DISABLED=1
export GIT_ASKPASS="${GIT_ASKPASS:-/bin/false}"

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
archive_url="${OMNI_CONNECTOR_ARCHIVE_URL:-https://codeload.github.com/${repo}/tar.gz/${ref}}"
install_target="${OMNI_CONNECTOR_INSTALL_TARGET:-}"

download_file() {
  local source_url="$1"
  local destination_path="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$source_url" -o "$destination_path"
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO "$destination_path" "$source_url"
    return
  fi

  printf "%bError:%b curl or wget is required to download installer assets.\n" "${bold}" "${reset}" >&2
  exit 1
}

if [[ "${OMNI_CONNECTOR_INSTALLER_DRY_RUN:-0}" == "1" ]]; then
  print_step "Dry run enabled"
  if [[ -n "${install_target}" ]]; then
    printf "Would run: npm install -g %s\n" "${install_target}"
  else
    printf "Would download source archive: %s\n" "${archive_url}"
    printf "Would run: npm --prefix <source> install --include=dev --no-audit --no-fund\n"
    printf "Would run: npm --prefix <source> run build\n"
    printf "Would run: npm install -g --ignore-scripts <source>\n"
  fi
  printf "Would run: omni-connector --init-only\n"
  exit 0
fi

if [[ -n "${install_target}" ]]; then
  print_step "Installing omni-connector globally from ${install_target}"
  npm install -g "${install_target}"
else
  print_step "Installing omni-connector from source archive"

  require_command tar

  tmp_dir="$(mktemp -d)"
  cleanup_tmp() {
    rm -rf "${tmp_dir}"
  }
  trap cleanup_tmp EXIT

  archive_path="${tmp_dir}/omni-connector.tar.gz"
  download_file "${archive_url}" "${archive_path}"
  tar -xzf "${archive_path}" -C "${tmp_dir}"

  source_dir="$(find "${tmp_dir}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [[ -z "${source_dir}" ]]; then
    printf "%bError:%b Unable to unpack source archive from %s\n" "${bold}" "${reset}" "${archive_url}" >&2
    exit 1
  fi

  npm --prefix "${source_dir}" install --include=dev --no-audit --no-fund
  npm --prefix "${source_dir}" run build

  package_archive_name="$(npm --prefix "${source_dir}" pack --silent --pack-destination "${tmp_dir}")"
  package_archive_path="${tmp_dir}/${package_archive_name}"
  npm install -g --ignore-scripts "${package_archive_path}"
fi

global_prefix="$(npm prefix -g)"
global_bin="${global_prefix}/bin"
if [[ -x "${global_bin}/omni-connector" ]]; then
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
