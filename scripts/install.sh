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
archive_sha256="${OMNI_CONNECTOR_ARCHIVE_SHA256:-}"
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

compute_sha256() {
  local target_path="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$target_path" | awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$target_path" | awk '{print $1}'
    return
  fi

  printf "%bError:%b sha256sum or shasum is required for checksum verification.\n" "${bold}" "${reset}" >&2
  exit 1
}

verify_archive_checksum_if_configured() {
  local archive_path="$1"
  local expected_checksum="$2"

  if [[ -z "$expected_checksum" ]]; then
    return
  fi

  local expected_lower
  expected_lower="$(printf "%s" "$expected_checksum" | tr '[:upper:]' '[:lower:]')"
  if [[ ! "$expected_lower" =~ ^[0-9a-f]{64}$ ]]; then
    printf "%bError:%b OMNI_CONNECTOR_ARCHIVE_SHA256 must be a 64-character hex string.\n" "${bold}" "${reset}" >&2
    exit 1
  fi

  local actual_checksum
  actual_checksum="$(compute_sha256 "$archive_path")"
  if [[ "$actual_checksum" != "$expected_lower" ]]; then
    printf "%bError:%b archive checksum mismatch.\n" "${bold}" "${reset}" >&2
    printf "Expected: %s\n" "$expected_lower" >&2
    printf "Actual:   %s\n" "$actual_checksum" >&2
    exit 1
  fi
}

if [[ "${OMNI_CONNECTOR_INSTALLER_DRY_RUN:-0}" == "1" ]]; then
  print_step "Dry run enabled"
  if [[ -n "${install_target}" ]]; then
    printf "Would run: npm install -g --ignore-scripts %s\n" "${install_target}"
  else
    printf "Would download source archive: %s\n" "${archive_url}"
    if [[ -n "${archive_sha256}" ]]; then
      printf "Would verify SHA-256: %s\n" "${archive_sha256}"
    fi
    printf "Would run: npm --prefix <source> install --include=dev --no-audit --no-fund --ignore-scripts\n"
    printf "Would run: npm --prefix <source> run build\n"
    printf "Would run: npm install -g --ignore-scripts <source>\n"
  fi
  printf "Would run: omni-connector --init-only\n"
  exit 0
fi

if [[ -n "${install_target}" ]]; then
  print_step "Installing omni-connector globally from ${install_target}"
  npm install -g --ignore-scripts "${install_target}"
else
  print_step "Installing omni-connector from source archive"

  require_command tar

  default_archive_url="https://codeload.github.com/${repo}/tar.gz/${ref}"
  if [[ "${archive_url}" != "${default_archive_url}" && -z "${archive_sha256}" ]]; then
    printf "%bError:%b custom OMNI_CONNECTOR_ARCHIVE_URL requires OMNI_CONNECTOR_ARCHIVE_SHA256 for verification.\n" "${bold}" "${reset}" >&2
    exit 1
  fi

  tmp_dir="$(mktemp -d)"
  cleanup_tmp() {
    rm -rf "${tmp_dir}"
  }
  trap cleanup_tmp EXIT

  archive_path="${tmp_dir}/omni-connector.tar.gz"
  download_file "${archive_url}" "${archive_path}"
  verify_archive_checksum_if_configured "${archive_path}" "${archive_sha256}"
  tar -xzf "${archive_path}" -C "${tmp_dir}"

  source_dir="$(find "${tmp_dir}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [[ -z "${source_dir}" ]]; then
    printf "%bError:%b Unable to unpack source archive from %s\n" "${bold}" "${reset}" "${archive_url}" >&2
    exit 1
  fi

  npm --prefix "${source_dir}" install --include=dev --no-audit --no-fund --ignore-scripts
  npm --prefix "${source_dir}" run build

  package_archive_name="$(npm --prefix "${source_dir}" pack --silent --pack-destination "${tmp_dir}" --ignore-scripts)"
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
printf "%bDefault URL:%b http://localhost:38471\n" "${bold}" "${reset}"
printf "%bData location:%b %s\n" "${dim}" "${reset}" "${HOME}/.omni-connector/data/store.json"
