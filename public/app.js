const toastElement = document.querySelector("#toast");
const toastMsgElement = document.querySelector(".toast-msg");
const toastIconElement = document.querySelector(".toast-icon");
const appLayoutElement = document.querySelector(".app-layout");
const mainContentElement = document.querySelector(".main-content");
const sidebarResizer = document.querySelector("#sidebar-resizer");
const topbarTimeElement = document.querySelector("#topbar-time");
const topbarStatusElement = document.querySelector("#topbar-status");
const topbarStatusTextElement = document.querySelector("#topbar-status-text");
const dashboardViewElement = document.querySelector("#dashboard-view");
const settingsViewElement = document.querySelector("#settings-view");
const showOverviewButton = document.querySelector("#show-overview");
const toggleSidebarButton = document.querySelector("#toggle-sidebar");
const openSettingsButton = document.querySelector("#open-settings");
const showSensitiveInput = document.querySelector("#settings-show-sensitive");
const revealKeyInput = document.querySelector("#settings-reveal-key");
const maskRoutePayloadInput = document.querySelector("#settings-mask-route-payload");
const compactCardsInput = document.querySelector("#settings-compact-cards");
const defaultCollapsedInput = document.querySelector("#settings-default-collapsed");
const autoRefreshInput = document.querySelector("#settings-auto-refresh");
const confirmRemovalInput = document.querySelector("#settings-confirm-removal");
const rememberPageTabInput = document.querySelector("#settings-remember-page-tab");
const keyAccessNote = document.querySelector("#key-access-note");
const connectorKeyElement = document.querySelector("#connector-key");
const accountsListElement = document.querySelector("#accounts-list");
const routeResultElement = document.querySelector("#route-result");
const routeForm = document.querySelector("#route-test-form");
const routeUnitsInput = document.querySelector("#route-units");
const routeSubmitButton = document.querySelector("#route-test-form button[type='submit']");
const rotateKeyButton = document.querySelector("#rotate-key");
const copyKeyButton = document.querySelector("#copy-key");
const keyVisibilityButton = document.querySelector("#toggle-key-visibility");
const connectTriggerButton = document.querySelector("#connect-trigger");
const connectModalElement = document.querySelector("#connect-modal");
const connectProviderListElement = document.querySelector("#connect-provider-list");
const connectModalCloseButton = document.querySelector("#connect-modal-close");
const apiLinkForm = document.querySelector("#api-link-form");
const apiLinkTitleElement = document.querySelector("#api-link-title");
const apiLinkProviderElement = document.querySelector("#api-link-provider");
const apiLinkDisplayNameInput = document.querySelector("#api-link-display-name");
const apiLinkProviderAccountIdInput = document.querySelector("#api-link-provider-account-id");
const apiLinkKeyInput = document.querySelector("#api-link-key");
const apiLinkManualFiveHourInput = document.querySelector("#api-link-manual-5h");
const apiLinkManualWeeklyInput = document.querySelector("#api-link-manual-7d");
const apiLinkManualFiveHourLabel = document.querySelector('label[for="api-link-manual-5h"]');
const apiLinkManualWeeklyLabel = document.querySelector('label[for="api-link-manual-7d"]');
const apiLinkManualNoteElement = document.querySelector("#api-link-manual-note");
const apiLinkCancelButton = document.querySelector("#api-link-cancel");
const accountSettingsModalElement = document.querySelector("#account-settings-modal");
const accountSettingsCloseButton = document.querySelector("#account-settings-close");
const accountSettingsForm = document.querySelector("#account-settings-form");
const accountSettingsProviderElement = document.querySelector("#account-settings-provider");
const accountSettingsAuthElement = document.querySelector("#account-settings-auth");
const accountSettingsProviderAccountElement = document.querySelector("#account-settings-provider-account");
const accountSettingsOAuthProfileWrapperElement = document.querySelector("#account-settings-oauth-profile-wrapper");
const accountSettingsOAuthProfileElement = document.querySelector("#account-settings-oauth-profile");
const accountSettingsSyncStatusElement = document.querySelector("#account-settings-sync-status");
const accountSettingsDisplayNameInput = document.querySelector("#account-settings-display-name");
const accountSettingsApiLimitsElement = document.querySelector("#account-settings-api-limits");
const accountSettingsFiveHourInput = document.querySelector("#account-settings-5h");
const accountSettingsWeeklyInput = document.querySelector("#account-settings-7d");
const accountSettingsCancelButton = document.querySelector("#account-settings-cancel");

let dashboard = null;
let toastTimer = null;
let sidebarCollapsed = false;
let sidebarWidth = 288;
let showSensitiveData = false;
let revealApiKeyByDefault = false;
let maskRoutePayload = true;
let compactCards = true;
let defaultSidebarCollapsed = false;
let autoRefreshEnabled = false;
let confirmRemoval = true;
let rememberPageTab = true;
let forceRevealApiKey = null;
let dashboardAuthorized = false;
let currentView = "overview";
let resizingPointerId = null;
let resizingStartX = 0;
let resizingStartWidth = 0;
let autoRefreshTimer = null;
let autoRefreshInFlight = false;
let lastRoutePayload = null;
let clockTimer = null;
let providerConfigured = null;
let dashboardLoaded = false;
let statusError = false;
let connectProviders = [];
let selectedApiProviderId = null;
let apiLinkManualLimitsEnabled = false;
let connectModalPreviousFocus = null;
let accountSettingsPreviousFocus = null;
let selectedAccountSettingsId = null;
let strictLiveQuotaEnabled = false;
let connectWarningTooltipElement = null;
let activeWarningTrigger = null;

const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;
const STORAGE_KEY_PREFIX = "omni-connector";
const LEGACY_STORAGE_KEY_PREFIX = "codex-connector";
const STORAGE_KEYS = {
  sidebarWidth: `${STORAGE_KEY_PREFIX}.sidebar-width`,
  sidebarCollapsed: `${STORAGE_KEY_PREFIX}.sidebar-collapsed`,
  showSensitiveData: `${STORAGE_KEY_PREFIX}.show-sensitive`,
  revealApiKeyByDefault: `${STORAGE_KEY_PREFIX}.reveal-api-key`,
  maskRoutePayload: `${STORAGE_KEY_PREFIX}.mask-route-payload`,
  compactCards: `${STORAGE_KEY_PREFIX}.compact-cards`,
  defaultSidebarCollapsed: `${STORAGE_KEY_PREFIX}.default-sidebar-collapsed`,
  autoRefreshEnabled: `${STORAGE_KEY_PREFIX}.auto-refresh`,
  confirmRemoval: `${STORAGE_KEY_PREFIX}.confirm-removal`,
  rememberPageTab: `${STORAGE_KEY_PREFIX}.remember-page-tab`,
  activeView: `${STORAGE_KEY_PREFIX}.active-view`,
};
const LEGACY_STORAGE_KEYS = Object.freeze(
  Object.fromEntries(
    Object.entries(STORAGE_KEYS).map(([key, value]) => [
      key,
      value.replace(STORAGE_KEY_PREFIX, LEGACY_STORAGE_KEY_PREFIX),
    ]),
  ),
);

const AUTO_REFRESH_INTERVAL_MS = 30_000;

if (window.lucide) {
  lucide.createIcons();
}

function reRenderIcons() {
  if (window.lucide) {
    lucide.createIcons();
  }
}

function warningItemsFromTrigger(trigger) {
  if (!(trigger instanceof HTMLElement)) {
    return [];
  }

  const raw = trigger.dataset.warningItems;
  if (typeof raw !== "string" || raw.length === 0) {
    return [];
  }

  return raw
    .split("|")
    .map((item) => {
      try {
        return decodeURIComponent(item).trim();
      } catch {
        return "";
      }
    })
    .filter((item) => item.length > 0);
}

function ensureConnectWarningTooltipElement() {
  if (connectWarningTooltipElement instanceof HTMLElement) {
    return connectWarningTooltipElement;
  }

  const element = document.createElement("div");
  element.className = "connect-provider-warning-floating";
  element.hidden = true;
  element.setAttribute("role", "tooltip");
  document.body.append(element);
  connectWarningTooltipElement = element;
  return element;
}

function positionConnectWarningTooltip(trigger, tooltip) {
  const triggerRect = trigger.getBoundingClientRect();
  const spacing = 8;
  const viewportPadding = 12;
  const maxWidth = Math.max(220, Math.min(360, window.innerWidth - viewportPadding * 2));

  tooltip.style.maxWidth = `${maxWidth}px`;
  tooltip.style.left = `${viewportPadding}px`;
  tooltip.style.top = `${viewportPadding}px`;

  const tooltipRect = tooltip.getBoundingClientRect();

  let left = triggerRect.left;
  if (left + tooltipRect.width > window.innerWidth - viewportPadding) {
    left = window.innerWidth - viewportPadding - tooltipRect.width;
  }
  if (left < viewportPadding) {
    left = viewportPadding;
  }

  let top = triggerRect.bottom + spacing;
  if (top + tooltipRect.height > window.innerHeight - viewportPadding) {
    top = triggerRect.top - tooltipRect.height - spacing;
  }
  if (top < viewportPadding) {
    top = viewportPadding;
  }

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

function hideConnectWarningTooltip() {
  if (!(connectWarningTooltipElement instanceof HTMLElement)) {
    activeWarningTrigger = null;
    return;
  }

  connectWarningTooltipElement.hidden = true;
  connectWarningTooltipElement.innerHTML = "";
  activeWarningTrigger = null;
}

function showConnectWarningTooltip(trigger) {
  const items = warningItemsFromTrigger(trigger);
  if (items.length === 0) {
    hideConnectWarningTooltip();
    return;
  }

  const tooltip = ensureConnectWarningTooltipElement();
  tooltip.innerHTML = `
    <p class="connect-provider-warning-title">Warnings</p>
    <ul>
      ${items.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}
    </ul>
  `;
  tooltip.hidden = false;
  positionConnectWarningTooltip(trigger, tooltip);
  activeWarningTrigger = trigger;
}

function bindConnectWarningTriggers() {
  if (!(connectProviderListElement instanceof HTMLElement)) {
    return;
  }

  const triggers = connectProviderListElement.querySelectorAll(".connect-provider-warning-trigger");
  for (const trigger of triggers) {
    if (!(trigger instanceof HTMLElement)) {
      continue;
    }

    trigger.addEventListener("mouseenter", () => {
      showConnectWarningTooltip(trigger);
    });

    trigger.addEventListener("mouseleave", () => {
      hideConnectWarningTooltip();
    });

    trigger.addEventListener("focus", () => {
      showConnectWarningTooltip(trigger);
    });

    trigger.addEventListener("blur", () => {
      hideConnectWarningTooltip();
    });
  }
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 1024px)").matches;
}

function clampSidebarWidth(value) {
  return Math.max(Math.min(value, MAX_SIDEBAR_WIDTH), MIN_SIDEBAR_WIDTH);
}

function readStoredBoolean(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return fallback;
    }

    return raw === "1";
  } catch {
    return fallback;
  }
}

function readStoredNumber(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return fallback;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function persistUiSettings() {
  try {
    window.localStorage.setItem(STORAGE_KEYS.sidebarWidth, String(sidebarWidth));
    window.localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, sidebarCollapsed ? "1" : "0");
    window.localStorage.setItem(STORAGE_KEYS.showSensitiveData, showSensitiveData ? "1" : "0");
    window.localStorage.setItem(STORAGE_KEYS.revealApiKeyByDefault, revealApiKeyByDefault ? "1" : "0");
    window.localStorage.setItem(STORAGE_KEYS.maskRoutePayload, maskRoutePayload ? "1" : "0");
    window.localStorage.setItem(STORAGE_KEYS.compactCards, compactCards ? "1" : "0");
    window.localStorage.setItem(STORAGE_KEYS.defaultSidebarCollapsed, defaultSidebarCollapsed ? "1" : "0");
    window.localStorage.setItem(STORAGE_KEYS.autoRefreshEnabled, autoRefreshEnabled ? "1" : "0");
    window.localStorage.setItem(STORAGE_KEYS.confirmRemoval, confirmRemoval ? "1" : "0");
    window.localStorage.setItem(STORAGE_KEYS.rememberPageTab, rememberPageTab ? "1" : "0");
    if (rememberPageTab) {
      window.localStorage.setItem(STORAGE_KEYS.activeView, currentView);
    } else {
      window.localStorage.removeItem(STORAGE_KEYS.activeView);
    }
  } catch {
    return;
  }
}

function loadUiSettings() {
  migrateLegacyUiSettings();

  sidebarWidth = clampSidebarWidth(readStoredNumber(STORAGE_KEYS.sidebarWidth, 288));
  sidebarCollapsed = readStoredBoolean(STORAGE_KEYS.sidebarCollapsed, false);
  showSensitiveData = readStoredBoolean(STORAGE_KEYS.showSensitiveData, false);
  revealApiKeyByDefault = readStoredBoolean(STORAGE_KEYS.revealApiKeyByDefault, false);
  maskRoutePayload = readStoredBoolean(STORAGE_KEYS.maskRoutePayload, true);
  compactCards = readStoredBoolean(STORAGE_KEYS.compactCards, true);
  defaultSidebarCollapsed = readStoredBoolean(STORAGE_KEYS.defaultSidebarCollapsed, false);
  autoRefreshEnabled = readStoredBoolean(STORAGE_KEYS.autoRefreshEnabled, false);
  confirmRemoval = readStoredBoolean(STORAGE_KEYS.confirmRemoval, true);
  rememberPageTab = readStoredBoolean(STORAGE_KEYS.rememberPageTab, true);

  if (defaultSidebarCollapsed && !isMobileViewport()) {
    sidebarCollapsed = true;
  }

  if (rememberPageTab) {
    try {
      const storedView = window.localStorage.getItem(STORAGE_KEYS.activeView);
      if (storedView === "settings") {
        currentView = "settings";
      }
    } catch {
      return;
    }
  }
}

function migrateLegacyUiSettings() {
  try {
    for (const [key, nextStorageKey] of Object.entries(STORAGE_KEYS)) {
      const legacyStorageKey = LEGACY_STORAGE_KEYS[key];
      if (typeof legacyStorageKey !== "string") {
        continue;
      }

      const nextValue = window.localStorage.getItem(nextStorageKey);
      if (nextValue !== null) {
        window.localStorage.removeItem(legacyStorageKey);
        continue;
      }

      const legacyValue = window.localStorage.getItem(legacyStorageKey);
      if (legacyValue === null) {
        continue;
      }

      window.localStorage.setItem(nextStorageKey, legacyValue);
      window.localStorage.removeItem(legacyStorageKey);
    }
  } catch {
    return;
  }
}

function applySidebarState() {
  if (!(appLayoutElement instanceof HTMLElement)) {
    return;
  }

  appLayoutElement.classList.toggle("sidebar-collapsed", sidebarCollapsed && !isMobileViewport());
  document.documentElement.style.setProperty("--sidebar-width", `${sidebarWidth}px`);

  if (toggleSidebarButton instanceof HTMLElement) {
    toggleSidebarButton.setAttribute("aria-pressed", sidebarCollapsed ? "true" : "false");
    toggleSidebarButton.textContent = "";
    const icon = document.createElement("i");
    icon.setAttribute("data-lucide", sidebarCollapsed ? "panel-left-open" : "panel-left-close");
    toggleSidebarButton.append(icon);
    toggleSidebarButton.setAttribute("aria-label", sidebarCollapsed ? "Expand panel" : "Collapse panel");
    toggleSidebarButton.setAttribute("title", sidebarCollapsed ? "Expand panel" : "Collapse panel");
    reRenderIcons();
  }

  updateSidebarResizerA11y();
}

function applySettingsState() {
  if (showSensitiveInput instanceof HTMLInputElement) {
    showSensitiveInput.checked = showSensitiveData;
  }

  if (revealKeyInput instanceof HTMLInputElement) {
    revealKeyInput.checked = revealApiKeyByDefault;
  }

  if (maskRoutePayloadInput instanceof HTMLInputElement) {
    maskRoutePayloadInput.checked = maskRoutePayload;
  }

  if (compactCardsInput instanceof HTMLInputElement) {
    compactCardsInput.checked = compactCards;
  }

  if (defaultCollapsedInput instanceof HTMLInputElement) {
    defaultCollapsedInput.checked = defaultSidebarCollapsed;
  }

  if (autoRefreshInput instanceof HTMLInputElement) {
    autoRefreshInput.checked = autoRefreshEnabled;
  }

  if (confirmRemovalInput instanceof HTMLInputElement) {
    confirmRemovalInput.checked = confirmRemoval;
  }

  if (rememberPageTabInput instanceof HTMLInputElement) {
    rememberPageTabInput.checked = rememberPageTab;
  }

  document.body.classList.toggle("accounts-density-compact", compactCards);
  document.body.classList.toggle("accounts-density-comfortable", !compactCards);

  if (keyVisibilityButton instanceof HTMLElement) {
    const revealing = shouldRevealConnectorKey();
    keyVisibilityButton.textContent = "";
    const icon = document.createElement("i");
    icon.setAttribute("data-lucide", revealing ? "eye" : "eye-off");
    keyVisibilityButton.append(icon);
    keyVisibilityButton.setAttribute("aria-label", revealing ? "Hide key" : "Reveal key");
    keyVisibilityButton.setAttribute("title", revealing ? "Hide key" : "Reveal key");
    reRenderIcons();
  }
}

function stopAutoRefreshTimer() {
  if (autoRefreshTimer !== null) {
    window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function startAutoRefreshTimer() {
  stopAutoRefreshTimer();

  if (!autoRefreshEnabled || currentView !== "overview") {
    return;
  }

  autoRefreshTimer = window.setInterval(async () => {
    if (autoRefreshInFlight) {
      return;
    }

    autoRefreshInFlight = true;
    try {
      await loadDashboard();
    } catch (error) {
      showToast(error.message || "Auto refresh failed.", true);
      stopAutoRefreshTimer();
      autoRefreshEnabled = false;
      persistUiSettings();
      applySettingsState();
    } finally {
      autoRefreshInFlight = false;
    }
  }, AUTO_REFRESH_INTERVAL_MS);
}

function setActiveView(view) {
  currentView = view === "settings" ? "settings" : "overview";

  if (mainContentElement instanceof HTMLElement) {
    mainContentElement.dataset.view = currentView;
  }

  if (dashboardViewElement instanceof HTMLElement) {
    dashboardViewElement.hidden = currentView !== "overview";
    dashboardViewElement.setAttribute("aria-hidden", currentView === "overview" ? "false" : "true");
    dashboardViewElement.tabIndex = currentView === "overview" ? 0 : -1;
  }

  if (settingsViewElement instanceof HTMLElement) {
    settingsViewElement.hidden = currentView !== "settings";
    settingsViewElement.setAttribute("aria-hidden", currentView === "settings" ? "false" : "true");
    settingsViewElement.tabIndex = currentView === "settings" ? 0 : -1;
  }

  if (showOverviewButton instanceof HTMLElement) {
    showOverviewButton.classList.toggle("is-active", currentView === "overview");
    showOverviewButton.setAttribute("aria-selected", currentView === "overview" ? "true" : "false");
    showOverviewButton.tabIndex = currentView === "overview" ? 0 : -1;
  }

  if (openSettingsButton instanceof HTMLElement) {
    openSettingsButton.classList.toggle("is-active", currentView === "settings");
    openSettingsButton.setAttribute("aria-selected", currentView === "settings" ? "true" : "false");
    openSettingsButton.tabIndex = currentView === "settings" ? 0 : -1;
  }

  if (currentView === "settings" && settingsViewElement instanceof HTMLElement) {
    settingsViewElement.scrollTop = 0;
  }

  persistUiSettings();
  startAutoRefreshTimer();
}

function setConnectorControlsEnabled(enabled) {
  if (copyKeyButton instanceof HTMLButtonElement) {
    copyKeyButton.disabled = !enabled;
    copyKeyButton.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  if (keyVisibilityButton instanceof HTMLButtonElement) {
    keyVisibilityButton.disabled = !enabled;
    keyVisibilityButton.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  if (rotateKeyButton instanceof HTMLButtonElement) {
    rotateKeyButton.disabled = !enabled;
    rotateKeyButton.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  if (routeUnitsInput instanceof HTMLInputElement) {
    routeUnitsInput.disabled = !enabled;
    routeUnitsInput.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  if (routeSubmitButton instanceof HTMLButtonElement) {
    routeSubmitButton.disabled = !enabled;
    routeSubmitButton.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  if (routeForm instanceof HTMLFormElement) {
    routeForm.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  if (keyAccessNote instanceof HTMLElement) {
    keyAccessNote.textContent = enabled
      ? "Actions available on this device."
      : "Waiting for dashboard access...";
  }
}

function updateTopbarClock() {
  if (!(topbarTimeElement instanceof HTMLElement)) {
    return;
  }

  const now = new Date();
  topbarTimeElement.textContent = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function startTopbarClock() {
  updateTopbarClock();

  if (clockTimer !== null) {
    window.clearInterval(clockTimer);
  }

  clockTimer = window.setInterval(updateTopbarClock, 1000);
}

function setTopbarStatus(state) {
  const safeState = state === "online" || state === "offline" ? state : "preparing";
  const labels = {
    online: "Online",
    preparing: "Preparing",
    offline: "Offline",
  };

  if (topbarStatusElement instanceof HTMLElement) {
    topbarStatusElement.dataset.state = safeState;
  }

  if (topbarStatusTextElement instanceof HTMLElement) {
    topbarStatusTextElement.textContent = labels[safeState];
  }
}

function refreshTopbarStatus() {
  if (statusError || providerConfigured === false) {
    setTopbarStatus("offline");
    return;
  }

  if (!dashboardLoaded || providerConfigured === null) {
    setTopbarStatus("preparing");
    return;
  }

  setTopbarStatus("online");
}

function showToast(message, isError = false) {
  if (!toastElement || !toastMsgElement) return;

  toastMsgElement.textContent = message;
  toastElement.classList.add("visible");
  toastElement.classList.toggle("error", isError);
  
  if (toastIconElement) {
    toastIconElement.setAttribute("data-lucide", isError ? "alert-triangle" : "info");
    reRenderIcons();
  }

  if (toastTimer !== null) {
    clearTimeout(toastTimer);
  }

  toastTimer = window.setTimeout(() => {
    toastElement.classList.remove("visible");
    toastTimer = null;
  }, 4000);
}

function escapeHtml(value) {
  if (!value) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}

function formatPercent(ratio) {
  return `${Math.round(ratio * 100)}%`;
}

function formatPercentValue(value) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `${Math.round(safeValue)}%`;
}

function clampRatio(ratio) {
  const safeRatio = Number.isFinite(ratio) ? ratio : 0;
  return Math.max(Math.min(safeRatio, 1), 0);
}

function maskAuthorizationHeader(headerValue) {
  if (typeof headerValue !== "string") {
    return headerValue;
  }

  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  if (!match || !match[1]) {
    return headerValue;
  }

  const token = match[1];
  const start = token.slice(0, 10);
  const end = token.slice(-6);
  return `Bearer ${start}...${end}`;
}

const MASKED_PAYLOAD_KEYS = [
  "authorization",
  "token",
  "secret",
  "apiKey",
  "providerAccountId",
  "chatgptAccountId",
  "accessToken",
  "refreshToken",
];

function shouldMaskPayloadKey(key) {
  return MASKED_PAYLOAD_KEYS.some((needle) => key.toLowerCase().includes(needle.toLowerCase()));
}

function sanitizePayloadNode(value, key = "") {
  if (typeof value === "string") {
    if (key.toLowerCase().includes("authorization")) {
      return maskAuthorizationHeader(value);
    }

    if (key.toLowerCase().includes("displayname")) {
      return maskDisplayNameForRoute(value);
    }

    if (shouldMaskPayloadKey(key)) {
      return maskSensitiveValue(value, 6, 4);
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizePayloadNode(item, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => {
        if (typeof entryValue === "string" && shouldMaskPayloadKey(entryKey)) {
          return [entryKey, sanitizePayloadNode(entryValue, entryKey)];
        }

        return [entryKey, sanitizePayloadNode(entryValue, entryKey)];
      }),
    );
  }

  return value;
}

function shouldRevealAccountDetails() {
  return showSensitiveData;
}

function shouldRevealConnectorKey() {
  if (forceRevealApiKey === null) {
    return revealApiKeyByDefault;
  }

  return forceRevealApiKey;
}

function maskSensitiveValue(value, start = 4, end = 3) {
  if (typeof value !== "string") {
    return "N/A";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "N/A";
  }

  if (trimmed.length <= start + end) {
    return `${trimmed.slice(0, 1)}***`;
  }

  return `${trimmed.slice(0, start)}...${trimmed.slice(-end)}`;
}

function maskDisplayName(value) {
  if (typeof value !== "string") {
    return "Unknown";
  }

  if (shouldRevealAccountDetails()) {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "Unknown";
  }

  if (trimmed.includes("@")) {
    return maskEmailMiddle(trimmed);
  }

  return maskSensitiveValue(trimmed, 2, 1);
}

function maskDisplayNameForRoute(value) {
  if (typeof value !== "string") {
    return "Unknown";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "Unknown";
  }

  if (trimmed.includes("@")) {
    return maskEmailMiddle(trimmed);
  }

  return maskSensitiveValue(trimmed, 2, 1);
}

function maskMiddleSection(value, start = 1, end = 1) {
  if (!value) {
    return "*";
  }

  if (value.length <= 2) {
    return `${value.slice(0, 1)}*`;
  }

  if (value.length <= start + end) {
    return `${value.slice(0, 1)}**${value.slice(-1)}`;
  }

  return `${value.slice(0, start)}***${value.slice(-end)}`;
}

function maskEmailMiddle(email) {
  const parts = email.split("@");
  const localPart = parts[0] ?? "";
  const domainFull = parts[1] ?? "";

  if (!localPart || !domainFull) {
    return maskSensitiveValue(email, 2, 1);
  }

  const maskedLocal = maskMiddleSection(localPart, 2, 2);
  return `${maskedLocal}@${domainFull}`;
}

function formatConnectorKeyDisplay(keyValue) {
  if (typeof keyValue !== "string" || !keyValue) {
    return "••••••••••••••••";
  }

  if (shouldRevealConnectorKey()) {
    return keyValue;
  }

  const bulletLength = Math.max(Math.min(keyValue.length, 32), 16);
  return "•".repeat(bulletLength);
}

function formatResetTime(resetIso) {
  if (!resetIso) return "N/A";
  const date = new Date(resetIso);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString();
}

function formatResetRelativeTime(resetIso) {
  if (!resetIso) {
    return "time unavailable";
  }

  const date = new Date(resetIso);
  if (Number.isNaN(date.getTime())) {
    return "time unavailable";
  }

  const deltaMs = date.getTime() - Date.now();
  if (deltaMs <= 0) {
    return "now";
  }

  const totalMinutes = Math.round(deltaMs / 60_000);
  if (totalMinutes < 60) {
    return `in ${totalMinutes}m`;
  }

  const totalHours = Math.round(totalMinutes / 60);
  if (totalHours < 24) {
    return `in ${totalHours}h`;
  }

  const totalDays = Math.round(totalHours / 24);
  return `in ${totalDays}d`;
}

function formatRechargeLine(resetIso) {
  return formatResetRelativeTime(resetIso);
}

function accountStateIndicator(account, fiveHour, weekly) {
  if (account.quotaSyncStatus !== "live") {
    return { className: "is-red", label: "Offline" };
  }

  if (weekly.ratio <= 0) {
    return { className: "is-red", label: "Weekly exhausted" };
  }

  if (fiveHour.ratio <= 0) {
    return { className: "is-orange", label: "Recharging 5h" };
  }

  return { className: "is-green", label: "Online" };
}

function providerVisualIdentity(providerValue) {
  const providerId = typeof providerValue === "string" ? providerValue.toLowerCase() : "unknown";
  const logoByProvider = {
    codex: { src: "/assets/openai.svg", alt: "OpenAI logo" },
    gemini: { src: "/assets/google.svg", alt: "Google logo" },
    claude: { src: "/assets/anthropic.svg", alt: "Anthropic logo" },
    openrouter: { src: "/assets/openrouter.svg", alt: "OpenRouter logo" },
  };

  const resolvedLogo = logoByProvider[providerId] ?? {
    src: "/assets/openrouter.svg",
    alt: "Provider logo",
  };

  return {
    providerId,
    logoSrc: resolvedLogo.src,
    logoAlt: resolvedLogo.alt,
    logoClass: `is-${providerId}`,
  };
}

function providerIdentityForAccount(account) {
  return providerVisualIdentity(account?.provider);
}

function quotaWindowPresentation(windowData) {
  const limit = Number(windowData?.limit);
  if (!Number.isFinite(limit) || limit <= 0) {
    return {
      value: "N/A",
      detail: "Live usage unavailable",
      ratio: 0,
      resetLabel: "No live quota window",
      resetAt: null,
    };
  }

  const ratio = clampRatio(Number(windowData?.remainingRatio));
  const remainingPercent = ratio * 100;
  const usedPercent = 100 - remainingPercent;
  const resetAt = windowData?.resetsAt ?? null;

  return {
    value: `${formatPercentValue(remainingPercent)}`,
    detail: `${formatPercentValue(usedPercent)} used / 100% capacity`,
    ratio,
    resetLabel: formatResetTime(resetAt),
    resetAt,
  };
}

function estimateAccuracyPercent(samples) {
  if (!Number.isFinite(samples) || samples <= 0) {
    return 0;
  }

  return Math.min(95, Math.round((samples / 24) * 100));
}

function usageEstimateNote(account) {
  if (!account || account.quotaSyncStatus === "live") {
    return null;
  }

  const fiveHourLimit = Number(account?.quota?.fiveHour?.limit ?? 0);
  const weeklyLimit = Number(account?.quota?.weekly?.limit ?? 0);
  const samples = Number(account?.estimatedUsageSampleCount ?? 0);

  if (samples <= 0) {
    if (fiveHourLimit <= 0 || weeklyLimit <= 0) {
      return "Usage is N/A until the first routed request. Estimation starts on first use.";
    }

    return null;
  }

  if (samples === 1) {
    return "Usage estimate started from the first routed request. Accuracy improves as more requests are routed.";
  }

  const accuracyPercent = estimateAccuracyPercent(samples);
  return `Usage is estimated from ${formatNumber(samples)} routed requests (~${accuracyPercent}/100 estimate stability). Accuracy improves with continued use.`;
}

function updateMetricText(selector, text) {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = text;
  }
}

function aggregateRemainingPercent(accounts, windowKey) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return 0;
  }

  let totalRemaining = 0;
  let totalLimit = 0;
  let ratioSum = 0;
  let ratioCount = 0;

  for (const account of accounts) {
    const windowData = account?.quota?.[windowKey];
    if (!windowData) {
      continue;
    }

    const limit = Number(windowData.limit);
    const remaining = Number(windowData.remaining);
    const ratio = clampRatio(Number(windowData.remainingRatio));

    if (Number.isFinite(limit) && limit > 0 && Number.isFinite(remaining)) {
      totalLimit += limit;
      totalRemaining += Math.max(Math.min(remaining, limit), 0);
    }

    ratioSum += ratio;
    ratioCount += 1;
  }

  if (totalLimit > 0) {
    return Math.max(Math.min((totalRemaining / totalLimit) * 100, 100), 0);
  }

  if (ratioCount === 0) {
    return 0;
  }

  return Math.max(Math.min((ratioSum / ratioCount) * 100, 100), 0);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: {
      "X-Omni-Client": "dashboard",
      ...(options.headers ?? {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const serverMessage =
      typeof payload === "object" && payload?.message ? payload.message : `Request failed (${response.status}).`;
    const message = response.status >= 500 ? "Server request failed. Please retry." : serverMessage;
    throw new Error(message);
  }

  return payload;
}

function updateSidebarResizerA11y() {
  if (!(sidebarResizer instanceof HTMLElement)) {
    return;
  }

  const disabled = isMobileViewport() || sidebarCollapsed;
  sidebarResizer.setAttribute("aria-disabled", disabled ? "true" : "false");
  sidebarResizer.setAttribute("aria-valuemin", String(MIN_SIDEBAR_WIDTH));
  sidebarResizer.setAttribute("aria-valuemax", String(MAX_SIDEBAR_WIDTH));
  sidebarResizer.setAttribute("aria-valuenow", String(Math.round(sidebarWidth)));
  sidebarResizer.tabIndex = disabled ? -1 : 0;
}

function renderBestAccountCard(bestAccount) {
  if (!bestAccount) {
    updateMetricText("#metric-best-account", "None");
    updateMetricText("#metric-best-score", "Score 0%");
    return;
  }
  updateMetricText("#metric-best-account", maskDisplayName(bestAccount.displayName));
  updateMetricText("#metric-best-score", `Score ${formatPercent(bestAccount.routingScore)}`);
}

function applyQuotaFillWidths() {
  const fillNodes = document.querySelectorAll(".quota-fill[data-fill]");
  for (const node of fillNodes) {
    if (!(node instanceof HTMLElement)) continue;
    const fillPercent = Number(node.dataset.fill ?? "0");
    const safeFill = Math.max(Math.min(fillPercent, 100), 0);
    node.style.transform = `scaleX(${safeFill / 100})`;
  }
}

function renderAccounts(accounts) {
  if (!accountsListElement) return;

  if (accounts.length === 0) {
    accountsListElement.classList.add("is-empty");
    accountsListElement.classList.remove("single-account");
    accountsListElement.innerHTML = `
      <div class="empty-state">
        <i data-lucide="inbox"></i>
        <p>No accounts connected.</p>
        <p>Connect an account from the side panel to start routing.</p>
      </div>
    `;
    reRenderIcons();
    return;
  }

  accountsListElement.classList.remove("is-empty");
  accountsListElement.classList.toggle("single-account", accounts.length === 1);

  const cards = accounts.map((account) => {
    const fiveHour = quotaWindowPresentation(account.quota.fiveHour);
    const weekly = quotaWindowPresentation(account.quota.weekly);
    const fiveHourLow = fiveHour.ratio < 0.2;
    const fiveHourCritical = fiveHour.ratio <= 0.01;
    const weeklyLow = weekly.ratio < 0.2;
    const weeklyCritical = weekly.ratio <= 0.01;
    const accountTitle = maskDisplayName(account.displayName);
    const providerIdentity = providerIdentityForAccount(account);
    const fiveHourRecharge = formatRechargeLine(fiveHour.resetAt);
    const weeklyRecharge = formatRechargeLine(weekly.resetAt);
    const stateDot = accountStateIndicator(account, fiveHour, weekly);
    const syncError = typeof account.quotaSyncError === "string" ? account.quotaSyncError.trim() : "";
    const showSyncError =
      account.quotaSyncStatus !== "live" &&
      syncError.length > 0;
    const estimateNote = usageEstimateNote(account);
    const errorLine = showSyncError ? `<div class="account-error-msg">${escapeHtml(syncError)}</div>` : "";
    const estimateLine =
      estimateNote && estimateNote.trim().length > 0
        ? `<div class="account-note-msg">${escapeHtml(estimateNote)}</div>`
        : "";

    return `
      <article class="account-card">
        <header class="account-top-row">
          <div class="account-actions">
            <span class="account-state-dot ${stateDot.className}" aria-label="${escapeHtml(stateDot.label)}" title="${escapeHtml(stateDot.label)}"></span>
            <h3 class="account-title" title="${escapeHtml(accountTitle)}">${escapeHtml(accountTitle)}</h3>
          </div>
          <div class="account-actions">
            <button
              class="btn btn-icon account-remove-btn"
              data-remove-account="${escapeHtml(account.id)}"
              type="button"
              aria-label="Remove ${escapeHtml(accountTitle)}"
              title="Remove ${escapeHtml(accountTitle)}"
            >
              <i data-lucide="x"></i>
            </button>
          </div>
        </header>

        <div class="account-quotas-clean">
          <div class="quota-clean-block">
            <div class="quota-clean-head">
              <span class="quota-mini-label">5h</span>
              <span class="quota-mini-value">${escapeHtml(fiveHour.value)}</span>
            </div>
            <div class="quota-track" title="5h reset ${escapeHtml(fiveHour.resetLabel)}">
              <div class="quota-fill ${fiveHourCritical ? "critical" : fiveHourLow ? "warn" : ""}" data-fill="${Math.max(Math.min(Math.round(fiveHour.ratio * 100), 100), 0)}"></div>
            </div>
            <p class="quota-recharge-line" title="5h reset ${escapeHtml(fiveHour.resetLabel)}">${escapeHtml(fiveHourRecharge)}</p>
          </div>

          <div class="quota-clean-block">
            <div class="quota-clean-head">
              <span class="quota-mini-label">Week</span>
              <span class="quota-mini-value">${escapeHtml(weekly.value)}</span>
            </div>
            <div class="quota-track" title="Weekly reset ${escapeHtml(weekly.resetLabel)}">
              <div class="quota-fill ${weeklyCritical ? "critical" : weeklyLow ? "warn" : ""}" data-fill="${Math.max(Math.min(Math.round(weekly.ratio * 100), 100), 0)}"></div>
            </div>
            <p class="quota-recharge-line" title="Weekly reset ${escapeHtml(weekly.resetLabel)}">${escapeHtml(weeklyRecharge)}</p>
          </div>
        </div>

        <div class="account-provider-row">
          <div class="account-provider-left">
            <span class="account-provider-logo-shell ${escapeHtml(providerIdentity.logoClass)}" aria-hidden="true">
              <img
                class="account-provider-logo ${escapeHtml(providerIdentity.logoClass)}"
                src="${escapeHtml(providerIdentity.logoSrc)}"
                alt="${escapeHtml(providerIdentity.logoAlt)}"
                loading="lazy"
                decoding="async"
              />
            </span>
            <span class="account-provider-id" title="${escapeHtml(providerIdentity.providerId)}">${escapeHtml(providerIdentity.providerId)}</span>
          </div>
          <button
            class="btn btn-icon account-settings-btn"
            data-open-account-settings="${escapeHtml(account.id)}"
            type="button"
            aria-label="Open settings for ${escapeHtml(accountTitle)}"
            title="Open settings"
          >
            <i data-lucide="settings-2"></i>
          </button>
        </div>

        ${errorLine}
        ${estimateLine}
      </article>
    `;
  }).join("");

  accountsListElement.innerHTML = cards;
  applyQuotaFillWidths();
  reRenderIcons();
}

function renderConnectorKey(keyValue) {
  if (!(connectorKeyElement instanceof HTMLElement)) {
    return;
  }

  const displayValue = formatConnectorKeyDisplay(keyValue);
  connectorKeyElement.textContent = displayValue;
  connectorKeyElement.classList.toggle("masked", !shouldRevealConnectorKey());
}

function renderDashboard(data) {
  dashboard = data;
  dashboardLoaded = true;
  statusError = false;
  dashboardAuthorized = Boolean(data.dashboardAuthorized);
  if (!dashboardAuthorized) {
    forceRevealApiKey = null;
  }

  setConnectorControlsEnabled(dashboardAuthorized);

  const fiveHourPercent = aggregateRemainingPercent(data.accounts, "fiveHour");
  const weeklyPercent = aggregateRemainingPercent(data.accounts, "weekly");
  const fiveHourUsedPercent = data.accounts.length > 0 ? 100 - fiveHourPercent : 0;
  const weeklyUsedPercent = data.accounts.length > 0 ? 100 - weeklyPercent : 0;

  updateMetricText("#metric-five-hour", formatPercentValue(fiveHourPercent));
  updateMetricText(
    "#metric-five-hour-detail",
    `${formatPercentValue(fiveHourUsedPercent)} used / 100% capacity`,
  );
  updateMetricText("#metric-weekly", formatPercentValue(weeklyPercent));
  updateMetricText(
    "#metric-weekly-detail",
    `${formatPercentValue(weeklyUsedPercent)} used / 100% capacity`,
  );

  updateMetricText("#metric-account-count", formatNumber(data.accounts.length));

  renderBestAccountCard(data.bestAccount);
  renderAccounts(data.accounts);

  if (connectorKeyElement) {
    renderConnectorKey(data.connector.apiKey || "");
  }

  applySettingsState();
  refreshTopbarStatus();
}

async function loadDashboard() {
  try {
    const payload = await request("/api/dashboard");
    renderDashboard(payload);
  } catch (error) {
    statusError = true;
    refreshTopbarStatus();
    throw error;
  }
}

function findConnectProvider(providerId) {
  if (typeof providerId !== "string") {
    return null;
  }

  return connectProviders.find((provider) => provider.id === providerId) ?? null;
}

function findConnectOAuthOption(provider, optionId) {
  if (!provider || typeof optionId !== "string") {
    return null;
  }

  if (!Array.isArray(provider.oauthOptions)) {
    return null;
  }

  return provider.oauthOptions.find((option) => option.id === optionId) ?? null;
}

function renderConnectProviderCards() {
  if (!(connectProviderListElement instanceof HTMLElement)) {
    return;
  }

  if (connectProviders.length === 0) {
    connectProviderListElement.innerHTML = `
      <div class="connect-provider-empty">
        <i data-lucide="plug-zap"></i>
        <p>Provider list unavailable.</p>
      </div>
    `;
    reRenderIcons();
    return;
  }

  const cards = connectProviders
    .map((provider) => {
      const oauthOptions = Array.isArray(provider.oauthOptions) ? provider.oauthOptions : [];
      const warnings = Array.isArray(provider.warnings)
        ? provider.warnings.filter((warning) => typeof warning === "string" && warning.trim().length > 0)
        : [];
      const oauthButtons = oauthOptions
        .map((option) => {
          const disabled = option.configured !== true;
          return `<button class="btn btn-outline" type="button" data-connect-oauth-provider="${escapeHtml(provider.id)}" data-connect-oauth-option="${escapeHtml(option.id)}" ${disabled ? "disabled" : ""}>${escapeHtml(option.label)}</button>`;
        })
        .join("");
      const oauthConfigurationHints = oauthOptions
        .map((option) =>
          option && option.configured !== true && typeof option.configurationHint === "string"
            ? option.configurationHint.trim()
            : "",
        )
        .filter((value) => value.length > 0);
      const uniqueOAuthConfigurationHints = [...new Set(oauthConfigurationHints)];
      const apiButton = provider.supportsApiKey
        ? `<button class="btn btn-secondary" type="button" data-connect-api="${escapeHtml(provider.id)}">API Key</button>`
        : "";
      const oauthNotConfiguredMessage =
        provider.supportsOAuth && !provider.oauthConfigured
          ? uniqueOAuthConfigurationHints.length > 0
            ? uniqueOAuthConfigurationHints.join(" ")
            : "OAuth is not configured for this provider."
          : null;
      const providerIdentity = providerVisualIdentity(provider.id);
      const note =
        oauthNotConfiguredMessage
          ? `<p class="connect-provider-note">${escapeHtml(oauthNotConfiguredMessage)}</p>`
          : strictLiveQuotaEnabled && !provider.usageConfigured
            ? '<p class="connect-provider-note">Strict live quota mode: usage adapter is not configured for this provider.</p>'
            : "";
      const recommendationTag = provider.recommended
        ? '<span class="connect-provider-recommended">recomended</span>'
        : "";
      const headTags = recommendationTag
        ? `<div class="connect-provider-head-tags">${recommendationTag}</div>`
        : "";
      const warningTrigger = warnings.length > 0
        ? `
          <div class="connect-provider-warning-anchor">
            <button
              class="connect-provider-warning-trigger"
              type="button"
              aria-label="Warnings for ${escapeHtml(provider.name)}"
              data-warning-items="${warnings.map((warning) => encodeURIComponent(warning)).join("|")}"
              title="Provider warnings"
            >
              <i data-lucide="triangle-alert"></i>
            </button>
          </div>
        `
        : "";

      return `
        <article class="connect-provider-card">
          <header class="connect-provider-head">
            <div class="connect-provider-title">
              <span class="connect-provider-logo-shell ${escapeHtml(providerIdentity.logoClass)}" aria-hidden="true">
                <img
                  class="connect-provider-logo ${escapeHtml(providerIdentity.logoClass)}"
                  src="${escapeHtml(providerIdentity.logoSrc)}"
                  alt="${escapeHtml(providerIdentity.logoAlt)}"
                  loading="lazy"
                  decoding="async"
                />
              </span>
              <h4>${escapeHtml(provider.name)}</h4>
              ${warningTrigger}
            </div>
            ${headTags}
          </header>
          <div class="connect-provider-actions">
            ${oauthButtons}
            ${apiButton}
          </div>
          ${note}
        </article>
      `;
    })
    .join("");

  connectProviderListElement.innerHTML = cards;
  reRenderIcons();
  bindConnectWarningTriggers();
}

function hideApiLinkForm() {
  selectedApiProviderId = null;
  apiLinkManualLimitsEnabled = false;
  hideConnectWarningTooltip();

  if (connectProviderListElement instanceof HTMLElement) {
    connectProviderListElement.hidden = false;
  }

  if (apiLinkForm instanceof HTMLFormElement) {
    apiLinkForm.hidden = true;
    apiLinkForm.reset();
  }
}

function setApiLinkManualLimitsAvailability(enabled) {
  apiLinkManualLimitsEnabled = enabled;

  if (apiLinkManualFiveHourLabel instanceof HTMLElement) {
    apiLinkManualFiveHourLabel.hidden = !enabled;
  }

  if (apiLinkManualWeeklyLabel instanceof HTMLElement) {
    apiLinkManualWeeklyLabel.hidden = !enabled;
  }

  if (apiLinkManualFiveHourInput instanceof HTMLInputElement) {
    apiLinkManualFiveHourInput.hidden = !enabled;
    apiLinkManualFiveHourInput.disabled = !enabled;
    if (!enabled) {
      apiLinkManualFiveHourInput.value = "";
    }
  }

  if (apiLinkManualWeeklyInput instanceof HTMLInputElement) {
    apiLinkManualWeeklyInput.hidden = !enabled;
    apiLinkManualWeeklyInput.disabled = !enabled;
    if (!enabled) {
      apiLinkManualWeeklyInput.value = "";
    }
  }

  if (apiLinkManualNoteElement instanceof HTMLElement) {
    apiLinkManualNoteElement.textContent = enabled
      ? "Manual limits are available only as a last resort when live usage sync is unavailable."
      : "Live usage is configured for this provider. Manual limits are disabled.";
  }
}

function isConnectModalOpen() {
  return connectModalElement instanceof HTMLElement && connectModalElement.hidden === false;
}

function getConnectModalFocusableElements() {
  if (!isConnectModalOpen()) {
    return [];
  }

  const selector =
    "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
  const allFocusable = connectModalElement.querySelectorAll(selector);

  return [...allFocusable].filter((element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    if (element.hidden) {
      return false;
    }

    if (element.getAttribute("aria-hidden") === "true") {
      return false;
    }

    return true;
  });
}

function focusConnectModalPrimaryElement() {
  if (connectModalCloseButton instanceof HTMLButtonElement && !connectModalCloseButton.disabled) {
    connectModalCloseButton.focus();
    return;
  }

  const [first] = getConnectModalFocusableElements();
  if (first instanceof HTMLElement) {
    first.focus();
  }
}

function showApiLinkForm(provider) {
  selectedApiProviderId = provider.id;
  const manualFallbackEnabled = provider.usageConfigured !== true;

  if (connectProviderListElement instanceof HTMLElement) {
    connectProviderListElement.hidden = true;
  }

  if (apiLinkTitleElement instanceof HTMLElement) {
    apiLinkTitleElement.textContent = "Link API key";
  }

  if (apiLinkProviderElement instanceof HTMLElement) {
    apiLinkProviderElement.textContent = provider.name;
  }

  if (apiLinkDisplayNameInput instanceof HTMLInputElement) {
    apiLinkDisplayNameInput.value = provider.name;
  }

  if (apiLinkProviderAccountIdInput instanceof HTMLInputElement) {
    apiLinkProviderAccountIdInput.value = "";
  }

  if (apiLinkKeyInput instanceof HTMLInputElement) {
    apiLinkKeyInput.value = "";
  }

  if (apiLinkManualFiveHourInput instanceof HTMLInputElement) {
    apiLinkManualFiveHourInput.value = "";
  }

  if (apiLinkManualWeeklyInput instanceof HTMLInputElement) {
    apiLinkManualWeeklyInput.value = "";
  }

  setApiLinkManualLimitsAvailability(manualFallbackEnabled);

  if (apiLinkForm instanceof HTMLFormElement) {
    apiLinkForm.hidden = false;
  }

  if (apiLinkKeyInput instanceof HTMLInputElement) {
    apiLinkKeyInput.focus();
  }
}

function openConnectModal() {
  if (!(connectModalElement instanceof HTMLElement)) {
    return;
  }

  connectModalPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  hideApiLinkForm();
  renderConnectProviderCards();
  connectModalElement.hidden = false;
  focusConnectModalPrimaryElement();
}

function closeConnectModal() {
  if (!(connectModalElement instanceof HTMLElement)) {
    return;
  }

  hideConnectWarningTooltip();
  hideApiLinkForm();
  connectModalElement.hidden = true;

  if (connectModalPreviousFocus instanceof HTMLElement) {
    connectModalPreviousFocus.focus();
  }
  connectModalPreviousFocus = null;
}

function isAccountSettingsModalOpen() {
  return accountSettingsModalElement instanceof HTMLElement && accountSettingsModalElement.hidden === false;
}

function findDashboardAccount(accountId) {
  if (!dashboard || !Array.isArray(dashboard.accounts) || typeof accountId !== "string") {
    return null;
  }

  return dashboard.accounts.find((account) => account.id === accountId) ?? null;
}

function syncStatusLabel(account) {
  const status = typeof account?.quotaSyncStatus === "string" ? account.quotaSyncStatus : "unknown";
  const syncError = typeof account?.quotaSyncError === "string" ? account.quotaSyncError.trim() : "";
  if (syncError.length > 0) {
    return `${status} - ${syncError}`;
  }

  return status;
}

function openAccountSettingsModal(accountId) {
  if (!(accountSettingsModalElement instanceof HTMLElement)) {
    return;
  }

  const account = findDashboardAccount(accountId);
  if (!account) {
    showToast("Account settings are unavailable.", true);
    return;
  }

  selectedAccountSettingsId = account.id;
  accountSettingsPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  if (accountSettingsProviderElement instanceof HTMLElement) {
    accountSettingsProviderElement.textContent = `Provider: ${account.provider}`;
  }

  if (accountSettingsAuthElement instanceof HTMLElement) {
    accountSettingsAuthElement.textContent = account.authMethod === "api" ? "API key" : "OAuth";
  }

  if (accountSettingsProviderAccountElement instanceof HTMLElement) {
    accountSettingsProviderAccountElement.textContent = account.providerAccountId;
  }

  if (accountSettingsOAuthProfileWrapperElement instanceof HTMLElement) {
    accountSettingsOAuthProfileWrapperElement.hidden = !account.oauthProfileId;
  }

  if (accountSettingsOAuthProfileElement instanceof HTMLElement) {
    accountSettingsOAuthProfileElement.textContent = account.oauthProfileId ?? "N/A";
  }

  if (accountSettingsSyncStatusElement instanceof HTMLElement) {
    accountSettingsSyncStatusElement.textContent = syncStatusLabel(account);
  }

  if (accountSettingsDisplayNameInput instanceof HTMLInputElement) {
    accountSettingsDisplayNameInput.value = account.displayName;
  }

  const canSetManualFallbackLimits =
    (account.authMethod ?? "oauth") === "api" && account.quotaSyncStatus !== "live";
  if (accountSettingsApiLimitsElement instanceof HTMLElement) {
    accountSettingsApiLimitsElement.hidden = !canSetManualFallbackLimits;
  }

  if (accountSettingsFiveHourInput instanceof HTMLInputElement) {
    const currentLimit = Number(account.quota?.fiveHour?.limit ?? Number.NaN);
    accountSettingsFiveHourInput.value =
      canSetManualFallbackLimits && Number.isFinite(currentLimit) && currentLimit > 0
        ? String(Math.round(currentLimit))
        : "";
  }

  if (accountSettingsWeeklyInput instanceof HTMLInputElement) {
    const currentLimit = Number(account.quota?.weekly?.limit ?? Number.NaN);
    accountSettingsWeeklyInput.value =
      canSetManualFallbackLimits && Number.isFinite(currentLimit) && currentLimit > 0
        ? String(Math.round(currentLimit))
        : "";
  }

  accountSettingsModalElement.hidden = false;
  if (accountSettingsDisplayNameInput instanceof HTMLInputElement) {
    accountSettingsDisplayNameInput.focus();
    accountSettingsDisplayNameInput.select();
  }

  reRenderIcons();
}

function closeAccountSettingsModal() {
  if (!(accountSettingsModalElement instanceof HTMLElement)) {
    return;
  }

  accountSettingsModalElement.hidden = true;
  selectedAccountSettingsId = null;
  if (accountSettingsForm instanceof HTMLFormElement) {
    accountSettingsForm.reset();
  }

  if (accountSettingsPreviousFocus instanceof HTMLElement) {
    accountSettingsPreviousFocus.focus();
  }
  accountSettingsPreviousFocus = null;
}

function renderConnectProviders(payload) {
  const providers = Array.isArray(payload?.providers) ? payload.providers : [];
  strictLiveQuotaEnabled = payload?.strictLiveQuota === true;

  connectProviders = providers
    .map((provider) => {
      if (!provider || typeof provider !== "object") {
        return null;
      }

      const id = typeof provider.id === "string" ? provider.id : "";
      const name = typeof provider.name === "string" ? provider.name : id;
      const supportsOAuth = provider.supportsOAuth === true;
      const oauthConfigured = provider.oauthConfigured === true;
      const oauthStartPath =
        typeof provider.oauthStartPath === "string" ? provider.oauthStartPath : null;
      const oauthOptions = Array.isArray(provider.oauthOptions)
        ? provider.oauthOptions
            .map((option) => {
              if (!option || typeof option !== "object") {
                return null;
              }

              const optionId = typeof option.id === "string" ? option.id : "";
              const optionLabel = typeof option.label === "string" ? option.label : optionId;
              const optionConfigured = option.configured === true;
              const optionStartPath =
                typeof option.startPath === "string" ? option.startPath : oauthStartPath;

              if (!optionId || !optionLabel || !optionStartPath) {
                return null;
              }

              return {
                id: optionId,
                label: optionLabel,
                configured: optionConfigured,
                startPath: optionStartPath,
                requiredClientIdEnv:
                  typeof option.requiredClientIdEnv === "string"
                    ? option.requiredClientIdEnv.trim()
                    : null,
                configurationHint:
                  typeof option.configurationHint === "string"
                    ? option.configurationHint.trim()
                    : null,
              };
            })
            .filter((option) => option !== null)
        : [];
      const supportsApiKey = provider.supportsApiKey === true;
      const usageConfigured = provider.usageConfigured === true;
      const recommended = provider.recommended === true;
      const warnings = Array.isArray(provider.warnings)
        ? provider.warnings
            .filter((warning) => typeof warning === "string")
            .map((warning) => warning.trim())
            .filter((warning) => warning.length > 0)
        : [];

      if (!id || !name) {
        return null;
      }

      return {
        id,
        name,
        supportsOAuth,
        oauthConfigured,
        oauthStartPath,
        oauthOptions,
        supportsApiKey,
        usageConfigured,
        recommended,
        warnings,
      };
    })
    .filter((provider) => provider !== null);

  providerConfigured =
    connectProviders.length > 0 &&
    connectProviders.some(
      (provider) => provider.supportsApiKey || (provider.supportsOAuth && provider.oauthConfigured),
    );
  statusError = false;

  if (connectTriggerButton instanceof HTMLButtonElement) {
    connectTriggerButton.disabled = connectProviders.length === 0;
    connectTriggerButton.setAttribute("aria-disabled", connectProviders.length === 0 ? "true" : "false");
  }

  renderConnectProviderCards();
  refreshTopbarStatus();
}

async function loadConnectProviders() {
  try {
    const metadata = await request("/api/auth/providers");
    renderConnectProviders(metadata);
  } catch (error) {
    statusError = true;
    refreshTopbarStatus();
    throw error;
  }
}

async function rotateConnectorKey() {
  await request("/api/connector/key/rotate", { method: "POST" });
  showToast("API key rotated.");
  await loadDashboard();
}

async function copyConnectorKey() {
  if (!dashboard?.connector?.apiKey) {
    showToast("API key not available.", true);
    return;
  }
  await navigator.clipboard.writeText(dashboard.connector.apiKey);
  showToast("Copied to clipboard.");
}

function sanitizeRoutePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  if (!maskRoutePayload) {
    return payload;
  }

  return sanitizePayloadNode(payload);
}

function renderRoutePayload(payload) {
  if (!(routeResultElement instanceof HTMLElement)) {
    return;
  }

  const safePayload = sanitizeRoutePayload(payload);
  routeResultElement.textContent = JSON.stringify(safePayload, null, 2);
}

async function routeTest(units) {
  if (!dashboard?.connector?.apiKey) {
    showToast("API key missing.", true);
    return;
  }

  if (routeResultElement) {
    routeResultElement.textContent = "Routing...\n";
  }

  try {
    const payload = await request("/api/connector/route", {
      method: "POST",
      headers: { Authorization: `Bearer ${dashboard.connector.apiKey}` },
      body: { units },
    });

    lastRoutePayload = payload;

    renderRoutePayload(payload);

    const routedName = maskDisplayName(payload.routedTo.displayName);

    if (payload.quotaConsumed === false) {
      showToast(`Routed via ${routedName}. Dashboard will auto-refresh.`);
    } else {
      showToast(`Routed ${units} unit(s) via ${routedName}.`);
    }
    await loadDashboard();
  } catch (error) {
    if (routeResultElement) {
      routeResultElement.textContent += `\nError: ${error.message}`;
    }
    throw error;
  }
}

async function removeAccount(accountId) {
  await request(`/api/accounts/${accountId}/remove`, { method: "POST" });
  showToast("Account removed.");
  await loadDashboard();
}

function checkConnectionToast() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("connected") === "1") {
    showToast("Account connected successfully.");
    params.delete("connected");
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  }
}

function handleSidebarResizeStart(event) {
  if (!(event instanceof PointerEvent)) {
    return;
  }

  if (isMobileViewport() || sidebarCollapsed || !(sidebarResizer instanceof HTMLElement)) {
    return;
  }

  event.preventDefault();
  resizingPointerId = event.pointerId;
  resizingStartX = event.clientX;
  resizingStartWidth = sidebarWidth;
  sidebarResizer.setPointerCapture(event.pointerId);
  document.body.classList.add("resizing-sidebar");
}

function handleSidebarResizeMove(event) {
  if (!(event instanceof PointerEvent)) {
    return;
  }

  if (resizingPointerId === null || event.pointerId !== resizingPointerId) {
    return;
  }

  const delta = event.clientX - resizingStartX;
  sidebarWidth = clampSidebarWidth(resizingStartWidth + delta);
  applySidebarState();
}

function handleSidebarResizeEnd(event) {
  if (!(event instanceof PointerEvent)) {
    return;
  }

  if (resizingPointerId === null || event.pointerId !== resizingPointerId) {
    return;
  }

  if (sidebarResizer instanceof HTMLElement) {
    sidebarResizer.releasePointerCapture(event.pointerId);
  }

  resizingPointerId = null;
  document.body.classList.remove("resizing-sidebar");
  persistUiSettings();
}

function handleSidebarResizeKeydown(event) {
  if (!(event instanceof KeyboardEvent)) {
    return;
  }

  if (isMobileViewport() || sidebarCollapsed) {
    return;
  }

  let nextWidth = sidebarWidth;
  if (event.key === "ArrowLeft") {
    nextWidth -= 12;
  } else if (event.key === "ArrowRight") {
    nextWidth += 12;
  } else if (event.key === "Home") {
    nextWidth = MIN_SIDEBAR_WIDTH;
  } else if (event.key === "End") {
    nextWidth = MAX_SIDEBAR_WIDTH;
  } else {
    return;
  }

  event.preventDefault();
  sidebarWidth = clampSidebarWidth(nextWidth);
  applySidebarState();
  persistUiSettings();
}

document.addEventListener("click", async (event) => {
  const target = event.target;
  const targetElement = target instanceof HTMLElement ? target : target.parentElement;
  
  if (!targetElement) return;

  if (targetElement.closest("#show-overview")) {
    setActiveView("overview");
    return;
  }

  if (targetElement.closest("#open-settings")) {
    setActiveView("settings");
    return;
  }

  if (targetElement.closest("#connect-trigger")) {
    openConnectModal();
    return;
  }

  if (targetElement.closest("#connect-modal-close") || targetElement.closest("[data-close-connect-modal]")) {
    closeConnectModal();
    return;
  }

  const oauthProviderButton = targetElement.closest("[data-connect-oauth-provider][data-connect-oauth-option]");
  if (oauthProviderButton instanceof HTMLElement) {
    const providerId = oauthProviderButton.dataset.connectOauthProvider;
    const oauthOptionId = oauthProviderButton.dataset.connectOauthOption;
    const provider = findConnectProvider(providerId);
    const oauthOption = findConnectOAuthOption(provider, oauthOptionId);
    if (!provider || !oauthOption || oauthOption.configured !== true) {
      showToast("OAuth is not available for this provider.", true);
      return;
    }

    window.location.assign(oauthOption.startPath);
    return;
  }

  const apiProviderButton = targetElement.closest("[data-connect-api]");
  if (apiProviderButton instanceof HTMLElement) {
    const providerId = apiProviderButton.dataset.connectApi;
    const provider = findConnectProvider(providerId);
    if (!provider || !provider.supportsApiKey) {
      showToast("API key link is not available for this provider.", true);
      return;
    }

    showApiLinkForm(provider);
    return;
  }

  if (targetElement.closest("#api-link-cancel")) {
    hideApiLinkForm();
    return;
  }

  if (targetElement.closest("#toggle-sidebar")) {
    if (isMobileViewport()) {
      showToast("Side panel collapse is desktop only.");
      return;
    }

    sidebarCollapsed = !sidebarCollapsed;
    persistUiSettings();
    applySidebarState();
    return;
  }

  if (targetElement.closest("#toggle-key-visibility")) {
    forceRevealApiKey = !shouldRevealConnectorKey();
    if (dashboard) {
      renderDashboard(dashboard);
    } else {
      applySettingsState();
    }
    return;
  }

  if (targetElement.closest("#reset-layout")) {
    sidebarWidth = 288;
    sidebarCollapsed = false;
    persistUiSettings();
    applySidebarState();
    showToast("Panel state reset.");
    return;
  }

  if (targetElement.closest("#reset-preferences")) {
    showSensitiveData = false;
    revealApiKeyByDefault = false;
    maskRoutePayload = true;
    compactCards = true;
    defaultSidebarCollapsed = false;
    autoRefreshEnabled = false;
    confirmRemoval = true;
    rememberPageTab = true;
    forceRevealApiKey = null;
    sidebarCollapsed = false;
    sidebarWidth = 288;
    persistUiSettings();
    applySidebarState();
    applySettingsState();
    if (dashboard) {
      renderDashboard(dashboard);
    }
    showToast("Preferences reset.");
    return;
  }

  const accountSettingsButton = targetElement.closest("[data-open-account-settings]");
  if (accountSettingsButton instanceof HTMLElement) {
    const accountId = accountSettingsButton.dataset.openAccountSettings;
    if (!accountId) {
      showToast("Account settings are unavailable.", true);
      return;
    }

    openAccountSettingsModal(accountId);
    return;
  }

  if (targetElement.closest("#account-settings-close") || targetElement.closest("#account-settings-cancel") || targetElement.closest("[data-close-account-settings-modal]")) {
    closeAccountSettingsModal();
    return;
  }

  const removeButton = targetElement.closest("[data-remove-account]");
  if (removeButton instanceof HTMLElement) {
    const accountId = removeButton.dataset.removeAccount;
    if (!accountId) return;

    if (confirmRemoval) {
      const confirmed = window.confirm("Remove this connected account?");
      if (!confirmed) {
        return;
      }
    }

    try {
      await removeAccount(accountId);
    } catch (error) {
      showToast(error.message || "Failed to remove account.", true);
    }
    return;
  }

  if (targetElement.closest("#rotate-key")) {
    try {
      await rotateConnectorKey();
    } catch (error) {
      showToast(error.message || "Failed to rotate key.", true);
    }
    return;
  }

  if (targetElement.closest("#copy-key")) {
    try {
      await copyConnectorKey();
    } catch (error) {
      showToast(error.message || "Failed to copy key.", true);
    }
    return;
  }

  if (targetElement.closest("#refresh-dashboard")) {
    try {
      await loadDashboard();
      showToast("Dashboard refreshed.");
    } catch (error) {
      showToast(error.message || "Refresh failed.", true);
    }
    return;
  }
});

if (routeForm instanceof HTMLFormElement) {
  routeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(routeForm);
    const units = Number(data.get("units"));
    try {
      await routeTest(units);
    } catch (error) {
      showToast(error.message || "Route test failed.", true);
    }
  });
}

if (apiLinkForm instanceof HTMLFormElement) {
  apiLinkForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!selectedApiProviderId) {
      showToast("Select a provider first.", true);
      return;
    }

    const provider = findConnectProvider(selectedApiProviderId);
    if (!provider) {
      showToast("Selected provider is unavailable.", true);
      return;
    }

    const data = new FormData(apiLinkForm);
    const displayName = String(data.get("displayName") ?? "");
    const providerAccountId = String(data.get("providerAccountId") ?? "");
    const apiKey = String(data.get("apiKey") ?? "");
    let manualFiveHourLimit;
    let manualWeeklyLimit;

    if (apiLinkManualLimitsEnabled) {
      const manualFiveHourLimitValue = Number(data.get("manualFiveHourLimit") ?? "");
      const manualWeeklyLimitValue = Number(data.get("manualWeeklyLimit") ?? "");

      manualFiveHourLimit =
        Number.isFinite(manualFiveHourLimitValue) && manualFiveHourLimitValue > 0
          ? Math.round(manualFiveHourLimitValue)
          : undefined;
      manualWeeklyLimit =
        Number.isFinite(manualWeeklyLimitValue) && manualWeeklyLimitValue > 0
          ? Math.round(manualWeeklyLimitValue)
          : undefined;
    }

    try {
      await request("/api/accounts/link-api", {
        method: "POST",
        body: {
          provider: selectedApiProviderId,
          displayName,
          providerAccountId,
          apiKey,
          manualFiveHourLimit,
          manualWeeklyLimit,
        },
      });

      showToast(`${provider.name} linked via API key.`);
      closeConnectModal();
      await loadDashboard();
    } catch (error) {
      showToast(error.message || "Failed to link API key.", true);
    }
  });
}

if (accountSettingsForm instanceof HTMLFormElement) {
  accountSettingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!selectedAccountSettingsId) {
      showToast("No account selected.", true);
      return;
    }

    const account = findDashboardAccount(selectedAccountSettingsId);
    if (!account) {
      showToast("Account settings are unavailable.", true);
      return;
    }

    const displayName =
      accountSettingsDisplayNameInput instanceof HTMLInputElement
        ? accountSettingsDisplayNameInput.value.trim()
        : "";
    if (!displayName) {
      showToast("Display name is required.", true);
      return;
    }

    const payload = {
      displayName,
    };

    if ((account.authMethod ?? "oauth") === "api") {
      const fiveHourValue =
        accountSettingsFiveHourInput instanceof HTMLInputElement
          ? Number(accountSettingsFiveHourInput.value)
          : Number.NaN;
      const weeklyValue =
        accountSettingsWeeklyInput instanceof HTMLInputElement
          ? Number(accountSettingsWeeklyInput.value)
          : Number.NaN;

      if (Number.isFinite(fiveHourValue) && fiveHourValue > 0) {
        payload.manualFiveHourLimit = Math.round(fiveHourValue);
      }

      if (Number.isFinite(weeklyValue) && weeklyValue > 0) {
        payload.manualWeeklyLimit = Math.round(weeklyValue);
      }
    }

    try {
      await request(`/api/accounts/${encodeURIComponent(selectedAccountSettingsId)}/settings`, {
        method: "POST",
        body: payload,
      });

      showToast("Account settings saved.");
      closeAccountSettingsModal();
      await loadDashboard();
    } catch (error) {
      showToast(error.message || "Failed to save account settings.", true);
    }
  });
}

if (showSensitiveInput instanceof HTMLInputElement) {
  showSensitiveInput.addEventListener("change", () => {
    showSensitiveData = showSensitiveInput.checked;
    persistUiSettings();
    if (dashboard) {
      renderDashboard(dashboard);
    } else {
      applySettingsState();
    }
  });
}

if (revealKeyInput instanceof HTMLInputElement) {
  revealKeyInput.addEventListener("change", () => {
    revealApiKeyByDefault = revealKeyInput.checked;
    forceRevealApiKey = null;
    persistUiSettings();
    if (dashboard) {
      renderDashboard(dashboard);
    } else {
      applySettingsState();
    }
  });
}

if (maskRoutePayloadInput instanceof HTMLInputElement) {
  maskRoutePayloadInput.addEventListener("change", () => {
    maskRoutePayload = maskRoutePayloadInput.checked;
    persistUiSettings();
    if (lastRoutePayload) {
      renderRoutePayload(lastRoutePayload);
    }
  });
}

if (compactCardsInput instanceof HTMLInputElement) {
  compactCardsInput.addEventListener("change", () => {
    compactCards = compactCardsInput.checked;
    persistUiSettings();
    applySettingsState();
    if (dashboard) {
      renderAccounts(dashboard.accounts);
    }
  });
}

if (defaultCollapsedInput instanceof HTMLInputElement) {
  defaultCollapsedInput.addEventListener("change", () => {
    defaultSidebarCollapsed = defaultCollapsedInput.checked;
    if (!isMobileViewport()) {
      sidebarCollapsed = defaultSidebarCollapsed;
      applySidebarState();
    }
    persistUiSettings();
  });
}

if (autoRefreshInput instanceof HTMLInputElement) {
  autoRefreshInput.addEventListener("change", () => {
    autoRefreshEnabled = autoRefreshInput.checked;
    persistUiSettings();
    startAutoRefreshTimer();
  });
}

if (confirmRemovalInput instanceof HTMLInputElement) {
  confirmRemovalInput.addEventListener("change", () => {
    confirmRemoval = confirmRemovalInput.checked;
    persistUiSettings();
  });
}

if (rememberPageTabInput instanceof HTMLInputElement) {
  rememberPageTabInput.addEventListener("change", () => {
    rememberPageTab = rememberPageTabInput.checked;
    persistUiSettings();
  });
}

if (sidebarResizer instanceof HTMLElement) {
  sidebarResizer.addEventListener("pointerdown", handleSidebarResizeStart);
  sidebarResizer.addEventListener("keydown", handleSidebarResizeKeydown);
  window.addEventListener("pointermove", handleSidebarResizeMove);
  window.addEventListener("pointerup", handleSidebarResizeEnd);
  window.addEventListener("pointercancel", handleSidebarResizeEnd);
}

const sideTabs = [showOverviewButton, openSettingsButton].filter(
  (tab) => tab instanceof HTMLButtonElement,
);

for (const tab of sideTabs) {
  tab.addEventListener("keydown", (event) => {
    const key = event.key;
    if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End", "Enter", " "].includes(key)) {
      return;
    }

    event.preventDefault();

    if (key === "Enter" || key === " ") {
      tab.click();
      return;
    }

    if (key === "Home") {
      sideTabs[0]?.focus();
      return;
    }

    if (key === "End") {
      sideTabs[sideTabs.length - 1]?.focus();
      return;
    }

    const currentIndex = sideTabs.indexOf(tab);
    if (currentIndex < 0) {
      return;
    }

    const forward = key === "ArrowDown" || key === "ArrowRight";
    const direction = forward ? 1 : -1;
    const nextIndex = (currentIndex + direction + sideTabs.length) % sideTabs.length;
    sideTabs[nextIndex]?.focus();
  });
}

window.addEventListener("keydown", (event) => {
  if (isConnectModalOpen() && event.key === "Tab") {
    const focusableElements = getConnectModalFocusableElements();
    if (focusableElements.length === 0) {
      event.preventDefault();
      return;
    }

    const activeElement = document.activeElement;
    const currentIndex = focusableElements.indexOf(activeElement);
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey) {
      if (currentIndex <= 0) {
        event.preventDefault();
        if (lastElement instanceof HTMLElement) {
          lastElement.focus();
        }
      }
      return;
    }

    if (currentIndex === -1 || currentIndex === focusableElements.length - 1) {
      event.preventDefault();
      if (firstElement instanceof HTMLElement) {
        firstElement.focus();
      }
    }
    return;
  }

  if (event.key !== "Escape") {
    return;
  }

  if (isAccountSettingsModalOpen()) {
    closeAccountSettingsModal();
    return;
  }

  if (isConnectModalOpen()) {
    if (apiLinkForm instanceof HTMLFormElement && apiLinkForm.hidden === false) {
      hideApiLinkForm();
      return;
    }

    closeConnectModal();
    return;
  }

  if (currentView === "settings") {
    setActiveView("overview");
  }
});

window.addEventListener("resize", () => {
  applySidebarState();

  if (activeWarningTrigger instanceof HTMLElement && connectWarningTooltipElement instanceof HTMLElement && !connectWarningTooltipElement.hidden) {
    positionConnectWarningTooltip(activeWarningTrigger, connectWarningTooltipElement);
  }
});

window.addEventListener(
  "scroll",
  () => {
    if (activeWarningTrigger instanceof HTMLElement && connectWarningTooltipElement instanceof HTMLElement && !connectWarningTooltipElement.hidden) {
      positionConnectWarningTooltip(activeWarningTrigger, connectWarningTooltipElement);
    }
  },
  true,
);

window.addEventListener("load", async () => {
  loadUiSettings();
  startTopbarClock();
  refreshTopbarStatus();
  applySidebarState();
  applySettingsState();
  setActiveView(currentView);
  setConnectorControlsEnabled(false);
  checkConnectionToast();
  try {
    await Promise.all([loadConnectProviders(), loadDashboard()]);
  } catch (error) {
    showToast(error.message || "Failed to load.", true);
  }
});
