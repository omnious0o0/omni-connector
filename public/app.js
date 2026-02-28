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
const sidebarModelsContentElement = document.querySelector("#sidebar-models-content");
const routingPriorityResultElement = document.querySelector("#routing-priority-result");
const routingPriorityForm = document.querySelector("#routing-priority-form");
const routingPreferredProviderInput = document.querySelector("#routing-preferred-provider");
const routingPriorityModelsInput = document.querySelector("#routing-priority-models");
const routingFallbackProvidersElement = document.querySelector("#routing-fallback-providers");
const routingPriorityResetButton = document.querySelector("#routing-priority-reset");
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
const accountSettingsSyncGuidanceElement = document.querySelector("#account-settings-sync-guidance");
const accountSettingsSyncGuidanceTitleElement = document.querySelector("#account-settings-sync-guidance-title");
const accountSettingsSyncGuidanceStepsElement = document.querySelector("#account-settings-sync-guidance-steps");
const accountSettingsSyncGuidanceActionElement = document.querySelector("#account-settings-sync-guidance-action");
const accountSettingsDisplayNameInput = document.querySelector("#account-settings-display-name");
const accountSettingsApiLimitsElement = document.querySelector("#account-settings-api-limits");
const accountSettingsFiveHourInput = document.querySelector("#account-settings-5h");
const accountSettingsWeeklyInput = document.querySelector("#account-settings-7d");
const accountSettingsFiveHourLabel = document.querySelector('label[for="account-settings-5h"]');
const accountSettingsWeeklyLabel = document.querySelector('label[for="account-settings-7d"]');
const accountSettingsCancelButton = document.querySelector("#account-settings-cancel");
const metricWindowALabelElement = document.querySelector("#metric-window-a-label");
const metricWindowBLabelElement = document.querySelector("#metric-window-b-label");

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
let lastRoutingPreferencesPayload = null;
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
let connectedProviderModelsPayload = {
  providers: [],
};
let connectedProviderModelsError = null;

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
const KNOWN_PROVIDER_IDS = ["codex", "gemini", "claude", "openrouter"];

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

  if (routingPreferredProviderInput instanceof HTMLSelectElement) {
    routingPreferredProviderInput.disabled = !enabled;
    routingPreferredProviderInput.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  if (routingPriorityModelsInput instanceof HTMLTextAreaElement) {
    routingPriorityModelsInput.disabled = !enabled;
    routingPriorityModelsInput.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  if (routingPriorityResetButton instanceof HTMLButtonElement) {
    routingPriorityResetButton.disabled = !enabled;
    routingPriorityResetButton.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  if (routingPriorityForm instanceof HTMLFormElement) {
    routingPriorityForm.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  if (routingFallbackProvidersElement instanceof HTMLElement) {
    const fallbackInputs = routingFallbackProvidersElement.querySelectorAll('input[type="checkbox"]');
    for (const input of fallbackInputs) {
      if (!(input instanceof HTMLInputElement)) {
        continue;
      }

      input.disabled = !enabled;
      input.setAttribute("aria-disabled", enabled ? "false" : "true");
    }
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
    return "Unavailable";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "Unavailable";
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
  if (!resetIso) return "Unknown";
  const date = new Date(resetIso);
  if (Number.isNaN(date.getTime())) return "Unknown";
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
  const relative = formatResetRelativeTime(resetIso);
  if (relative === "time unavailable") {
    return "Reset time unavailable";
  }

  if (relative === "now") {
    return "Resets now";
  }

  return `Resets ${relative}`;
}

function parseIsoMs(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return Number.NaN;
  }

  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : Number.NaN;
}

function roundToNearest(value, step) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value;
  }

  return Math.round(value / step) * step;
}

function compactDurationLabel(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }

  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  const weekMs = 7 * dayMs;

  if (durationMs < hourMs) {
    const minutes = Math.max(1, roundToNearest(durationMs / minuteMs, 5));
    return `${minutes}m`;
  }

  if (durationMs < 2 * dayMs) {
    const hours = Math.max(1, roundToNearest(durationMs / hourMs, 1));
    return `${hours}h`;
  }

  if (durationMs < 5 * weekMs) {
    const days = Math.max(1, roundToNearest(durationMs / dayMs, 1));
    return `${days}d`;
  }

  const weeks = Math.max(1, roundToNearest(durationMs / weekMs, 1));
  return `${weeks}w`;
}

function cadenceLabelFromMinutes(windowMinutes) {
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) {
    return "";
  }

  const roundedMinutes = Math.max(1, Math.round(windowMinutes));
  const dayMinutes = 24 * 60;
  if (roundedMinutes % dayMinutes === 0) {
    const days = Math.round(roundedMinutes / dayMinutes);
    return `${days}d`;
  }

  if (roundedMinutes % 60 === 0) {
    const hours = Math.round(roundedMinutes / 60);
    return `${hours}h`;
  }

  return `${roundedMinutes}m`;
}

function normalizeQuotaLabel(labelValue) {
  if (typeof labelValue !== "string") {
    return "";
  }

  const trimmed = labelValue.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const compact = trimmed.replace(/[_\s-]+/g, "").toLowerCase();
  if (compact === "requests" || compact === "tokens" || compact === "calls") {
    return "";
  }

  return trimmed;
}

function isSyntheticWindowStart(windowData, quotaSyncedAt) {
  const windowStartedAtMs = parseIsoMs(windowData?.windowStartedAt);
  const syncedAtMs = parseIsoMs(quotaSyncedAt);
  if (Number.isNaN(windowStartedAtMs) || Number.isNaN(syncedAtMs)) {
    return false;
  }

  return Math.abs(windowStartedAtMs - syncedAtMs) <= 10 * 60 * 1000;
}

function inferredScheduleDurationMs(windowData, quotaSyncedAt) {
  if (isSyntheticWindowStart(windowData, quotaSyncedAt)) {
    return null;
  }

  const startedAtMs = parseIsoMs(windowData?.windowStartedAt);
  const resetAtMs = parseIsoMs(windowData?.resetsAt);

  if (!Number.isNaN(startedAtMs) && !Number.isNaN(resetAtMs) && resetAtMs > startedAtMs) {
    return resetAtMs - startedAtMs;
  }

  return null;
}

function quotaWindowScheduleLabel(windowData, fallbackLabel, quotaSyncedAt) {
  const rawWindowMinutes = Number(windowData?.windowMinutes);
  if (Number.isFinite(rawWindowMinutes) && rawWindowMinutes > 0) {
    const cadenceFromMinutes = cadenceLabelFromMinutes(rawWindowMinutes);
    if (cadenceFromMinutes.length > 0) {
      return cadenceFromMinutes;
    }
  }

  const scheduleDurationMs = inferredScheduleDurationMs(windowData, quotaSyncedAt);
  if (Number.isFinite(scheduleDurationMs) && scheduleDurationMs > 0) {
    const durationLabel = cadenceLabelFromMinutes(Math.round(scheduleDurationMs / 60_000));
    if (durationLabel.length > 0) {
      return durationLabel;
    }
  }

  if (typeof fallbackLabel === "string" && fallbackLabel.trim().length > 0) {
    return fallbackLabel.trim();
  }

  return "";
}

function buildQuotaWindowView(windowData, fallbackLabel, quotaSyncedAt) {
  const presentation = quotaWindowPresentation(windowData);
  const rawWindowMinutes = Number(windowData?.windowMinutes);
  const windowMinutes = Number.isFinite(rawWindowMinutes) && rawWindowMinutes > 0 ? Math.round(rawWindowMinutes) : null;
  const inferredDurationMs = inferredScheduleDurationMs(windowData, quotaSyncedAt);
  const scheduleDurationMs =
    windowMinutes !== null ? windowMinutes * 60_000 : Number.isFinite(inferredDurationMs) ? inferredDurationMs : null;
  const explicitLabel = normalizeQuotaLabel(windowData?.label);
  const limit = Number(windowData?.limit);
  const used = Number(windowData?.used);
  const remaining = Number(windowData?.remaining);
  const safeLimit = Number.isFinite(limit) ? limit : 0;
  const safeUsed = Number.isFinite(used) ? used : 0;
  const safeRemaining = Number.isFinite(remaining) ? remaining : Math.max(safeLimit - safeUsed, 0);

  return {
    ...presentation,
    label: explicitLabel || quotaWindowScheduleLabel(windowData, fallbackLabel, quotaSyncedAt),
    windowMinutes,
    scheduleDurationMs,
    limit: safeLimit,
    used: safeUsed,
    remaining: safeRemaining,
  };
}

function quotaWindowSignature(windowView) {
  const minutesKey = Number.isFinite(windowView.windowMinutes) ? Math.round(windowView.windowMinutes) : "na";
  const scheduleKey =
    Number.isFinite(windowView.scheduleDurationMs) && windowView.scheduleDurationMs !== null
      ? Math.round(windowView.scheduleDurationMs / 60_000)
      : "na";
  const resetKey = typeof windowView.resetAt === "string" ? windowView.resetAt : "na";
  const labelKey = typeof windowView.label === "string" ? windowView.label : "na";
  const ratioKey = Math.round(windowView.ratio * 1000);
  const limitKey = Math.round(windowView.limit * 1000);
  const usedKey = Math.round(windowView.used * 1000);
  return `${minutesKey}|${scheduleKey}|${labelKey}|${resetKey}|${ratioKey}|${limitKey}|${usedKey}`;
}

function normalizedAccountQuotaWindows(account) {
  const quotaSyncedAt = typeof account?.quotaSyncedAt === "string" ? account.quotaSyncedAt : null;
  const candidates = [
    buildQuotaWindowView(account?.quota?.fiveHour, null, quotaSyncedAt),
    buildQuotaWindowView(account?.quota?.weekly, null, quotaSyncedAt),
  ];

  const seen = new Set();
  const deduped = [];
  for (const windowView of candidates) {
    const signature = quotaWindowSignature(windowView);
    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    deduped.push(windowView);
  }

  return deduped.sort((left, right) => {
    const leftDuration =
      Number.isFinite(left.windowMinutes) && left.windowMinutes !== null
        ? left.windowMinutes
        : (left.scheduleDurationMs ?? Number.MAX_SAFE_INTEGER) / 60_000;
    const rightDuration =
      Number.isFinite(right.windowMinutes) && right.windowMinutes !== null
        ? right.windowMinutes
        : (right.scheduleDurationMs ?? Number.MAX_SAFE_INTEGER) / 60_000;
    return leftDuration - rightDuration;
  });
}

function accountStateIndicator(account, quotaWindows) {
  if (account.quotaSyncStatus !== "live") {
    return { className: "is-red", label: "Offline" };
  }

  if (!Array.isArray(quotaWindows) || quotaWindows.length === 0) {
    return { className: "is-green", label: "Online" };
  }

  const exhaustedWindows = quotaWindows.filter((windowView) => windowView.ratio <= 0);
  if (exhaustedWindows.length === 0) {
    return { className: "is-green", label: "Online" };
  }

  const orderedByDuration = [...quotaWindows].sort((left, right) => {
    const leftDuration =
      Number.isFinite(left.windowMinutes) && left.windowMinutes !== null
        ? left.windowMinutes
        : (left.scheduleDurationMs ?? Number.MAX_SAFE_INTEGER) / 60_000;
    const rightDuration =
      Number.isFinite(right.windowMinutes) && right.windowMinutes !== null
        ? right.windowMinutes
        : (right.scheduleDurationMs ?? Number.MAX_SAFE_INTEGER) / 60_000;
    return leftDuration - rightDuration;
  });

  const longestWindow = orderedByDuration[orderedByDuration.length - 1] ?? exhaustedWindows[0];
  if (longestWindow.ratio <= 0) {
    return { className: "is-red", label: `${longestWindow.label} exhausted` };
  }

  const rechargingWindow = orderedByDuration.find((windowView) => windowView.ratio <= 0) ?? exhaustedWindows[0];
  return { className: "is-orange", label: `Recharging ${rechargingWindow.label}` };
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

function normalizedAccountAuthMethod(authMethodValue) {
  if (typeof authMethodValue !== "string") {
    return "oauth";
  }

  return authMethodValue.trim().toLowerCase() === "api" ? "api" : "oauth";
}

function normalizedOAuthProfileId(oauthProfileIdValue) {
  if (typeof oauthProfileIdValue !== "string") {
    return null;
  }

  const trimmed = oauthProfileIdValue.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveConnectionLabel(context) {
  const authMethod = normalizedAccountAuthMethod(context?.authMethod);
  if (authMethod === "api") {
    return "API key";
  }

  const providerId = typeof context?.provider === "string" ? context.provider.trim().toLowerCase() : "";
  const oauthProfileId = normalizedOAuthProfileId(context?.oauthProfileId);

  if (providerId === "codex" && oauthProfileId === "oauth") {
    return "codex";
  }

  if (oauthProfileId) {
    return oauthProfileId;
  }

  return "oauth";
}

function connectionLabelForAccount(account) {
  return resolveConnectionLabel(account);
}

function quotaWindowPresentation(windowData) {
  const limit = Number(windowData?.limit);
  if (!Number.isFinite(limit) || limit <= 0) {
    const resetAtFallback =
      typeof windowData?.resetsAt === "string" && windowData.resetsAt.trim().length > 0 ? windowData.resetsAt : null;
    const remainingRatioFallback = clampRatio(Number(windowData?.remainingRatio));
    const hasPercentFallback = Number.isFinite(remainingRatioFallback) && remainingRatioFallback >= 0;
    if (hasPercentFallback) {
      const remainingPercent = remainingRatioFallback * 100;
      const usedPercent = 100 - remainingPercent;
      return {
        value: `${formatPercentValue(remainingPercent)}`,
        detail: `${formatPercentValue(usedPercent)} used / 100% capacity`,
        ratio: remainingRatioFallback,
        resetLabel: formatResetTime(resetAtFallback),
        resetAt: resetAtFallback,
      };
    }

    return {
      value: "0%",
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

  const samples = Number(account?.estimatedUsageSampleCount ?? 0);

  if (samples <= 0) {
    return null;
  }

  if (samples === 1) {
    return "Usage estimate is based on routed traffic and becomes more stable as more requests are routed.";
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

function mostFrequentLabel(labelCounts, fallbackLabel) {
  let winner = fallbackLabel;
  let winnerCount = -1;
  for (const [label, count] of labelCounts.entries()) {
    if (count > winnerCount) {
      winner = label;
      winnerCount = count;
    }
  }

  return winner;
}

function buildDashboardWindowMetrics(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return [];
  }

  const buckets = new Map();
  for (const account of accounts) {
    const windows = normalizedAccountQuotaWindows(account);
    for (const windowView of windows) {
      const scheduleDurationMs =
        Number.isFinite(windowView.scheduleDurationMs) && windowView.scheduleDurationMs !== null
          ? Math.round(windowView.scheduleDurationMs)
          : null;
      const windowMinutes =
        Number.isFinite(windowView.windowMinutes) && windowView.windowMinutes !== null
          ? Math.round(windowView.windowMinutes)
          : null;
      const scheduleKey = `${windowMinutes ?? "na"}|${scheduleDurationMs ?? "na"}|${windowView.label}`;

      let bucket = buckets.get(scheduleKey);
      if (!bucket) {
        bucket = {
          windowMinutes,
          scheduleDurationMs,
          labelCounts: new Map(),
          totalLimit: 0,
          totalRemaining: 0,
          ratioSum: 0,
          ratioCount: 0,
        };
        buckets.set(scheduleKey, bucket);
      }

      bucket.labelCounts.set(windowView.label, (bucket.labelCounts.get(windowView.label) ?? 0) + 1);
      const limit = Number(windowView.limit);
      const remaining = Number(windowView.remaining);
      const ratio = clampRatio(Number(windowView.ratio));
      if (Number.isFinite(limit) && limit > 0 && Number.isFinite(remaining)) {
        bucket.totalLimit += limit;
        bucket.totalRemaining += Math.max(Math.min(remaining, limit), 0);
      }

      bucket.ratioSum += ratio;
      bucket.ratioCount += 1;
    }
  }

  return [...buckets.values()]
    .map((bucket) => {
      const remainingPercent =
        bucket.totalLimit > 0
          ? Math.max(Math.min((bucket.totalRemaining / bucket.totalLimit) * 100, 100), 0)
          : bucket.ratioCount > 0
            ? Math.max(Math.min((bucket.ratioSum / bucket.ratioCount) * 100, 100), 0)
            : 0;

      return {
        label: mostFrequentLabel(bucket.labelCounts, ""),
        windowMinutes: bucket.windowMinutes,
        scheduleDurationMs: bucket.scheduleDurationMs,
        remainingPercent,
        usedPercent: 100 - remainingPercent,
      };
    })
    .sort((left, right) => {
      const leftDuration =
        Number.isFinite(left.windowMinutes) && left.windowMinutes !== null
          ? left.windowMinutes
          : (left.scheduleDurationMs ?? Number.MAX_SAFE_INTEGER) / 60_000;
      const rightDuration =
        Number.isFinite(right.windowMinutes) && right.windowMinutes !== null
          ? right.windowMinutes
          : (right.scheduleDurationMs ?? Number.MAX_SAFE_INTEGER) / 60_000;
      return leftDuration - rightDuration;
    });
}

function updateMetricWindowLabels(primaryMetric, secondaryMetric) {
  const primaryLabel = typeof primaryMetric?.label === "string" ? primaryMetric.label.trim() : "";
  const secondaryLabel = typeof secondaryMetric?.label === "string" ? secondaryMetric.label.trim() : "";
  if (metricWindowALabelElement instanceof HTMLElement) {
    metricWindowALabelElement.textContent = primaryLabel.length > 0 ? `${primaryLabel} Quota` : "";
  }

  if (metricWindowBLabelElement instanceof HTMLElement) {
    metricWindowBLabelElement.textContent = secondaryLabel.length > 0 ? `${secondaryLabel} Quota` : "";
  }
}

function renderDashboardQuotaMetrics(accounts) {
  const metrics = buildDashboardWindowMetrics(accounts);
  const primaryMetric = metrics[0] ?? null;
  const secondaryMetric = metrics[1] ?? null;

  updateMetricWindowLabels(primaryMetric, secondaryMetric);

  if (primaryMetric) {
    updateMetricText("#metric-five-hour", formatPercentValue(primaryMetric.remainingPercent));
    updateMetricText(
      "#metric-five-hour-detail",
      `${formatPercentValue(primaryMetric.usedPercent)} used / 100% capacity`,
    );
  } else {
    updateMetricText("#metric-five-hour", "");
    updateMetricText("#metric-five-hour-detail", "");
  }

  if (secondaryMetric) {
    updateMetricText("#metric-weekly", formatPercentValue(secondaryMetric.remainingPercent));
    updateMetricText(
      "#metric-weekly-detail",
      `${formatPercentValue(secondaryMetric.usedPercent)} used / 100% capacity`,
    );
  } else {
    updateMetricText("#metric-weekly", "");
    updateMetricText("#metric-weekly-detail", "");
  }
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

function renderQuotaWindowBlock(windowView) {
  const isLow = windowView.ratio < 0.2;
  const isCritical = windowView.ratio <= 0.01;
  const rechargeLabel = formatRechargeLine(windowView.resetAt);
  const fillPercent = Math.max(Math.min(Math.round(windowView.ratio * 100), 100), 0);
  return `
    <div class="quota-clean-block">
      <div class="quota-clean-head">
        <span class="quota-mini-label">${escapeHtml(windowView.label)}</span>
        <span class="quota-mini-value">${escapeHtml(windowView.value)}</span>
      </div>
      <div class="quota-track" title="${escapeHtml(windowView.label)} reset ${escapeHtml(windowView.resetLabel)}">
        <div class="quota-fill ${isCritical ? "critical" : isLow ? "warn" : ""}" data-fill="${fillPercent}"></div>
      </div>
      <p class="quota-recharge-line" title="${escapeHtml(windowView.label)} reset ${escapeHtml(windowView.resetLabel)}">${escapeHtml(rechargeLabel)}</p>
    </div>
  `;
}

function normalizeQuotaSyncIssue(rawIssue) {
  if (!rawIssue || typeof rawIssue !== "object" || Array.isArray(rawIssue)) {
    return null;
  }

  if (rawIssue.kind !== "account_verification_required") {
    return null;
  }

  const title = typeof rawIssue.title === "string" ? rawIssue.title.trim() : "";
  const actionLabel = typeof rawIssue.actionLabel === "string" ? rawIssue.actionLabel.trim() : "";
  const actionUrl = typeof rawIssue.actionUrl === "string" ? rawIssue.actionUrl.trim() : "";
  const steps = Array.isArray(rawIssue.steps)
    ? rawIssue.steps
        .filter((step) => typeof step === "string")
        .map((step) => step.trim())
        .filter((step) => step.length > 0)
    : [];

  if (!title || !actionLabel || !actionUrl || steps.length === 0) {
    return null;
  }

  return {
    kind: "account_verification_required",
    title,
    steps,
    actionLabel,
    actionUrl,
  };
}

function verificationStartPath(accountId) {
  if (typeof accountId !== "string") {
    return null;
  }

  const normalized = accountId.trim();
  if (normalized.length === 0) {
    return null;
  }

  return `/verification/start?accountId=${encodeURIComponent(normalized)}`;
}

function renderQuotaSyncIssueMarkup(syncIssue, accountId) {
  if (!syncIssue) {
    return "";
  }

  const startPath = verificationStartPath(accountId);
  if (!startPath) {
    return "";
  }

  const stepsMarkup = syncIssue.steps
    .slice(0, 3)
    .map((step) => `<li>${escapeHtml(step)}</li>`)
    .join("");

  return `
    <div class="account-sync-guidance">
      <p class="account-sync-guidance-title">${escapeHtml(syncIssue.title)}</p>
      <ul class="account-sync-guidance-steps">${stepsMarkup}</ul>
      <a class="btn btn-outline account-verify-action" href="${escapeHtml(startPath)}">${escapeHtml(syncIssue.actionLabel)}</a>
    </div>
  `;
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

  const cards = accounts
    .map((account) => {
      const quotaWindows = normalizedAccountQuotaWindows(account);
      const accountTitle = maskDisplayName(account.displayName);
      const providerIdentity = providerIdentityForAccount(account);
      const connectionLabel = connectionLabelForAccount(account);
      const stateDot = accountStateIndicator(account, quotaWindows);
      const syncError = typeof account.quotaSyncError === "string" ? account.quotaSyncError.trim() : "";
      const syncIssue = normalizeQuotaSyncIssue(account.quotaSyncIssue);
      const showSyncError = account.quotaSyncStatus !== "live" && syncError.length > 0;
      const estimateNote = usageEstimateNote(account);
      const guidanceMarkup = showSyncError ? renderQuotaSyncIssueMarkup(syncIssue, account.id) : "";
      const errorLine = showSyncError
        ? `<div class="account-error-msg"><p class="account-error-text">${escapeHtml(syncError)}</p>${guidanceMarkup}</div>`
        : "";
      const estimateLine =
        estimateNote && estimateNote.trim().length > 0
          ? `<div class="account-note-msg">${escapeHtml(estimateNote)}</div>`
          : "";
      const quotaBlocks = quotaWindows.map((windowView) => renderQuotaWindowBlock(windowView)).join("");
      const quotaGridClass = quotaWindows.length === 1 ? "account-quotas-clean single-window" : "account-quotas-clean";

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

        <div class="${quotaGridClass}">
          ${quotaBlocks}
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
            <span class="account-provider-id" title="${escapeHtml(connectionLabel)}">${escapeHtml(connectionLabel)}</span>
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
    })
    .join("");

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

function normalizeConnectedProviderModelsPayload(payload) {
  const providersRaw = Array.isArray(payload?.providers) ? payload.providers : [];
  const providers = providersRaw
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const provider = normalizeProviderId(entry.provider);
      if (!provider) {
        return null;
      }

      const modelIds = Array.isArray(entry.modelIds)
        ? entry.modelIds
            .filter((modelId) => typeof modelId === "string")
            .map((modelId) => modelId.trim())
            .filter((modelId) => modelId.length > 0)
        : [];

      const uniqueModelIds = [...new Set(modelIds)].sort((left, right) => left.localeCompare(right));
      const accountCount = Number(entry.accountCount);
      const status = entry.status === "live" ? "live" : "unavailable";
      const syncError =
        typeof entry.syncError === "string" && entry.syncError.trim().length > 0
          ? entry.syncError.trim()
          : null;

      return {
        provider,
        accountCount: Number.isFinite(accountCount) && accountCount > 0 ? Math.round(accountCount) : 0,
        status,
        modelIds: uniqueModelIds,
        syncError,
      };
    })
    .filter((entry) => entry !== null)
    .sort((left, right) => KNOWN_PROVIDER_IDS.indexOf(left.provider) - KNOWN_PROVIDER_IDS.indexOf(right.provider));

  return {
    providers,
  };
}

function renderSidebarModels(payload) {
  if (!(sidebarModelsContentElement instanceof HTMLElement)) {
    return;
  }

  const normalized = normalizeConnectedProviderModelsPayload(payload);
  if (normalized.providers.length === 0) {
    const message =
      typeof connectedProviderModelsError === "string" && connectedProviderModelsError.trim().length > 0
        ? `Unable to load model IDs (${escapeHtml(connectedProviderModelsError.trim())}).`
        : "No connected provider models yet.";
    sidebarModelsContentElement.innerHTML = `<p class="sidebar-models-empty">${message}</p>`;
    return;
  }

  const markup = normalized.providers
    .map((entry) => {
      const providerName = providerNameById(entry.provider);
      const statusText = entry.status === "live" ? "live" : "unavailable";
      const countLabel = entry.accountCount === 1 ? "1 account" : `${entry.accountCount} accounts`;
      const modelList =
        entry.modelIds.length > 0
          ? `<ul class="sidebar-model-list">${entry.modelIds
              .map((modelId) => `<li class="sidebar-model-id">${escapeHtml(modelId)}</li>`)
              .join("")}</ul>`
          : '<p class="sidebar-models-empty">No model IDs returned.</p>';
      const errorLine =
        entry.syncError && entry.syncError.length > 0
          ? `<p class="sidebar-model-provider-error">${escapeHtml(entry.syncError)}</p>`
          : "";

      return `
        <section class="sidebar-model-provider" data-provider="${escapeHtml(entry.provider)}">
          <div class="sidebar-model-provider-head">
            <h3>${escapeHtml(providerName)} (${escapeHtml(countLabel)})</h3>
            <span class="sidebar-model-provider-status">${escapeHtml(statusText)}</span>
          </div>
          ${modelList}
          ${errorLine}
        </section>
      `;
    })
    .join("");

  sidebarModelsContentElement.innerHTML = markup;
}

async function loadConnectedProviderModels() {
  try {
    const payload = await request("/api/models/connected");
    connectedProviderModelsPayload = normalizeConnectedProviderModelsPayload(payload);
    connectedProviderModelsError = null;
  } catch (error) {
    connectedProviderModelsPayload = {
      providers: [],
    };
    connectedProviderModelsError = error instanceof Error ? error.message : "request failed";
  }

  renderSidebarModels(connectedProviderModelsPayload);
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

  renderDashboardQuotaMetrics(data.accounts);

  updateMetricText("#metric-account-count", formatNumber(data.accounts.length));

  renderBestAccountCard(data.bestAccount);
  renderAccounts(data.accounts);

  if (connectorKeyElement) {
    renderConnectorKey(data.connector.apiKey || "");
  }

  const routingPreferences = routingPreferencesFromDashboard();
  renderRoutingPreferencesForm(routingPreferences);
  if (!lastRoutingPreferencesPayload) {
    renderRoutingPreferencesResult({ routingPreferences });
  }

  renderSidebarModels(connectedProviderModelsPayload);
  applySettingsState();
  refreshTopbarStatus();
}

async function loadDashboard() {
  try {
    const modelsPromise = loadConnectedProviderModels();
    const payload = await request("/api/dashboard");
    renderDashboard(payload);
    await modelsPromise;
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
    apiLinkDisplayNameInput.value = resolveConnectionLabel({
      provider: provider.id,
      authMethod: "api",
    });
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

function renderAccountSettingsSyncGuidance(account) {
  if (!(accountSettingsSyncGuidanceElement instanceof HTMLElement)) {
    return;
  }

  const syncIssue = normalizeQuotaSyncIssue(account?.quotaSyncIssue);
  const startPath = verificationStartPath(account?.id);
  if (!syncIssue || !startPath) {
    accountSettingsSyncGuidanceElement.hidden = true;
    if (accountSettingsSyncGuidanceTitleElement instanceof HTMLElement) {
      accountSettingsSyncGuidanceTitleElement.textContent = "";
    }
    if (accountSettingsSyncGuidanceStepsElement instanceof HTMLElement) {
      accountSettingsSyncGuidanceStepsElement.innerHTML = "";
    }
    if (accountSettingsSyncGuidanceActionElement instanceof HTMLAnchorElement) {
      accountSettingsSyncGuidanceActionElement.href = "#";
      accountSettingsSyncGuidanceActionElement.textContent = "";
    }
    return;
  }

  accountSettingsSyncGuidanceElement.hidden = false;
  if (accountSettingsSyncGuidanceTitleElement instanceof HTMLElement) {
    accountSettingsSyncGuidanceTitleElement.textContent = syncIssue.title;
  }
  if (accountSettingsSyncGuidanceStepsElement instanceof HTMLElement) {
    accountSettingsSyncGuidanceStepsElement.innerHTML = syncIssue.steps
      .slice(0, 3)
      .map((step) => `<li>${escapeHtml(step)}</li>`)
      .join("");
  }
  if (accountSettingsSyncGuidanceActionElement instanceof HTMLAnchorElement) {
    accountSettingsSyncGuidanceActionElement.href = startPath;
    accountSettingsSyncGuidanceActionElement.textContent = syncIssue.actionLabel;
  }
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
  const connectionLabel = connectionLabelForAccount(account);

  if (accountSettingsProviderElement instanceof HTMLElement) {
    accountSettingsProviderElement.textContent = `Provider: ${connectionLabel}`;
  }

  if (accountSettingsAuthElement instanceof HTMLElement) {
    accountSettingsAuthElement.textContent = connectionLabel;
  }

  if (accountSettingsProviderAccountElement instanceof HTMLElement) {
    accountSettingsProviderAccountElement.textContent = account.providerAccountId;
  }

  if (accountSettingsOAuthProfileWrapperElement instanceof HTMLElement) {
    accountSettingsOAuthProfileWrapperElement.hidden = !account.oauthProfileId;
  }

  if (accountSettingsOAuthProfileElement instanceof HTMLElement) {
    accountSettingsOAuthProfileElement.textContent = account.oauthProfileId ?? "";
  }

  if (accountSettingsSyncStatusElement instanceof HTMLElement) {
    accountSettingsSyncStatusElement.textContent = syncStatusLabel(account);
  }
  renderAccountSettingsSyncGuidance(account);

  if (accountSettingsDisplayNameInput instanceof HTMLInputElement) {
    accountSettingsDisplayNameInput.value = account.displayName;
  }

  const accountWindows = normalizedAccountQuotaWindows(account);
  const accountFiveHourLabel =
    typeof accountWindows[0]?.label === "string" ? accountWindows[0].label.trim() : "";
  const accountWeeklyLabel =
    typeof accountWindows[1]?.label === "string" ? accountWindows[1].label.trim() : "";
  if (accountSettingsFiveHourLabel instanceof HTMLElement) {
    accountSettingsFiveHourLabel.textContent =
      accountFiveHourLabel.length > 0 ? `Manual ${accountFiveHourLabel} limit` : "Manual limit";
  }

  if (accountSettingsWeeklyLabel instanceof HTMLElement) {
    accountSettingsWeeklyLabel.textContent =
      accountWeeklyLabel.length > 0 ? `Manual ${accountWeeklyLabel} limit` : "Manual secondary limit";
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
  if (accountSettingsSyncGuidanceElement instanceof HTMLElement) {
    accountSettingsSyncGuidanceElement.hidden = true;
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
  renderRoutingPreferencesForm(routingPreferencesFromDashboard());
  renderSidebarModels(connectedProviderModelsPayload);
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

function defaultRoutingPreferences() {
  return {
    preferredProvider: "auto",
    fallbackProviders: [],
    priorityModels: ["auto"],
  };
}

function normalizeProviderId(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!KNOWN_PROVIDER_IDS.includes(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeRoutingPreferences(payload) {
  const defaults = defaultRoutingPreferences();
  if (!payload || typeof payload !== "object") {
    return defaults;
  }

  const preferredRaw = payload.preferredProvider;
  let preferredProvider = defaults.preferredProvider;
  if (typeof preferredRaw === "string") {
    const normalizedPreferred = preferredRaw.trim().toLowerCase();
    if (normalizedPreferred === "auto" || normalizedPreferred.length === 0) {
      preferredProvider = "auto";
    } else {
      preferredProvider = normalizeProviderId(preferredRaw) ?? defaults.preferredProvider;
    }
  }

  const fallbackProviders = [];
  const fallbackRaw = Array.isArray(payload.fallbackProviders) ? payload.fallbackProviders : [];
  for (const entry of fallbackRaw) {
    const providerId = normalizeProviderId(entry);
    if (!providerId) {
      continue;
    }

    if (preferredProvider !== "auto" && providerId === preferredProvider) {
      continue;
    }

    if (!fallbackProviders.includes(providerId)) {
      fallbackProviders.push(providerId);
    }
  }

  const priorityModels = [];
  const priorityRaw = Array.isArray(payload.priorityModels) ? payload.priorityModels : [];
  for (const entry of priorityRaw) {
    if (typeof entry !== "string") {
      continue;
    }

    const normalized = entry.trim();
    if (!normalized) {
      continue;
    }

    const clipped = normalized.slice(0, 120);
    if (!priorityModels.includes(clipped)) {
      priorityModels.push(clipped);
    }

    if (priorityModels.length >= 20) {
      break;
    }
  }

  if (priorityModels.length === 0) {
    priorityModels.push("auto");
  }

  return {
    preferredProvider,
    fallbackProviders,
    priorityModels,
  };
}

function providerNameById(providerId) {
  const fromConnectProviders = connectProviders.find((provider) => provider.id === providerId);
  if (fromConnectProviders && typeof fromConnectProviders.name === "string" && fromConnectProviders.name.trim()) {
    return fromConnectProviders.name;
  }

  return providerId;
}

function availableProviderIds() {
  const fromConnectProviders = connectProviders
    .map((provider) => normalizeProviderId(provider.id))
    .filter((providerId) => providerId !== null);
  const source = fromConnectProviders.length > 0 ? fromConnectProviders : KNOWN_PROVIDER_IDS;
  return [...new Set(source)];
}

function routingPreferencesFromDashboard() {
  return normalizeRoutingPreferences(dashboard?.connector?.routingPreferences ?? null);
}

function renderRoutingPreferencesResult(payload) {
  if (!(routingPriorityResultElement instanceof HTMLElement)) {
    return;
  }

  const safePayload = maskRoutePayload ? sanitizePayloadNode(payload) : payload;
  routingPriorityResultElement.textContent = JSON.stringify(safePayload, null, 2);
}

function renderRoutingPreferencesForm(preferences) {
  const normalized = normalizeRoutingPreferences(preferences);
  const providerIds = availableProviderIds();

  if (routingPreferredProviderInput instanceof HTMLSelectElement) {
    const options = [
      '<option value="auto">Auto (best available)</option>',
      ...providerIds.map((providerId) => {
        return `<option value="${escapeHtml(providerId)}">${escapeHtml(providerNameById(providerId))}</option>`;
      }),
    ];
    routingPreferredProviderInput.innerHTML = options.join("");
    routingPreferredProviderInput.value = normalized.preferredProvider;
  }

  if (routingPriorityModelsInput instanceof HTMLTextAreaElement) {
    routingPriorityModelsInput.value = normalized.priorityModels.join("\n");
  }

  if (routingFallbackProvidersElement instanceof HTMLElement) {
    routingFallbackProvidersElement.innerHTML = providerIds
      .map((providerId) => {
        const checkboxId = `routing-fallback-${providerId}`;
        const checked = normalized.fallbackProviders.includes(providerId) ? "checked" : "";
        const disabled = normalized.preferredProvider !== "auto" && normalized.preferredProvider === providerId;
        const providerName = providerNameById(providerId);
        const disabledClass = disabled ? " is-disabled" : "";
        return `
          <label class="settings-switch fallback-provider-switch${disabledClass}" for="${escapeHtml(checkboxId)}">
            <div class="settings-switch-copy">
              <p class="settings-switch-title">${escapeHtml(providerName)}</p>
              <p class="settings-switch-note">Use as fallback route</p>
            </div>
            <span class="switch-control">
              <input
                id="${escapeHtml(checkboxId)}"
                type="checkbox"
                value="${escapeHtml(providerId)}"
                aria-label="Enable fallback for ${escapeHtml(providerName)}"
                ${checked}
                ${disabled ? "disabled" : ""}
              />
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </span>
          </label>
        `;
      })
      .join("");
  }
}

function collectRoutingPreferencesFromForm() {
  const preferredProviderRaw =
    routingPreferredProviderInput instanceof HTMLSelectElement ? routingPreferredProviderInput.value : "auto";
  const preferredProvider =
    typeof preferredProviderRaw === "string" && preferredProviderRaw.trim().toLowerCase() === "auto"
      ? "auto"
      : normalizeProviderId(preferredProviderRaw) ?? "auto";

  const fallbackProviders = [];
  if (routingFallbackProvidersElement instanceof HTMLElement) {
    const checkedInputs = routingFallbackProvidersElement.querySelectorAll('input[type="checkbox"]:checked');
    for (const input of checkedInputs) {
      if (!(input instanceof HTMLInputElement)) {
        continue;
      }

      const providerId = normalizeProviderId(input.value);
      if (!providerId) {
        continue;
      }

      if (preferredProvider !== "auto" && providerId === preferredProvider) {
        continue;
      }

      if (!fallbackProviders.includes(providerId)) {
        fallbackProviders.push(providerId);
      }
    }
  }

  const rawModels =
    routingPriorityModelsInput instanceof HTMLTextAreaElement ? routingPriorityModelsInput.value : "";
  const priorityModels = rawModels
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 20)
    .map((entry) => entry.slice(0, 120));

  const normalizedModels = [...new Set(priorityModels)];
  if (normalizedModels.length === 0) {
    normalizedModels.push("auto");
  }

  return {
    preferredProvider,
    fallbackProviders,
    priorityModels: normalizedModels,
  };
}

async function saveRoutingPreferences(preferences) {
  const payload = await request("/api/connector/routing", {
    method: "POST",
    body: preferences,
  });

  const updated = normalizeRoutingPreferences(payload?.routingPreferences ?? preferences);
  lastRoutingPreferencesPayload = {
    routingPreferences: updated,
  };
  renderRoutingPreferencesResult(lastRoutingPreferencesPayload);
  return updated;
}

async function removeAccount(accountId) {
  await request(`/api/accounts/${accountId}/remove`, { method: "POST" });
  showToast("Account removed.");
  await loadDashboard();
}

function checkConnectionToast() {
  const params = new URLSearchParams(window.location.search);
  let shouldRewriteUrl = false;

  if (params.get("connected") === "1") {
    showToast("Account connected successfully.");
    params.delete("connected");
    shouldRewriteUrl = true;
  }

  if (params.get("verified") === "1") {
    showToast("Verification step completed. Syncing quota now.");
    params.delete("verified");
    shouldRewriteUrl = true;
  }

  if (shouldRewriteUrl) {
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

if (routingPriorityForm instanceof HTMLFormElement) {
  routingPriorityForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const nextPreferences = collectRoutingPreferencesFromForm();
      const saved = await saveRoutingPreferences(nextPreferences);
      renderRoutingPreferencesForm(saved);
      setConnectorControlsEnabled(dashboardAuthorized);
      showToast("Routing priority saved.");
      await loadDashboard();
    } catch (error) {
      showToast(error.message || "Failed to save routing priority.", true);
    }
  });
}

if (routingPreferredProviderInput instanceof HTMLSelectElement) {
  routingPreferredProviderInput.addEventListener("change", () => {
    const nextPreferences = collectRoutingPreferencesFromForm();
    renderRoutingPreferencesForm(nextPreferences);
    setConnectorControlsEnabled(dashboardAuthorized);
  });
}

if (routingPriorityResetButton instanceof HTMLButtonElement) {
  routingPriorityResetButton.addEventListener("click", async () => {
    try {
      const defaults = defaultRoutingPreferences();
      renderRoutingPreferencesForm(defaults);
      setConnectorControlsEnabled(dashboardAuthorized);
      const saved = await saveRoutingPreferences(defaults);
      renderRoutingPreferencesForm(saved);
      showToast("Routing priority reset to auto.");
      await loadDashboard();
    } catch (error) {
      showToast(error.message || "Failed to reset routing priority.", true);
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
    if (lastRoutingPreferencesPayload) {
      renderRoutingPreferencesResult(lastRoutingPreferencesPayload);
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
