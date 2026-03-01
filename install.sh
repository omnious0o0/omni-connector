#!/bin/sh
set -eu

repo="${OMNI_CONNECTOR_REPO:-omnious0o0/omni-connector}"
ref="${OMNI_CONNECTOR_REF:-main}"
default_install_script_url="https://raw.githubusercontent.com/${repo}/${ref}/scripts/install.sh"
install_script_url="${OMNI_CONNECTOR_INSTALL_SCRIPT_URL:-${default_install_script_url}}"
install_script_sha256="${OMNI_CONNECTOR_INSTALL_SCRIPT_SHA256:-}"
install_script_checksum_url="${OMNI_CONNECTOR_INSTALL_SCRIPT_CHECKSUM_URL:-${install_script_url}.sha256}"

case "${install_script_url}" in
  https://*) ;;
  *)
    printf "Error: Installer URL must use HTTPS.\n" >&2
    exit 1
    ;;
esac

case "${install_script_checksum_url}" in
  https://*) ;;
  *)
    printf "Error: Installer checksum URL must use HTTPS.\n" >&2
    exit 1
    ;;
esac

if [ "${install_script_url}" != "${default_install_script_url}" ] && [ -z "${install_script_sha256}" ] && [ -z "${OMNI_CONNECTOR_INSTALL_SCRIPT_CHECKSUM_URL:-}" ]; then
  printf "custom OMNI_CONNECTOR_INSTALL_SCRIPT_URL requires OMNI_CONNECTOR_INSTALL_SCRIPT_SHA256 or OMNI_CONNECTOR_INSTALL_SCRIPT_CHECKSUM_URL\n" >&2
  exit 1
fi

detect_pkg_mgr() {
  for mgr in apt-get dnf yum pacman zypper brew apk; do
    if command -v "${mgr}" >/dev/null 2>&1; then
      printf "%s" "${mgr}"
      return
    fi
  done

  printf ""
}

run_privileged() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
    return
  fi

  "$@"
}

download_file() {
  source_url="$1"
  destination_path="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "${destination_path}" "${source_url}"
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO "${destination_path}" "${source_url}"
    return
  fi

  printf "Error: curl or wget is required to download installer assets\n" >&2
  exit 1
}

compute_sha256() {
  target_path="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${target_path}" | awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${target_path}" | awk '{print $1}'
    return
  fi

  if command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "${target_path}" | awk '{print $2}'
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$target_path" <<'PY'
import hashlib
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
print(hashlib.sha256(path.read_bytes()).hexdigest())
PY
    return
  fi

  printf "Error: checksum verification requires sha256sum, shasum, openssl, or python3\n" >&2
  exit 1
}

ensure_bash() {
  if command -v bash >/dev/null 2>&1; then
    return
  fi

  package_manager="$(detect_pkg_mgr)"
  case "${package_manager}" in
    apt-get)
      run_privileged apt-get update -qq
      run_privileged apt-get install -y -qq bash
      ;;
    dnf)
      run_privileged dnf install -y -q bash
      ;;
    yum)
      run_privileged yum install -y -q bash
      ;;
    pacman)
      run_privileged pacman -Sy --noconfirm bash
      ;;
    zypper)
      run_privileged zypper --non-interactive install bash
      ;;
    brew)
      brew install bash
      ;;
    apk)
      run_privileged apk add --no-cache bash
      ;;
    *)
      printf "Error: bash is required to run the omni-connector installer payload.\n" >&2
      exit 1
      ;;
  esac

  if ! command -v bash >/dev/null 2>&1; then
    printf "Error: failed to install bash automatically.\n" >&2
    exit 1
  fi
}

tmp_file="$(mktemp)"
checksum_file="$(mktemp)"
cleanup() {
  rm -f "${tmp_file}" "${checksum_file}"
}
trap cleanup EXIT INT TERM

download_file "${install_script_url}" "${tmp_file}"

if [ -n "${install_script_sha256}" ]; then
  expected_checksum="$(printf '%s' "${install_script_sha256}" | tr '[:upper:]' '[:lower:]')"
else
  download_file "${install_script_checksum_url}" "${checksum_file}"
  expected_checksum="$(awk 'NF { print $1; exit }' "${checksum_file}" | tr '[:upper:]' '[:lower:]')"
fi

if ! printf '%s' "${expected_checksum}" | grep -Eq '^[0-9a-f]{64}$'; then
  printf "Installer checksum must resolve to a 64-character hex string\n" >&2
  exit 1
fi

actual_checksum="$(compute_sha256 "${tmp_file}")"
if [ "${actual_checksum}" != "${expected_checksum}" ]; then
  printf "Installer checksum mismatch\n" >&2
  printf "Expected: %s\n" "${expected_checksum}" >&2
  printf "Actual:   %s\n" "${actual_checksum}" >&2
  exit 1
fi

ensure_bash

exec env \
  OMNI_CONNECTOR_REPO="${repo}" \
  OMNI_CONNECTOR_REF="${ref}" \
  OMNI_CONNECTOR_INSTALL_SCRIPT_URL="${install_script_url}" \
  OMNI_CONNECTOR_INSTALL_SCRIPT_SHA256="${install_script_sha256}" \
  OMNI_CONNECTOR_INSTALL_SCRIPT_CHECKSUM_URL="${install_script_checksum_url}" \
  bash "${tmp_file}" "$@"
