#!/usr/bin/env bash
set -euo pipefail

export GIT_TERMINAL_PROMPT=0
export GCM_INTERACTIVE=never
export GH_PROMPT_DISABLED=1
export GIT_ASKPASS="${GIT_ASKPASS:-/bin/false}"

bold="\033[1m"
green="\033[32m"
yellow="\033[33m"
red="\033[31m"
cyan="\033[36m"
dim="\033[2m"
reset="\033[0m"

PROJECT_NAME="omni-connector"
DEFAULT_URL="http://localhost:38471"
NVM_VERSION="v0.40.3"

apt_index_ready=0
stage_current=0
stage_total=0
STAGE_BAR_WIDTH=34

render_stage_bar() {
  local completed_segments="$1"
  local filled empty

  filled="$(printf '%*s' "${completed_segments}" '')"
  filled="${filled// /=}"
  empty="$(printf '%*s' "$((STAGE_BAR_WIDTH - completed_segments))" '')"
  empty="${empty// /-}"

  printf "%s%s" "${filled}" "${empty}"
}

stage_step() {
  local message="$1"

  stage_current=$((stage_current + 1))

  if [[ "${stage_total}" -le 0 ]]; then
    print_step "${message}"
    return
  fi

  local completed
  completed=$((stage_current * STAGE_BAR_WIDTH / stage_total))
  if [[ "${completed}" -gt "${STAGE_BAR_WIDTH}" ]]; then
    completed="${STAGE_BAR_WIDTH}"
  fi

  local percent
  percent=$((stage_current * 100 / stage_total))
  local bar
  bar="$(render_stage_bar "${completed}")"

  printf "%b[%s]%b %b%3d%%%b  %s  %b(%d/%d)%b\n" "${bold}" "${bar}" "${reset}" "${cyan}" "${percent}" "${reset}" "${message}" "${dim}" "${stage_current}" "${stage_total}" "${reset}"
}

print_logo() {
  printf "%b" "${bold}${cyan}"
  cat <<'EOF'
 ██████╗ ███╗   ███╗███╗   ██╗██╗
██╔═══██╗████╗ ████║████╗  ██║██║
██║   ██║██╔████╔██║██╔██╗ ██║██║
██║   ██║██║╚██╔╝██║██║╚██╗██║██║
╚██████╔╝██║ ╚═╝ ██║██║ ╚████║██║
 ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═══╝╚═╝

 ██████╗ ██████╗ ███╗   ██╗███╗   ██╗███████╗ ██████╗████████╗ ██████╗ ██████╗
██╔════╝██╔═══██╗████╗  ██║████╗  ██║██╔════╝██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗
██║     ██║   ██║██╔██╗ ██║██╔██╗ ██║█████╗  ██║        ██║   ██║   ██║██████╔╝
██║     ██║   ██║██║╚██╗██║██║╚██╗██║██╔══╝  ██║        ██║   ██║   ██║██╔══██╗
╚██████╗╚██████╔╝██║ ╚████║██║ ╚████║███████╗╚██████╗   ██║   ╚██████╔╝██║  ██║
 ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═══╝╚══════╝ ╚═════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝
EOF
  printf "%b\n" "${reset}"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

print_step() {
  printf "%b==>%b %s\n" "${bold}" "${reset}" "$1"
}

print_ok() {
  printf "%b==>%b %s\n" "${green}${bold}" "${reset}" "$1"
}

print_warn() {
  printf "%bWarning:%b %s\n" "${yellow}${bold}" "${reset}" "$1"
}

print_error() {
  printf "%bError:%b %s\n" "${red}${bold}" "${reset}" "$1" >&2
}

prepend_path_if_missing() {
  local path_entry="$1"
  if [[ -z "${path_entry}" ]]; then
    return
  fi

  case ":${PATH}:" in
    *":${path_entry}:"*)
      return
      ;;
  esac

  export PATH="${path_entry}:${PATH}"
}

append_line_if_missing() {
  local target_file="$1"
  local line="$2"

  mkdir -p "$(dirname "${target_file}")"
  touch "${target_file}"

  if grep -Fqx "${line}" "${target_file}"; then
    return
  fi

  printf "\n%s\n" "${line}" >>"${target_file}"
}

persist_path_entry() {
  local path_entry="$1"
  if [[ -z "${path_entry}" ]]; then
    return
  fi

  local export_line
  export_line="case \":\$PATH:\" in *\":${path_entry}:\"*) ;; *) export PATH=\"${path_entry}:\$PATH\" ;; esac"

  append_line_if_missing "${HOME}/.profile" "${export_line}"
  append_line_if_missing "${HOME}/.bashrc" "${export_line}"
  append_line_if_missing "${HOME}/.zshrc" "${export_line}"

  local fish_line
  fish_line="contains -- \"${path_entry}\" \$PATH; or set -gx PATH \"${path_entry}\" \$PATH"
  append_line_if_missing "${HOME}/.config/fish/config.fish" "${fish_line}"
}

run_with_spinner() {
  local message="$1"
  shift

  local log_file
  log_file="$(mktemp)"

  "$@" >"${log_file}" 2>&1 &
  local command_pid=$!

  local bar_width=28
  local tick=0
  local start_seconds=$SECONDS

  while kill -0 "${command_pid}" >/dev/null 2>&1; do
    local head_position=$((tick % bar_width))
    local left_fill right_fill bar elapsed minutes seconds

    left_fill="$(printf '%*s' "${head_position}" '')"
    left_fill="${left_fill// /=}"
    right_fill="$(printf '%*s' "$((bar_width - head_position - 1))" '')"
    right_fill="${right_fill// /-}"
    bar="${left_fill}>${right_fill}"

    elapsed=$((SECONDS - start_seconds))
    minutes=$((elapsed / 60))
    seconds=$((elapsed % 60))

    printf "\r%b==>%b %s %b[%s]%b %b%02d:%02d%b" "${bold}" "${reset}" "${message}" "${cyan}" "${bar}" "${reset}" "${dim}" "${minutes}" "${seconds}" "${reset}"

    tick=$((tick + 1))
    sleep 0.12
  done

  set +e
  wait "${command_pid}"
  local command_status=$?
  set -e

  if [[ "${command_status}" -ne 0 ]]; then
    printf "\r"
    print_error "${message} failed"
    cat "${log_file}" >&2
    rm -f "${log_file}"
    exit "${command_status}"
  fi

  local full_bar
  full_bar="$(printf '%*s' "${bar_width}" '')"
  full_bar="${full_bar// /=}"
  local total_elapsed
  total_elapsed=$((SECONDS - start_seconds))
  local total_minutes total_seconds
  total_minutes=$((total_elapsed / 60))
  total_seconds=$((total_elapsed % 60))

  printf "\r%b==>%b %s %b[%s]%b %b%02d:%02d%b\n" "${green}${bold}" "${reset}" "${message}" "${green}" "${full_bar}" "${reset}" "${dim}" "${total_minutes}" "${total_seconds}" "${reset}"
  rm -f "${log_file}"
}

run_privileged() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
    return
  fi

  if command_exists sudo; then
    sudo "$@"
    return
  fi

  "$@"
}

detect_package_manager() {
  local -a candidates=(apt-get dnf yum pacman apk zypper brew)
  local candidate

  for candidate in "${candidates[@]}"; do
    if command_exists "${candidate}"; then
      printf "%s" "${candidate}"
      return
    fi
  done

  printf ""
}

install_packages() {
  local package_manager="$1"
  shift

  if [[ "$#" -eq 0 ]]; then
    return
  fi

  local package_list
  package_list="$*"

  case "${package_manager}" in
    apt-get)
      if [[ "${apt_index_ready}" -eq 0 ]]; then
        run_with_spinner "Refreshing apt package index" run_privileged apt-get update
        apt_index_ready=1
      fi
      run_with_spinner "Installing ${package_list} via apt-get" run_privileged apt-get install -y "$@"
      ;;
    dnf)
      run_with_spinner "Installing ${package_list} via dnf" run_privileged dnf install -y "$@"
      ;;
    yum)
      run_with_spinner "Installing ${package_list} via yum" run_privileged yum install -y "$@"
      ;;
    pacman)
      run_with_spinner "Installing ${package_list} via pacman" run_privileged pacman -Sy --noconfirm "$@"
      ;;
    apk)
      run_with_spinner "Installing ${package_list} via apk" run_privileged apk add --no-cache "$@"
      ;;
    zypper)
      run_with_spinner "Installing ${package_list} via zypper" run_privileged zypper --non-interactive install "$@"
      ;;
    brew)
      run_with_spinner "Installing ${package_list} via brew" brew install "$@"
      ;;
    *)
      print_error "Unsupported package manager: ${package_manager}"
      exit 1
      ;;
  esac
}

install_command_with_package_manager() {
  local package_manager="$1"
  local command_name="$2"

  case "${command_name}" in
    node|npm)
      case "${package_manager}" in
        brew)
          install_packages "${package_manager}" node
          ;;
        *)
          install_packages "${package_manager}" nodejs npm
          ;;
      esac
      ;;
    tar)
      install_packages "${package_manager}" tar
      ;;
    curl)
      install_packages "${package_manager}" curl
      ;;
    wget)
      install_packages "${package_manager}" wget
      ;;
    sha256sum)
      install_packages "${package_manager}" coreutils
      ;;
    *)
      return 1
      ;;
  esac
}

download_file() {
  local source_url="$1"
  local destination_path="$2"

  if command_exists curl; then
    curl --progress-bar -fL "${source_url}" -o "${destination_path}"
    return
  fi

  if command_exists wget; then
    wget --progress=bar:force:noscroll -O "${destination_path}" "${source_url}"
    return
  fi

  print_error "curl or wget is required to download installer assets"
  exit 1
}

bootstrap_node_with_nvm() {
  if command_exists node && command_exists npm; then
    return
  fi

  if ! command_exists curl && ! command_exists wget; then
    return
  fi

  local nvm_dir="${HOME}/.nvm"
  if [[ ! -s "${nvm_dir}/nvm.sh" ]]; then
    local nvm_installer_path
    nvm_installer_path="$(mktemp)"
    print_step "Installing nvm runtime manager"
    download_file "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" "${nvm_installer_path}"
    run_with_spinner "Bootstrapping nvm" bash "${nvm_installer_path}"
    rm -f "${nvm_installer_path}"
  fi

  if [[ ! -s "${nvm_dir}/nvm.sh" ]]; then
    return
  fi

  run_with_spinner "Installing Node.js LTS" bash -lc "source '${nvm_dir}/nvm.sh' && nvm install --lts"

  set +u
  . "${nvm_dir}/nvm.sh"
  set -u
  nvm use --lts >/dev/null 2>&1 || true

  local node_path
  node_path="$(command -v node || true)"
  if [[ -n "${node_path}" ]]; then
    local node_bin_dir
    node_bin_dir="$(dirname "${node_path}")"
    prepend_path_if_missing "${node_bin_dir}"
    persist_path_entry "${node_bin_dir}"
  fi
}

ensure_command() {
  local command_name="$1"
  if command_exists "${command_name}"; then
    return
  fi

  local package_manager
  package_manager="$(detect_package_manager)"

  if [[ -n "${package_manager}" ]]; then
    print_step "Missing dependency '${command_name}'. Auto-installing with ${package_manager}."
    install_command_with_package_manager "${package_manager}" "${command_name}" || true
  fi

  if ! command_exists "${command_name}" && ([[ "${command_name}" == "node" ]] || [[ "${command_name}" == "npm" ]]); then
    bootstrap_node_with_nvm
  fi

  if ! command_exists "${command_name}"; then
    print_error "Unable to install required dependency: ${command_name}"
    exit 1
  fi
}

ensure_downloader() {
  if command_exists curl || command_exists wget; then
    return
  fi

  ensure_command curl

  if command_exists curl || command_exists wget; then
    return
  fi

  ensure_command wget

  if ! command_exists curl && ! command_exists wget; then
    print_error "Unable to install a downloader (curl or wget)"
    exit 1
  fi
}

resolve_npm_global_prefix() {
  local prefix
  prefix="$(npm prefix -g 2>/dev/null || true)"

  if [[ -z "${prefix}" || "${prefix}" == "undefined" || "${prefix}" == "null" ]]; then
    prefix="${NPM_CONFIG_PREFIX:-}"
  fi

  if [[ -z "${prefix}" || "${prefix}" == "undefined" || "${prefix}" == "null" ]]; then
    prefix="$(npm config get prefix 2>/dev/null || true)"
  fi

  if [[ "${prefix}" == "undefined" || "${prefix}" == "null" ]]; then
    prefix=""
  fi

  printf "%s" "${prefix}"
}

path_is_writable_directory() {
  local target_dir="$1"
  if [[ -z "${target_dir}" ]]; then
    return 1
  fi

  mkdir -p "${target_dir}" >/dev/null 2>&1 || return 1
  [[ -w "${target_dir}" ]]
}

configure_user_npm_global_prefix() {
  local fallback_prefix
  fallback_prefix="${HOME}/.local/share/npm-global"

  print_warn "npm global prefix is not writable. Using user-local prefix at ${fallback_prefix}"
  mkdir -p "${fallback_prefix}/bin" "${fallback_prefix}/lib"

  if ! npm config set prefix "${fallback_prefix}" --location=user >/dev/null 2>&1; then
    print_error "Unable to configure npm user prefix at ${fallback_prefix}"
    exit 1
  fi

  export NPM_CONFIG_PREFIX="${fallback_prefix}"
  prepend_path_if_missing "${fallback_prefix}/bin"
  persist_path_entry "${fallback_prefix}/bin"
}

ensure_npm_global_install_ready() {
  local prefix
  prefix="$(resolve_npm_global_prefix)"

  if [[ -z "${prefix}" ]]; then
    configure_user_npm_global_prefix
    return
  fi

  if path_is_writable_directory "${prefix}" && path_is_writable_directory "${prefix}/bin"; then
    return
  fi

  configure_user_npm_global_prefix
}

compute_sha256() {
  local target_path="$1"

  if command_exists sha256sum; then
    sha256sum "${target_path}" | awk '{print $1}'
    return
  fi

  if command_exists shasum; then
    shasum -a 256 "${target_path}" | awk '{print $1}'
    return
  fi

  if command_exists openssl; then
    openssl dgst -sha256 "${target_path}" | awk '{print $2}'
    return
  fi

  ensure_command sha256sum
  sha256sum "${target_path}" | awk '{print $1}'
}

verify_archive_checksum_if_configured() {
  local archive_path="$1"
  local expected_checksum="$2"

  if [[ -z "${expected_checksum}" ]]; then
    return
  fi

  local expected_lower
  expected_lower="$(printf "%s" "${expected_checksum}" | tr '[:upper:]' '[:lower:]')"
  if [[ ! "${expected_lower}" =~ ^[0-9a-f]{64}$ ]]; then
    print_error "OMNI_CONNECTOR_ARCHIVE_SHA256 must be a 64-character hex string"
    exit 1
  fi

  local actual_checksum
  actual_checksum="$(compute_sha256 "${archive_path}")"
  if [[ "${actual_checksum}" != "${expected_lower}" ]]; then
    print_error "archive checksum mismatch"
    printf "Expected: %s\n" "${expected_lower}" >&2
    printf "Actual:   %s\n" "${actual_checksum}" >&2
    exit 1
  fi
}

resolve_installed_command() {
  local npm_prefix="$1"
  local candidate

  if [[ -n "${npm_prefix}" ]]; then
    candidate="${npm_prefix}/bin/omni-connector"
    if [[ -x "${candidate}" ]]; then
      printf "%s" "${candidate}"
      return 0
    fi
  fi

  local discovered
  discovered="$(command -v omni-connector || true)"
  if [[ -n "${discovered}" ]]; then
    printf "%s" "${discovered}"
    return 0
  fi

  local npm_root
  npm_root="$(npm root -g 2>/dev/null || true)"
  local fallback
  fallback="${npm_root}/omni-connector/bin/omni-connector"
  if [[ -x "${fallback}" ]]; then
    printf "%s" "${fallback}"
    return 0
  fi

  return 1
}

ensure_global_command_visibility() {
  local omni_command="$1"
  local npm_prefix="$2"

  if [[ -n "${npm_prefix}" ]]; then
    local global_bin
    global_bin="${npm_prefix}/bin"
    prepend_path_if_missing "${global_bin}"
    persist_path_entry "${global_bin}"
  fi

  local user_bin
  user_bin="${HOME}/.local/bin"
  mkdir -p "${user_bin}"
  ln -sf "${omni_command}" "${user_bin}/omni-connector"

  local pn_link_path
  pn_link_path="${user_bin}/pn"
  local existing_pn
  existing_pn="$(command -v pn || true)"
  if [[ -n "${existing_pn}" && "${existing_pn}" != "${pn_link_path}" ]]; then
    print_warn "Skipped creating pn shortcut because '${existing_pn}' is already in PATH"
  else
    ln -sf "${omni_command}" "${pn_link_path}"
  fi

  prepend_path_if_missing "${user_bin}"
  persist_path_entry "${user_bin}"

  if ! command_exists omni-connector; then
    prepend_path_if_missing "$(dirname "${omni_command}")"
  fi

  if ! command_exists omni-connector; then
    print_error "Could not expose omni-connector globally after installation"
    exit 1
  fi

  if ! command_exists pn; then
    print_warn "pn shortcut is unavailable. Use 'omni-connector --update' for manual updates."
  fi
}

url_is_ready() {
  local target_url="$1"

  if command_exists curl; then
    curl -fsS --max-time 2 "${target_url}" >/dev/null 2>&1 && return 0
  fi

  if command_exists wget; then
    wget -q --spider --timeout=2 "${target_url}" >/dev/null 2>&1 && return 0
  fi

  return 1
}

open_url_in_browser() {
  local target_url="$1"

  if command_exists xdg-open; then
    nohup xdg-open "${target_url}" >/dev/null 2>&1 &
    return 0
  fi

  if command_exists open; then
    nohup open "${target_url}" >/dev/null 2>&1 &
    return 0
  fi

  if command_exists cmd.exe; then
    cmd.exe /c start "" "${target_url}" >/dev/null 2>&1 || true
    return 0
  fi

  if command_exists powershell.exe; then
    powershell.exe -NoProfile -Command "Start-Process '${target_url}'" >/dev/null 2>&1 || true
    return 0
  fi

  return 1
}

write_update_runner_script() {
  local install_runtime_dir
  install_runtime_dir="${HOME}/.omni-connector/install"
  local update_runner_path
  update_runner_path="${install_runtime_dir}/update.sh"

  mkdir -p "${install_runtime_dir}"

  cat >"${update_runner_path}" <<EOF
#!/usr/bin/env bash
set -euo pipefail

export PATH="\${HOME}/.local/bin:\${HOME}/.local/share/npm-global/bin:\${PATH}"

if [[ -s "\${HOME}/.nvm/nvm.sh" ]]; then
  set +u
  . "\${HOME}/.nvm/nvm.sh"
  set -u
  nvm use --lts >/dev/null 2>&1 || true
fi

repo="\${OMNI_CONNECTOR_REPO:-${repo}}"
ref="\${OMNI_CONNECTOR_REF:-${ref}}"
install_script_url="\${OMNI_CONNECTOR_INSTALL_SCRIPT_URL:-https://raw.githubusercontent.com/\${repo}/\${ref}/scripts/install.sh}"
install_script_sha256="\${OMNI_CONNECTOR_INSTALL_SCRIPT_SHA256:-${install_script_sha256}}"
default_install_script_url="https://raw.githubusercontent.com/\${repo}/\${ref}/scripts/install.sh"

if [[ "\${install_script_url}" != "\${default_install_script_url}" && -z "\${install_script_sha256}" ]]; then
  printf "custom OMNI_CONNECTOR_INSTALL_SCRIPT_URL requires OMNI_CONNECTOR_INSTALL_SCRIPT_SHA256\\n" >&2
  exit 1
fi

tmp_file="\$(mktemp)"
cleanup() {
  rm -f "\${tmp_file}"
}
trap cleanup EXIT

if command -v curl >/dev/null 2>&1; then
  curl -fsSL -o "\${tmp_file}" "\${install_script_url}"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "\${tmp_file}" "\${install_script_url}"
else
  exit 1
fi

if [[ -n "\${install_script_sha256}" ]]; then
  expected_checksum="\$(printf '%s' "\${install_script_sha256}" | tr '[:upper:]' '[:lower:]')"
  if [[ ! "\${expected_checksum}" =~ ^[0-9a-f]{64}$ ]]; then
    printf "OMNI_CONNECTOR_INSTALL_SCRIPT_SHA256 must be a 64-character hex string\\n" >&2
    exit 1
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    actual_checksum="\$(sha256sum "\${tmp_file}" | awk '{print \$1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual_checksum="\$(shasum -a 256 "\${tmp_file}" | awk '{print \$1}')"
  elif command -v openssl >/dev/null 2>&1; then
    actual_checksum="\$(openssl dgst -sha256 "\${tmp_file}" | awk '{print \$2}')"
  else
    printf "Checksum verification requires sha256sum, shasum, or openssl\\n" >&2
    exit 1
  fi

  if [[ "\${actual_checksum}" != "\${expected_checksum}" ]]; then
    printf "Installer checksum mismatch\\n" >&2
    printf "Expected: %s\\n" "\${expected_checksum}" >&2
    printf "Actual:   %s\\n" "\${actual_checksum}" >&2
    exit 1
  fi
fi

OMNI_CONNECTOR_AUTO_START=0 OMNI_CONNECTOR_AUTO_OPEN_BROWSER=0 OMNI_CONNECTOR_SKIP_LOCAL_ENV=1 bash "\${tmp_file}"
EOF

  chmod +x "${update_runner_path}"
}

install_shell_update_fallback() {
  local install_runtime_dir
  install_runtime_dir="${HOME}/.omni-connector/install"
  local shell_update_path
  shell_update_path="${install_runtime_dir}/auto-update-on-shell.sh"

  cat >"${shell_update_path}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

install_runtime_dir="${HOME}/.omni-connector/install"
update_runner_path="${install_runtime_dir}/update.sh"
last_run_file="${install_runtime_dir}/last-auto-update.epoch"
log_file="${install_runtime_dir}/auto-update.log"
update_interval_seconds=86400

if [[ ! -x "${update_runner_path}" ]]; then
  exit 0
fi

current_epoch="$(date +%s)"
last_epoch=0
if [[ -f "${last_run_file}" ]]; then
  last_epoch="$(cat "${last_run_file}" 2>/dev/null || printf '0')"
fi

if [[ ! "${last_epoch}" =~ ^[0-9]+$ ]]; then
  last_epoch=0
fi

if (( current_epoch - last_epoch < update_interval_seconds )); then
  exit 0
fi

if "${update_runner_path}" >>"${log_file}" 2>&1; then
  printf "%s" "${current_epoch}" >"${last_run_file}"
else
  printf "[%s] Auto-update failed\n" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"${log_file}"
fi
EOF

  chmod +x "${shell_update_path}"

  local shell_hook_line
  shell_hook_line='[ -x "$HOME/.omni-connector/install/auto-update-on-shell.sh" ] && "$HOME/.omni-connector/install/auto-update-on-shell.sh" >/dev/null 2>&1 &'
  append_line_if_missing "${HOME}/.profile" "${shell_hook_line}"
  append_line_if_missing "${HOME}/.bashrc" "${shell_hook_line}"
  append_line_if_missing "${HOME}/.zshrc" "${shell_hook_line}"

  local fish_hook_line
  fish_hook_line='if test -x "$HOME/.omni-connector/install/auto-update-on-shell.sh"; "$HOME/.omni-connector/install/auto-update-on-shell.sh" >/dev/null 2>&1 &; end'
  append_line_if_missing "${HOME}/.config/fish/config.fish" "${fish_hook_line}"
}

install_systemd_update_timer() {
  if ! command_exists systemctl; then
    return 1
  fi

  local systemd_user_dir
  systemd_user_dir="${HOME}/.config/systemd/user"
  mkdir -p "${systemd_user_dir}"

  cat >"${systemd_user_dir}/omni-connector-update.service" <<'EOF'
[Unit]
Description=omni-connector auto updater

[Service]
Type=oneshot
Environment=HOME=%h
Environment=PATH=%h/.local/bin:%h/.local/share/npm-global/bin:/usr/local/bin:/usr/bin:/bin
WorkingDirectory=%h
ExecStart=%h/.omni-connector/install/update.sh
EOF

  cat >"${systemd_user_dir}/omni-connector-update.timer" <<'EOF'
[Unit]
Description=Run omni-connector updater daily

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=30m

[Install]
WantedBy=timers.target
EOF

  if ! systemctl --user daemon-reload >/dev/null 2>&1; then
    return 1
  fi

  if ! systemctl --user enable --now omni-connector-update.timer >/dev/null 2>&1; then
    return 1
  fi

  return 0
}

install_cron_update_schedule() {
  if ! command_exists crontab; then
    return 1
  fi

  local update_runner_path
  update_runner_path="${HOME}/.omni-connector/install/update.sh"
  local cron_entry
  cron_entry="19 3 * * * ${update_runner_path} >>${HOME}/.omni-connector/install/auto-update.log 2>&1"

  local existing
  existing="$(crontab -l 2>/dev/null || true)"
  local filtered
  filtered="$(printf '%s\n' "${existing}" | grep -Fv "${update_runner_path}" || true)"

  local merged
  merged="${filtered}"
  if [[ -n "${merged}" ]]; then
    merged="${merged}"$'\n'
  fi
  merged="${merged}${cron_entry}"

  printf "%s\n" "${merged}" | crontab -
  return 0
}

setup_auto_update() {
  write_update_runner_script

  if install_systemd_update_timer; then
    print_ok "Auto-update scheduled with systemd user timer"
    return
  fi

  if install_cron_update_schedule; then
    print_ok "Auto-update scheduled with cron"
    return
  fi

  install_shell_update_fallback
  print_ok "Auto-update scheduled with shell startup fallback"
}

start_service_if_enabled() {
  local omni_command="$1"

  if [[ "${OMNI_CONNECTOR_AUTO_START:-1}" != "1" ]]; then
    return
  fi

  local runtime_url
  runtime_url="${OMNI_CONNECTOR_START_URL:-${DEFAULT_URL}}"
  local runtime_log_dir
  runtime_log_dir="${HOME}/.omni-connector/logs"
  local runtime_log_file
  runtime_log_file="${runtime_log_dir}/installer-start.log"

  mkdir -p "${runtime_log_dir}"

  if url_is_ready "${runtime_url}"; then
    print_ok "${PROJECT_NAME} is already running at ${runtime_url}"
  else
    print_step "Starting ${PROJECT_NAME} service"
    nohup "${omni_command}" >"${runtime_log_file}" 2>&1 &
    local service_pid=$!

    local ready=0
    local attempt=0
    while [[ "${attempt}" -lt 40 ]]; do
      if url_is_ready "${runtime_url}"; then
        ready=1
        break
      fi

      if ! kill -0 "${service_pid}" >/dev/null 2>&1; then
        break
      fi

      attempt=$((attempt + 1))
      sleep 1
    done

    if [[ "${ready}" -eq 1 ]]; then
      print_ok "Service is running at ${runtime_url}"
    else
      print_warn "Service startup is still in progress. Logs: ${runtime_log_file}"
    fi
  fi

  if [[ "${OMNI_CONNECTOR_AUTO_OPEN_BROWSER:-1}" == "1" ]]; then
    if open_url_in_browser "${runtime_url}"; then
      print_ok "Opened ${runtime_url} in your browser"
    else
      print_warn "Could not open browser automatically"
    fi
  fi
}

print_logo

repo="${OMNI_CONNECTOR_REPO:-omnious0o0/omni-connector}"
ref="${OMNI_CONNECTOR_REF:-main}"
archive_url="${OMNI_CONNECTOR_ARCHIVE_URL:-https://codeload.github.com/${repo}/tar.gz/${ref}}"
archive_sha256="${OMNI_CONNECTOR_ARCHIVE_SHA256:-}"
install_script_sha256="${OMNI_CONNECTOR_INSTALL_SCRIPT_SHA256:-}"
install_target="${OMNI_CONNECTOR_INSTALL_TARGET:-}"

stage_total=5
if [[ -z "${install_target}" ]]; then
  stage_total=$((stage_total + 1))
fi
if [[ "${OMNI_CONNECTOR_AUTO_START:-1}" == "1" ]]; then
  stage_total=$((stage_total + 1))
fi

if [[ "${OMNI_CONNECTOR_INSTALLER_DRY_RUN:-0}" == "1" ]]; then
  print_step "Dry run enabled"
  printf "Planned installer phases: %d\n" "${stage_total}"
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
  printf "Would export omni-connector globally\n"
  printf "Would create pn shortcut globally\n"
  printf "Would run: omni-connector --init-only\n"
  printf "Would configure automatic updates\n"
  printf "Manual update commands: omni-connector --update | pn --upd\n"
  if [[ "${OMNI_CONNECTOR_AUTO_START:-1}" == "1" ]]; then
    printf "Would start service and open: %s\n" "${OMNI_CONNECTOR_START_URL:-${DEFAULT_URL}}"
  fi
  exit 0
fi

stage_step "Preparing self-healing dependencies"
ensure_command node
ensure_command npm
ensure_npm_global_install_ready

if [[ -z "${install_target}" ]]; then
  ensure_downloader
  ensure_command tar
fi

if [[ -n "${install_target}" ]]; then
  stage_step "Installing global package"
  print_step "Installing ${PROJECT_NAME} globally from ${install_target}"
  run_with_spinner "Installing global package" npm install -g --ignore-scripts "${install_target}"
else
  stage_step "Downloading and building release package"
  print_step "Installing ${PROJECT_NAME} from source archive"

  default_archive_url="https://codeload.github.com/${repo}/tar.gz/${ref}"
  if [[ "${archive_url}" != "${default_archive_url}" && -z "${archive_sha256}" ]]; then
    print_error "custom OMNI_CONNECTOR_ARCHIVE_URL requires OMNI_CONNECTOR_ARCHIVE_SHA256 for verification"
    exit 1
  fi

  tmp_dir="$(mktemp -d)"
  cleanup_tmp() {
    rm -rf "${tmp_dir}"
  }
  trap cleanup_tmp EXIT

  archive_path="${tmp_dir}/omni-connector.tar.gz"
  print_step "Downloading source archive"
  download_file "${archive_url}" "${archive_path}"
  verify_archive_checksum_if_configured "${archive_path}" "${archive_sha256}"

  print_step "Extracting source archive"
  tar -xzf "${archive_path}" -C "${tmp_dir}"

  source_dir=""
  for unpacked_path in "${tmp_dir}"/*; do
    if [[ -d "${unpacked_path}" ]]; then
      source_dir="${unpacked_path}"
      break
    fi
  done

  if [[ -z "${source_dir}" ]]; then
    print_error "Unable to unpack source archive from ${archive_url}"
    exit 1
  fi

  run_with_spinner "Installing project dependencies" npm --prefix "${source_dir}" install --include=dev --no-audit --no-fund --ignore-scripts
  run_with_spinner "Building project artifacts" npm --prefix "${source_dir}" run build

  print_step "Packing release artifact"
  package_archive_name="$(npm --prefix "${source_dir}" pack --silent --pack-destination "${tmp_dir}" --ignore-scripts)"
  package_archive_path="${tmp_dir}/${package_archive_name}"
  run_with_spinner "Installing global package" npm install -g --ignore-scripts "${package_archive_path}"
fi

global_prefix="$(resolve_npm_global_prefix)"
installed_command="$(resolve_installed_command "${global_prefix}" || true)"

if [[ -z "${installed_command}" ]]; then
  print_error "${PROJECT_NAME} binary was not found after installation"
  exit 1
fi

stage_step "Exporting commands globally"
ensure_global_command_visibility "${installed_command}" "${global_prefix}"

pn_shortcut_available=0
if command_exists pn; then
  pn_shortcut_available=1
fi

stage_step "Initializing runtime files"
run_with_spinner "Initializing runtime files" env OMNI_CONNECTOR_SKIP_LOCAL_ENV=1 "${installed_command}" --init-only

stage_step "Configuring automatic updates"
setup_auto_update

if [[ "${OMNI_CONNECTOR_AUTO_START:-1}" == "1" ]]; then
  stage_step "Starting local dashboard"
fi
start_service_if_enabled "${installed_command}"

printf "%bInstall complete.%b\n" "${green}${bold}" "${reset}"
printf "%bRun now:%b omni-connector\n" "${bold}" "${reset}"
if [[ "${pn_shortcut_available}" -eq 1 ]]; then
  printf "%bShortcut:%b pn\n" "${bold}" "${reset}"
  printf "%bManual update:%b omni-connector --update  (shortcut: pn --upd)\n" "${bold}" "${reset}"
else
  printf "%bManual update:%b omni-connector --update\n" "${bold}" "${reset}"
fi
printf "%bDefault URL:%b %s\n" "${bold}" "${reset}" "${DEFAULT_URL}"
printf "%bData location:%b %s\n" "${dim}" "${reset}" "${HOME}/.omni-connector/data/store.json"
printf "%bCommand shim:%b %s\n" "${dim}" "${reset}" "${HOME}/.local/bin/omni-connector"
