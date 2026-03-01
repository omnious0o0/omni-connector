const toastElement = document.querySelector("#toast");
const toastMsgElement = document.querySelector(".toast-msg");
const toastIconElement = document.querySelector(".toast-icon");
const appLayoutElement = document.querySelector(".app-layout");
const mainContentElement = document.querySelector(".main-content");
const sidebarResizer = document.querySelector("#sidebar-resizer");
const topbarTimeElement = document.querySelector("#topbar-time");
const topbarIssuesElement = document.querySelector("#topbar-issues");
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
const sidebarModelsSearchInput = document.querySelector("#sidebar-models-search");
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
let lastRoutingPreferencesPayload = null;
let clockTimer = null;
let providerConfigured = null;
let dashboardLoaded = false;
let statusError = false;
let connectProviders = [];
let connectProvidersLoading = true;
let selectedApiProviderId = null;
let connectModalPreviousFocus = null;
let accountSettingsPreviousFocus = null;
let selectedAccountSettingsId = null;
let strictLiveQuotaEnabled = false;
let connectWarningTooltipElement = null;
let activeWarningTrigger = null;
let connectWarningTooltipHideTimer = null;
let connectedProviderModelsPayload = {
  providers: [],
};
let connectedProviderModelsError = null;
let sidebarModelsSearchQuery = "";
let quotaCadenceConsensusByScope = new Map();
let latestTopbarIssues = [];

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
const CONNECT_WARNING_TOOLTIP_ID = "connect-provider-warning-tooltip";

if (window.lucide) {
  lucide.createIcons();
}

function reRenderIcons() {
  if (window.lucide) {
    lucide.createIcons();
  }
}

function setDescribedByToken(element, token, enabled) {
  const current = (element.getAttribute("aria-describedby") ?? "").trim();
  const tokens = current.length > 0 ? current.split(/\s+/) : [];
  const next = enabled
    ? [...new Set([...tokens, token])]
    : tokens.filter((entry) => entry !== token);

  if (next.length > 0) {
    element.setAttribute("aria-describedby", next.join(" "));
    return;
  }

  element.removeAttribute("aria-describedby");
}

function applyModalIsolationTargetState(target, isolated) {
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if ("inert" in target) {
    target.inert = isolated;
  }

  if (isolated) {
    target.setAttribute("aria-hidden", "true");
    return;
  }

  target.removeAttribute("aria-hidden");
}

function updateModalIsolationState() {
  const isolateBackground = isConnectModalOpen() || isAccountSettingsModalOpen();
  applyModalIsolationTargetState(appLayoutElement, isolateBackground);
  applyModalIsolationTargetState(toastElement, isolateBackground);
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

function warningTitleFromTrigger(trigger) {
  if (!(trigger instanceof HTMLElement)) {
    return "Warnings";
  }

  const title = typeof trigger.dataset.warningTitle === "string" ? trigger.dataset.warningTitle.trim() : "";
  return title.length > 0 ? title : "Warnings";
}

function warningSeverityFromTrigger(trigger) {
  if (!(trigger instanceof HTMLElement)) {
    return "warning";
  }

  const raw = typeof trigger.dataset.warningSeverity === "string" ? trigger.dataset.warningSeverity.trim() : "";
  if (raw === "error" || raw === "info") {
    return raw;
  }

  return "warning";
}

function warningActionFromTrigger(trigger) {
  if (!(trigger instanceof HTMLElement)) {
    return null;
  }

  const action = typeof trigger.dataset.warningAction === "string" ? trigger.dataset.warningAction.trim() : "";
  return action.length > 0 ? action : null;
}

function warningActionLabelFromTrigger(trigger) {
  if (!(trigger instanceof HTMLElement)) {
    return "";
  }

  const label = typeof trigger.dataset.warningActionLabel === "string" ? trigger.dataset.warningActionLabel.trim() : "";
  return label;
}

function warningAccountIdFromTrigger(trigger) {
  if (!(trigger instanceof HTMLElement)) {
    return null;
  }

  const accountId = typeof trigger.dataset.warningAccountId === "string" ? trigger.dataset.warningAccountId.trim() : "";
  return accountId.length > 0 ? accountId : null;
}

function warningDataItems(items) {
  if (!Array.isArray(items)) {
    return "";
  }

  return items
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => encodeURIComponent(item))
    .join("|");
}

function warningActionLabel(action) {
  if (action === "open-account-settings") {
    return "Open settings";
  }

  if (action === "open-connect") {
    return "Open Connect";
  }

  if (action === "open-settings-page") {
    return "Open settings";
  }

  if (action === "refresh-dashboard") {
    return "Refresh now";
  }

  return "";
}

function ensureConnectWarningTooltipElement() {
  if (connectWarningTooltipElement instanceof HTMLElement) {
    return connectWarningTooltipElement;
  }

  const element = document.createElement("div");
  element.id = CONNECT_WARNING_TOOLTIP_ID;
  element.className = "connect-provider-warning-floating";
  element.hidden = true;
  element.setAttribute("role", "tooltip");
  element.addEventListener("mouseenter", () => {
    clearConnectWarningTooltipHideTimer();
  });
  element.addEventListener("mouseleave", (event) => {
    const nextTarget = event.relatedTarget;
    if (activeWarningTrigger instanceof HTMLElement && nextTarget instanceof Node && activeWarningTrigger.contains(nextTarget)) {
      return;
    }

    scheduleConnectWarningTooltipHide();
  });
  element.addEventListener("click", async (event) => {
    const target = event.target;
    const targetElement = target instanceof HTMLElement ? target : target.parentElement;
    if (!(targetElement instanceof HTMLElement)) {
      return;
    }

    const actionButton = targetElement.closest("[data-warning-action]");
    if (!(actionButton instanceof HTMLElement)) {
      return;
    }

    event.preventDefault();
    const action = warningActionFromTrigger(actionButton);
    const accountId = warningAccountIdFromTrigger(actionButton);
    hideConnectWarningTooltip();
    await resolveIssueAction(action, accountId);
  });
  document.body.append(element);
  connectWarningTooltipElement = element;
  return element;
}

function clearConnectWarningTooltipHideTimer() {
  if (connectWarningTooltipHideTimer !== null) {
    window.clearTimeout(connectWarningTooltipHideTimer);
    connectWarningTooltipHideTimer = null;
  }
}

function scheduleConnectWarningTooltipHide() {
  clearConnectWarningTooltipHideTimer();
  connectWarningTooltipHideTimer = window.setTimeout(() => {
    const tooltipHovered =
      connectWarningTooltipElement instanceof HTMLElement && connectWarningTooltipElement.matches(":hover");
    const triggerHovered = activeWarningTrigger instanceof HTMLElement && activeWarningTrigger.matches(":hover");
    if (tooltipHovered || triggerHovered) {
      return;
    }

    hideConnectWarningTooltip();
  }, 120);
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
  clearConnectWarningTooltipHideTimer();

  if (activeWarningTrigger instanceof HTMLElement) {
    setDescribedByToken(activeWarningTrigger, CONNECT_WARNING_TOOLTIP_ID, false);
  }

  if (!(connectWarningTooltipElement instanceof HTMLElement)) {
    activeWarningTrigger = null;
    return;
  }

  connectWarningTooltipElement.hidden = true;
  connectWarningTooltipElement.innerHTML = "";
  activeWarningTrigger = null;
}

function showConnectWarningTooltip(trigger) {
  clearConnectWarningTooltipHideTimer();

  const items = warningItemsFromTrigger(trigger);
  if (items.length === 0) {
    hideConnectWarningTooltip();
    return;
  }

  if (activeWarningTrigger instanceof HTMLElement && activeWarningTrigger !== trigger) {
    setDescribedByToken(activeWarningTrigger, CONNECT_WARNING_TOOLTIP_ID, false);
  }

  const tooltip = ensureConnectWarningTooltipElement();
  const severity = warningSeverityFromTrigger(trigger);
  const title = warningTitleFromTrigger(trigger);
  const action = warningActionFromTrigger(trigger);
  const actionLabel = warningActionLabelFromTrigger(trigger);
  const accountId = warningAccountIdFromTrigger(trigger);
  tooltip.className = `connect-provider-warning-floating is-${severity}`;
  const actionMarkup =
    action && actionLabel
      ? `<button class="btn btn-outline connect-provider-warning-action" type="button" data-warning-action="${escapeHtml(action)}" ${accountId ? `data-warning-account-id="${escapeHtml(accountId)}"` : ""}>${escapeHtml(actionLabel)}</button>`
      : "";
  tooltip.innerHTML = `
    <p class="connect-provider-warning-title">${escapeHtml(title)}</p>
    <ul>
      ${items.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}
    </ul>
    ${actionMarkup}
  `;
  tooltip.hidden = false;
  positionConnectWarningTooltip(trigger, tooltip);
  setDescribedByToken(trigger, CONNECT_WARNING_TOOLTIP_ID, true);
  activeWarningTrigger = trigger;
}

async function resolveIssueAction(action, accountId = null) {
  if (action === "open-account-settings") {
    if (typeof accountId === "string" && accountId.length > 0) {
      openAccountSettingsModal(accountId);
      return;
    }

    showToast("Connection settings are unavailable.", true);
    return;
  }

  if (action === "open-connect") {
    openConnectModal();
    return;
  }

  if (action === "open-settings-page") {
    if (isConnectModalOpen()) {
      closeConnectModal();
    }

    setActiveView("settings");
    return;
  }

  if (action === "refresh-dashboard") {
    try {
      await loadDashboard();
      showToast("Dashboard refreshed.");
    } catch (error) {
      showToast(error.message || "Refresh failed.", true);
    }
  }
}

function bindConnectWarningTriggers() {
  const triggers = document.querySelectorAll(".issue-tooltip-trigger");
  for (const trigger of triggers) {
    if (!(trigger instanceof HTMLElement)) {
      continue;
    }

    if (trigger.dataset.warningBound === "1") {
      continue;
    }

    trigger.dataset.warningBound = "1";

    trigger.addEventListener("mouseenter", () => {
      showConnectWarningTooltip(trigger);
    });

    trigger.addEventListener("mouseleave", (event) => {
      const nextTarget = event.relatedTarget;
      if (
        connectWarningTooltipElement instanceof HTMLElement &&
        nextTarget instanceof Node &&
        connectWarningTooltipElement.contains(nextTarget)
      ) {
        return;
      }

      scheduleConnectWarningTooltipHide();
    });

    trigger.addEventListener("focus", () => {
      showConnectWarningTooltip(trigger);
    });

    trigger.addEventListener("blur", (event) => {
      const nextTarget = event.relatedTarget;
      if (
        connectWarningTooltipElement instanceof HTMLElement &&
        nextTarget instanceof Node &&
        connectWarningTooltipElement.contains(nextTarget)
      ) {
        return;
      }

      scheduleConnectWarningTooltipHide();
    });

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      showConnectWarningTooltip(trigger);
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

function normalizeTopbarIssueMessage(value) {
  return typeof value === "string" ? value.trim() : "";
}

function collectTopbarIssues() {
  const dedupe = new Set();
  const issues = [];

  if (statusError) {
    issues.push({
      type: "error",
      message: "Dashboard request failed. Click to retry loading.",
      action: "refresh-dashboard",
    });
  }

  if (dashboard && Array.isArray(dashboard.accounts)) {
    for (const account of dashboard.accounts) {
      const syncError = normalizeTopbarIssueMessage(account?.quotaSyncError);
      if (!syncError || account?.quotaSyncStatus === "live") {
        continue;
      }

      const issueType = account?.quotaSyncStatus === "stale" ? "warning" : "error";
      issues.push({
        type: issueType,
        message: `${maskDisplayName(account?.displayName)}: ${syncError}`,
        accountId: account?.id,
      });
    }

    if (dashboardLoaded && dashboard.accounts.length === 0) {
      issues.push({
        type: "info",
        message: "No connections configured yet. Click to open Connect.",
        action: "open-connect",
      });
    }
  }

  if (Array.isArray(connectProviders) && connectProviders.length > 0) {
    for (const provider of connectProviders) {
      const providerWarnings = Array.isArray(provider?.warnings)
        ? provider.warnings
            .filter((warning) => typeof warning === "string")
            .map((warning) => warning.trim())
            .filter((warning) => warning.length > 0)
        : [];

      if (providerWarnings.length === 0) {
        continue;
      }

      const providerName =
        typeof provider?.name === "string" && provider.name.trim().length > 0 ? provider.name.trim() : provider?.id;

      for (const warning of providerWarnings.slice(0, 2)) {
        issues.push({
          type: "warning",
          message: `${providerName}: ${warning}`,
          action: "open-connect",
        });
      }
    }
  }

  const normalized = [];
  for (const issue of issues) {
    const message = normalizeTopbarIssueMessage(issue?.message);
    if (!message) {
      continue;
    }

    const type = issue?.type === "error" || issue?.type === "warning" ? issue.type : "info";
    const key = `${type}|${message}`;
    if (dedupe.has(key)) {
      continue;
    }

    dedupe.add(key);
    normalized.push({
      type,
      message,
      accountId: typeof issue?.accountId === "string" ? issue.accountId : null,
      action: typeof issue?.action === "string" ? issue.action : null,
    });
  }

  return normalized;
}

function topbarIssueSummaryLabel(type) {
  if (type === "error") {
    return "Errors";
  }

  if (type === "warning") {
    return "Warnings";
  }

  return "Notifications";
}

function topbarIssueIcon(type) {
  if (type === "error") {
    return "circle-alert";
  }

  if (type === "warning") {
    return "triangle-alert";
  }

  return "info";
}

function topbarIssueTooltipPayload(type, issues) {
  const relevant = issues.filter((issue) => issue.type === type);
  if (relevant.length === 0) {
    return null;
  }

  const primaryIssue = relevant[0] ?? null;
  const action =
    typeof primaryIssue?.accountId === "string" && primaryIssue.accountId.length > 0
      ? "open-account-settings"
      : typeof primaryIssue?.action === "string" && primaryIssue.action.length > 0
        ? primaryIssue.action
        : null;

  return {
    title: topbarIssueSummaryLabel(type),
    items: relevant.slice(0, 3).map((issue) => issue.message),
    action,
    actionLabel: warningActionLabel(action),
    accountId:
      typeof primaryIssue?.accountId === "string" && primaryIssue.accountId.length > 0
        ? primaryIssue.accountId
        : null,
  };
}

function renderTopbarIssues() {
  if (!(topbarIssuesElement instanceof HTMLElement)) {
    return;
  }

  const issues = collectTopbarIssues();
  latestTopbarIssues = issues;
  const order = ["error", "warning", "info"];
  const issueButtons = order
    .map((type) => {
      const count = issues.filter((issue) => issue.type === type).length;
      if (count === 0) {
        return "";
      }

      const label = topbarIssueSummaryLabel(type);
      const tooltip = topbarIssueTooltipPayload(type, issues);
      const warningItems = warningDataItems(tooltip?.items ?? []);
      const warningTitle = tooltip?.title ?? label;
      const warningAction = tooltip?.action ?? "";
      const warningActionLabelText = tooltip?.actionLabel ?? "";
      const warningAccountId = tooltip?.accountId ?? "";
      const actionAttrs =
        warningAction && warningActionLabelText
          ? ` data-warning-action="${escapeHtml(warningAction)}" data-warning-action-label="${escapeHtml(warningActionLabelText)}"`
          : "";
      const accountAttr = warningAccountId
        ? ` data-warning-account-id="${escapeHtml(warningAccountId)}"`
        : "";

      return `<button class="topbar-issue-btn issue-tooltip-trigger is-${escapeHtml(type)}" type="button" data-topbar-issue-type="${escapeHtml(type)}" aria-label="${escapeHtml(label)}: ${escapeHtml(String(count))}" data-warning-title="${escapeHtml(warningTitle)}" data-warning-severity="${escapeHtml(type)}" data-warning-items="${warningItems}"${actionAttrs}${accountAttr}><i data-lucide="${escapeHtml(topbarIssueIcon(type))}"></i><span class="topbar-issue-count">${escapeHtml(String(count))}</span></button>`;
    })
    .filter((markup) => markup.length > 0)
    .join("");

  topbarIssuesElement.innerHTML =
    issueButtons.length > 0
      ? issueButtons
      : '<span class="topbar-issues-empty" aria-label="No active warnings, errors, or notifications"><i data-lucide="circle-check"></i></span>';
  bindConnectWarningTriggers();
  reRenderIcons();
}

function firstTopbarIssueByType(issueType) {
  if (issueType !== "error" && issueType !== "warning" && issueType !== "info") {
    return null;
  }

  return latestTopbarIssues.find((issue) => issue.type === issueType) ?? null;
}

async function resolveTopbarIssue(issueType) {
  const issue = firstTopbarIssueByType(issueType);
  if (!issue) {
    showToast("No active issue for that category.");
    return;
  }

  if (issue.accountId) {
    openAccountSettingsModal(issue.accountId);
    showToast(issue.message, issue.type === "error");
    return;
  }

  if (issue.action === "open-connect") {
    openConnectModal();
    showToast(issue.message, issue.type === "error");
    return;
  }

  if (issue.action === "refresh-dashboard") {
    try {
      await loadDashboard();
      showToast("Dashboard refreshed.");
    } catch (error) {
      showToast(error.message || "Refresh failed.", true);
    }
    return;
  }

  showToast(issue.message, issue.type === "error");
}

function refreshTopbarStatus() {
  if (statusError || providerConfigured === false) {
    setTopbarStatus("offline");
  } else if (!dashboardLoaded || providerConfigured === null) {
    setTopbarStatus("preparing");
  } else {
    setTopbarStatus("online");
  }

  renderTopbarIssues();
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

function sanitizeOauthStartPath(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return null;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
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

const BALANCE_SYMBOL_TO_CURRENCY = Object.freeze({
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
});

function parseBalanceNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const compact = trimmed.replace(/,/g, "");
  const direct = Number(compact);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const numericMatch = compact.match(/-?\d+(?:\.\d+)?/);
  if (!numericMatch) {
    return null;
  }

  const parsed = Number(numericMatch[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isSupportedCurrencyCode(currencyCode) {
  if (typeof currencyCode !== "string") {
    return false;
  }

  const normalized = currencyCode.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    return false;
  }

  try {
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: normalized,
    }).format(0);
    return true;
  } catch {
    return false;
  }
}

function detectBalanceCurrencyCode(value) {
  if (typeof value !== "string") {
    return "USD";
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "USD";
  }

  const upper = trimmed.toUpperCase();
  const codeMatches = upper.match(/\b[A-Z]{3}\b/g) ?? [];
  for (const code of codeMatches) {
    if (isSupportedCurrencyCode(code)) {
      return code;
    }
  }

  for (const [symbol, code] of Object.entries(BALANCE_SYMBOL_TO_CURRENCY)) {
    if (trimmed.includes(symbol)) {
      return code;
    }
  }

  return "USD";
}

function formatBalanceValue(value, currencyCodeHint = null) {
  const parsed = parseBalanceNumber(value);
  const resolvedCurrencyCode =
    isSupportedCurrencyCode(currencyCodeHint) ? currencyCodeHint.toUpperCase() : detectBalanceCurrencyCode(value);

  if (parsed === null) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : "$0.00";
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: resolvedCurrencyCode,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(parsed);
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
  const startCount = 10;
  const endCount = 6;
  if (token.length <= startCount + endCount) {
    return "Bearer [redacted]";
  }

  const start = token.slice(0, startCount);
  const end = token.slice(-endCount);
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

function maskProviderAccountId(value) {
  if (typeof value !== "string") {
    return "Unavailable";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "Unavailable";
  }

  if (shouldRevealAccountDetails()) {
    return trimmed;
  }

  if (trimmed.includes("@")) {
    return maskEmailMiddle(trimmed);
  }

  return maskSensitiveValue(trimmed, 3, 2);
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

function cadenceLabelFromText(value) {
  if (typeof value !== "string") {
    return "";
  }

  const text = value.trim().toLowerCase();
  if (text.length === 0) {
    return "";
  }

  if (text.includes("daily") || text.includes("per day") || text.includes("per-day") || text.includes("per_day")) {
    return "1d";
  }

  if (text.includes("weekly") || text.includes("per week") || text.includes("per-week") || text.includes("per_week")) {
    return "7d";
  }

  if (text.includes("hourly") || text.includes("per hour") || text.includes("per-hour") || text.includes("per_hour")) {
    return "1h";
  }

  if (text.includes("an hour") || text.includes("one hour")) {
    return "1h";
  }

  if (text.includes("a day") || text.includes("one day")) {
    return "1d";
  }

  if (text.includes("a week") || text.includes("one week")) {
    return "7d";
  }

  const tokenMatch = /(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)\b/i.exec(text);
  if (!tokenMatch) {
    return "";
  }

  const valueNumber = Number(tokenMatch[1]);
  if (!Number.isFinite(valueNumber) || valueNumber <= 0) {
    return "";
  }

  const unit = (tokenMatch[2] ?? "").toLowerCase();
  if (unit.startsWith("m")) {
    return `${Math.round(valueNumber)}m`;
  }

  if (unit.startsWith("h")) {
    return `${Math.round(valueNumber)}h`;
  }

  if (unit.startsWith("d")) {
    return `${Math.round(valueNumber)}d`;
  }

  if (unit.startsWith("w")) {
    return `${Math.round(valueNumber * 7)}d`;
  }

  return "";
}

function cadenceMinutesFromLabel(cadenceLabel) {
  if (typeof cadenceLabel !== "string") {
    return null;
  }

  const token = cadenceLabel.trim().toLowerCase();
  const tokenMatch = /^(\d+)\s*(m|h|d|w)$/.exec(token);
  if (!tokenMatch) {
    return null;
  }

  const amount = Number(tokenMatch[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unit = tokenMatch[2];
  if (unit === "m") {
    return Math.max(1, Math.round(amount));
  }

  if (unit === "h") {
    return Math.max(1, Math.round(amount * 60));
  }

  if (unit === "d") {
    return Math.max(1, Math.round(amount * 24 * 60));
  }

  if (unit === "w") {
    return Math.max(1, Math.round(amount * 7 * 24 * 60));
  }

  return null;
}

function authoritativeCadenceMinutes(windowData, quotaSyncedAt) {
  const rawWindowMinutes = Number(windowData?.windowMinutes);
  if (Number.isFinite(rawWindowMinutes) && rawWindowMinutes > 0) {
    return Math.max(1, Math.round(rawWindowMinutes));
  }

  const scheduleDurationMs = inferredScheduleDurationMs(windowData, quotaSyncedAt);
  if (Number.isFinite(scheduleDurationMs) && scheduleDurationMs > 0) {
    return Math.max(1, Math.round(scheduleDurationMs / 60_000));
  }

  const explicitLabel = normalizeQuotaLabel(windowData?.label);
  const explicitCadenceLabel = cadenceLabelFromText(explicitLabel);
  return cadenceMinutesFromLabel(explicitCadenceLabel);
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

  const lower = trimmed.toLowerCase();
  if (
    /^resets?\s+in\b/.test(lower) ||
    /^resets?\s+at\b/.test(lower) ||
    /^recharges?\s+in\b/.test(lower) ||
    /^renews?\s+in\b/.test(lower) ||
    /^next\s+reset\b/.test(lower)
  ) {
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

function cadenceScopeKey(account, slot) {
  const providerId = typeof account?.provider === "string" ? account.provider.trim().toLowerCase() : "unknown";
  const authMethod = normalizedAccountAuthMethod(account?.authMethod);
  const oauthProfileKey = (normalizedOAuthProfileId(account?.oauthProfileId) ?? "none").toLowerCase();
  return `${providerId}|${authMethod}|${oauthProfileKey}|${slot}`;
}

function buildCadenceConsensusByScope(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return new Map();
  }

  const countsByScope = new Map();
  for (const account of accounts) {
    const quotaSyncedAt = typeof account?.quotaSyncedAt === "string" ? account.quotaSyncedAt : null;
    const windowsBySlot = [
      ["fiveHour", account?.quota?.fiveHour],
      ["weekly", account?.quota?.weekly],
    ];

    for (const [slot, windowData] of windowsBySlot) {
      const cadenceMinutes = authoritativeCadenceMinutes(windowData, quotaSyncedAt);
      if (!Number.isFinite(cadenceMinutes) || cadenceMinutes === null || cadenceMinutes <= 0) {
        continue;
      }

      const scopeKey = cadenceScopeKey(account, slot);
      let minuteCounts = countsByScope.get(scopeKey);
      if (!(minuteCounts instanceof Map)) {
        minuteCounts = new Map();
        countsByScope.set(scopeKey, minuteCounts);
      }

      minuteCounts.set(cadenceMinutes, (minuteCounts.get(cadenceMinutes) ?? 0) + 1);
    }
  }

  const consensusByScope = new Map();
  for (const [scopeKey, minuteCounts] of countsByScope.entries()) {
    if (!(minuteCounts instanceof Map) || minuteCounts.size !== 1) {
      continue;
    }

    const [minutes] = minuteCounts.keys();
    if (Number.isFinite(minutes) && minutes > 0) {
      consensusByScope.set(scopeKey, Math.round(minutes));
    }
  }

  return consensusByScope;
}

function consensusCadenceMinutes(account, slot) {
  if (!(quotaCadenceConsensusByScope instanceof Map)) {
    return null;
  }

  const scopeKey = cadenceScopeKey(account, slot);
  const minutes = Number(quotaCadenceConsensusByScope.get(scopeKey));
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }

  return Math.round(minutes);
}

function resolveQuotaWindowLabel(account, slot, windowView) {
  const cadenceLabel = typeof windowView?.cadenceLabel === "string" ? windowView.cadenceLabel.trim() : "";
  if (cadenceLabel.length > 0) {
    return cadenceLabel;
  }

  const consensusMinutes = consensusCadenceMinutes(account, slot);
  if (consensusMinutes !== null) {
    const consensusLabel = cadenceLabelFromMinutes(consensusMinutes);
    if (consensusLabel.length > 0) {
      return consensusLabel;
    }
  }

  const explicitLabel = typeof windowView?.explicitLabel === "string" ? windowView.explicitLabel.trim() : "";
  if (explicitLabel.length > 0) {
    return explicitLabel;
  }

  if (normalizedAccountAuthMethod(account?.authMethod) === "api") {
    return "API balance";
  }

  return "Quota";
}

function buildQuotaWindowView(windowData, quotaSyncedAt) {
  const presentation = quotaWindowPresentation(windowData);
  const rawWindowMinutes = Number(windowData?.windowMinutes);
  const windowMinutes = Number.isFinite(rawWindowMinutes) && rawWindowMinutes > 0 ? Math.round(rawWindowMinutes) : null;
  const inferredDurationMs = inferredScheduleDurationMs(windowData, quotaSyncedAt);
  const scheduleDurationMs =
    windowMinutes !== null ? windowMinutes * 60_000 : Number.isFinite(inferredDurationMs) ? inferredDurationMs : null;
  const cadenceMinutes = authoritativeCadenceMinutes(windowData, quotaSyncedAt);
  const cadenceLabel = cadenceMinutes !== null ? cadenceLabelFromMinutes(cadenceMinutes) : "";
  const explicitLabel = normalizeQuotaLabel(windowData?.label);
  const limit = Number(windowData?.limit);
  const used = Number(windowData?.used);
  const remaining = Number(windowData?.remaining);
  const safeLimit = Number.isFinite(limit) ? limit : 0;
  const safeUsed = Number.isFinite(used) ? used : 0;
  const safeRemaining = Number.isFinite(remaining) ? remaining : Math.max(safeLimit - safeUsed, 0);

  return {
    ...presentation,
    label: cadenceLabel || explicitLabel,
    explicitLabel,
    cadenceLabel,
    cadenceMinutes,
    windowMinutes,
    scheduleDurationMs,
    limit: safeLimit,
    used: safeUsed,
    remaining: safeRemaining,
  };
}

function quotaWindowSignature(windowView) {
  const cadenceKey = Number.isFinite(windowView.cadenceMinutes) ? Math.round(windowView.cadenceMinutes) : "na";
  const minutesKey = Number.isFinite(windowView.windowMinutes) ? Math.round(windowView.windowMinutes) : "na";
  const scheduleKey =
    Number.isFinite(windowView.scheduleDurationMs) && windowView.scheduleDurationMs !== null
      ? Math.round(windowView.scheduleDurationMs / 60_000)
      : "na";
  const labelKey = typeof windowView.label === "string" ? windowView.label : "na";
  const resetKey = typeof windowView.resetAt === "string" ? windowView.resetAt : "na";
  const ratioKey = Math.round(windowView.ratio * 1000);
  const limitKey = Math.round(windowView.limit * 1000);
  const usedKey = Math.round(windowView.used * 1000);
  return `${cadenceKey}|${minutesKey}|${scheduleKey}|${labelKey}|${resetKey}|${ratioKey}|${limitKey}|${usedKey}`;
}

function normalizedAccountQuotaWindows(account) {
  const quotaSyncedAt = typeof account?.quotaSyncedAt === "string" ? account.quotaSyncedAt : null;
  const candidates = [
    {
      slot: "fiveHour",
      windowView: buildQuotaWindowView(account?.quota?.fiveHour, quotaSyncedAt),
    },
    {
      slot: "weekly",
      windowView: buildQuotaWindowView(account?.quota?.weekly, quotaSyncedAt),
    },
  ].map(({ slot, windowView }) => ({
    ...windowView,
    slot,
    label: resolveQuotaWindowLabel(account, slot, windowView),
  }));

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
      const slot = windowView.slot === "weekly" ? "weekly" : "fiveHour";
      const scheduleDurationMs =
        Number.isFinite(windowView.scheduleDurationMs) && windowView.scheduleDurationMs !== null
          ? Math.round(windowView.scheduleDurationMs)
          : null;
      const windowMinutes =
        Number.isFinite(windowView.windowMinutes) && windowView.windowMinutes !== null
          ? Math.round(windowView.windowMinutes)
          : null;
      const cadenceMinutes =
        Number.isFinite(windowView.cadenceMinutes) && windowView.cadenceMinutes !== null
          ? Math.round(windowView.cadenceMinutes)
          : null;
      const scheduleKey = `${slot}|${cadenceMinutes ?? "na"}|${windowMinutes ?? "na"}|${scheduleDurationMs ?? "na"}`;

      let bucket = buckets.get(scheduleKey);
      if (!bucket) {
        bucket = {
          slot,
          cadenceMinutes,
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

      if (bucket.cadenceMinutes === null && cadenceMinutes !== null) {
        bucket.cadenceMinutes = cadenceMinutes;
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
        slot: bucket.slot,
        label: mostFrequentLabel(bucket.labelCounts, ""),
        cadenceMinutes: bucket.cadenceMinutes,
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

function computeOverallQuotaRemainingPercent(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return null;
  }

  let totalLimit = 0;
  let totalRemaining = 0;
  let ratioSum = 0;
  let ratioCount = 0;

  for (const account of accounts) {
    const windows = normalizedAccountQuotaWindows(account);
    for (const windowView of windows) {
      const limit = Number(windowView?.limit ?? Number.NaN);
      const remaining = Number(windowView?.remaining ?? Number.NaN);
      const ratio = Number(windowView?.ratio ?? Number.NaN);

      if (Number.isFinite(limit) && limit > 0 && Number.isFinite(remaining)) {
        totalLimit += limit;
        totalRemaining += Math.max(Math.min(remaining, limit), 0);
      }

      if (Number.isFinite(ratio)) {
        ratioSum += clampRatio(ratio);
        ratioCount += 1;
      }
    }
  }

  if (totalLimit > 0) {
    return Math.max(Math.min((totalRemaining / totalLimit) * 100, 100), 0);
  }

  if (ratioCount > 0) {
    return Math.max(Math.min((ratioSum / ratioCount) * 100, 100), 0);
  }

  return null;
}

function buildDashboardApiBalanceMetrics(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return null;
  }

  const apiAccounts = accounts.filter((account) => normalizedAccountAuthMethod(account?.authMethod) === "api");
  if (apiAccounts.length === 0) {
    return null;
  }

  const balances = apiAccounts
    .map((account) => {
      const raw = typeof account?.creditsBalance === "string" ? account.creditsBalance.trim() : "";
      if (raw.length === 0) {
        return null;
      }

      return {
        raw,
        parsed: parseBalanceNumber(raw),
        currencyCode: detectBalanceCurrencyCode(raw),
      };
    })
    .filter((entry) => entry !== null);

  if (balances.length === 0) {
    return {
      value: "$0.00",
      detail: `0 API connections with live balance`,
      accountCount: apiAccounts.length,
      liveBalanceCount: 0,
    };
  }

  const allNumeric = balances.every((entry) => entry.parsed !== null);
  const uniqueCurrencyCodes = [...new Set(balances.map((entry) => entry.currencyCode))];
  const displayCurrencyCode = uniqueCurrencyCodes[0] ?? "USD";
  const canAggregate = allNumeric && uniqueCurrencyCodes.length === 1;
  const totalBalance = canAggregate ? balances.reduce((sum, entry) => sum + (entry.parsed ?? 0), 0) : null;
  const value =
    totalBalance !== null
      ? formatBalanceValue(totalBalance, displayCurrencyCode)
      : formatBalanceValue(balances[0]?.raw ?? "", balances[0]?.currencyCode ?? "USD");
  const detail =
    uniqueCurrencyCodes.length > 1
      ? `${formatNumber(balances.length)} API connections with mixed currencies`
      : `${formatNumber(balances.length)} API connections with live balance`;

  return {
    value,
    detail,
    accountCount: apiAccounts.length,
    liveBalanceCount: balances.length,
  };
}

function resolveCurrentModelMetric() {
  const preferences = routingPreferencesFromDashboard();
  const candidateModels = Array.isArray(preferences?.priorityModels)
    ? preferences.priorityModels
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];
  const currentModel = candidateModels[0] ?? "auto";
  const detail =
    currentModel.toLowerCase() === "auto"
      ? "Routing selects the best model automatically"
      : "Pinned in routing preferences";

  return {
    value: currentModel,
    detail,
  };
}

function renderDashboardQuotaMetrics(accounts) {
  const overallQuotaRemainingPercent = computeOverallQuotaRemainingPercent(accounts);
  if (overallQuotaRemainingPercent === null) {
    updateMetricText("#metric-total-quota", "--");
    updateMetricText("#metric-total-quota-detail", "No live quota windows available");
  } else {
    updateMetricText("#metric-total-quota", formatPercentValue(overallQuotaRemainingPercent));
    updateMetricText(
      "#metric-total-quota-detail",
      `${formatPercentValue(100 - overallQuotaRemainingPercent)} used / 100% capacity`,
    );
  }

  const apiBalanceMetrics = buildDashboardApiBalanceMetrics(accounts);
  if (apiBalanceMetrics) {
    updateMetricText("#metric-total-api-balance", apiBalanceMetrics.value);
    updateMetricText("#metric-total-api-balance-detail", apiBalanceMetrics.detail);
  } else {
    updateMetricText("#metric-total-api-balance", "$0.00");
    updateMetricText("#metric-total-api-balance-detail", "No API balance data available");
  }

  const currentModelMetric = resolveCurrentModelMetric();
  updateMetricText("#metric-current-model", currentModelMetric.value);
  updateMetricText("#metric-current-model-detail", currentModelMetric.detail);
}

function renderBestAccountCard(bestAccount) {
  if (!bestAccount) {
    updateMetricText("#metric-current-best-route", "None");
    updateMetricText("#metric-current-best-route-detail", "Score 0%");
    return;
  }

  updateMetricText("#metric-current-best-route", maskDisplayName(bestAccount.displayName));
  updateMetricText("#metric-current-best-route-detail", `Score ${formatPercent(bestAccount.routingScore)}`);
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

function renderApiBalanceBlock(account) {
  if (normalizedAccountAuthMethod(account?.authMethod) !== "api") {
    return "";
  }

  const rawBalance = typeof account?.creditsBalance === "string" ? account.creditsBalance.trim() : "";
  if (rawBalance.length === 0) {
    return "";
  }

  const currencyCode = detectBalanceCurrencyCode(rawBalance);

  return `
    <div class="quota-clean-block">
      <div class="quota-clean-head">
        <span class="quota-mini-label">API balance</span>
        <span class="quota-mini-value">${escapeHtml(formatBalanceValue(rawBalance, currencyCode))}</span>
      </div>
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

function setAccountsListBusy(isBusy) {
  if (!(accountsListElement instanceof HTMLElement)) {
    return;
  }

  accountsListElement.setAttribute("aria-busy", isBusy ? "true" : "false");
}

function renderAccountsLoadError(message) {
  if (!(accountsListElement instanceof HTMLElement)) {
    return;
  }

  const details =
    typeof message === "string" && message.trim().length > 0
      ? message.trim()
      : "Unable to load connections.";

  accountsListElement.classList.add("is-empty");
  accountsListElement.classList.remove("single-account");
  accountsListElement.innerHTML = `
    <div class="empty-state">
      <i data-lucide="alert-triangle"></i>
      <p>Unable to load connections.</p>
      <p>${escapeHtml(details)}</p>
    </div>
  `;
  setAccountsListBusy(false);
  reRenderIcons();
}

function renderAccounts(accounts) {
  if (!accountsListElement) return;
  setAccountsListBusy(false);

  if (accounts.length === 0) {
    accountsListElement.classList.add("is-empty");
    accountsListElement.classList.remove("single-account");
    accountsListElement.innerHTML = `
      <div class="empty-state">
        <i data-lucide="inbox"></i>
        <p>No connections yet.</p>
        <p>Connect a provider from the side panel to start routing.</p>
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
      const showSyncError = account.quotaSyncStatus !== "live" && syncError.length > 0;
      const estimateNote = usageEstimateNote(account);
      const issueSeverityClass = account.quotaSyncStatus === "stale" ? "warn" : "error";
      const issueIcon = issueSeverityClass === "warn" ? "triangle-alert" : "circle-alert";
      const issueButton = showSyncError
        ? `<button class="btn btn-icon account-issue-btn issue-tooltip-trigger ${issueSeverityClass}" data-open-account-settings="${escapeHtml(account.id)}" type="button" aria-label="Open sync issue for ${escapeHtml(accountTitle)}" data-warning-title="Sync issue" data-warning-severity="${escapeHtml(issueSeverityClass === "warn" ? "warning" : "error")}" data-warning-items="${warningDataItems([syncError])}" data-warning-action="open-account-settings" data-warning-action-label="Open settings" data-warning-account-id="${escapeHtml(account.id)}"><i data-lucide="${escapeHtml(issueIcon)}"></i></button>`
        : "";
      const estimateLine =
        estimateNote && estimateNote.trim().length > 0
          ? `<div class="account-note-msg">${escapeHtml(estimateNote)}</div>`
          : "";
      const apiBalanceBlock = renderApiBalanceBlock(account);
      const quotaBlocks =
        apiBalanceBlock.length > 0
          ? apiBalanceBlock
          : quotaWindows.map((windowView) => renderQuotaWindowBlock(windowView)).join("");
      const quotaGridClass =
        apiBalanceBlock.length > 0
          ? "account-quotas-clean single-window"
          : quotaWindows.length === 1
            ? "account-quotas-clean single-window"
            : "account-quotas-clean";

      return `
      <article class="account-card">
        <header class="account-top-row">
          <div class="account-actions">
            <span class="account-state-dot ${stateDot.className}" aria-hidden="true"></span>
            <span class="sr-only">Status: ${escapeHtml(stateDot.label)}</span>
            <h3 class="account-title" title="${escapeHtml(accountTitle)}">${escapeHtml(accountTitle)}</h3>
            ${issueButton}
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

        ${estimateLine}
      </article>
    `;
    })
    .join("");

  accountsListElement.innerHTML = cards;
  applyQuotaFillWidths();
  bindConnectWarningTriggers();
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

function normalizeSidebarModelSearchQuery(value) {
  return typeof value === "string" ? value.trim() : "";
}

function composeProviderModelId(providerId, modelId) {
  const providerPrefix = normalizeProviderId(providerId) ?? "";
  const normalizedModelId = typeof modelId === "string" ? modelId.trim().replace(/^\/+/, "") : "";
  if (!providerPrefix || !normalizedModelId) {
    return normalizedModelId;
  }

  const separatorIndex = normalizedModelId.indexOf("/");
  if (separatorIndex > 0) {
    const prefix = normalizedModelId.slice(0, separatorIndex).toLowerCase();
    if (KNOWN_PROVIDER_IDS.includes(prefix)) {
      return normalizedModelId;
    }
  }

  if (normalizedModelId.toLowerCase().startsWith(`${providerPrefix}/`)) {
    return normalizedModelId;
  }

  return `${providerPrefix}/${normalizedModelId}`;
}

function matchesSidebarModelSearch(modelId, normalizedSearchQuery) {
  if (typeof normalizedSearchQuery !== "string" || normalizedSearchQuery.length === 0) {
    return true;
  }

  const tokens = normalizedSearchQuery
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return true;
  }

  const haystack = String(modelId ?? "").toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function buildSidebarModelEntries(payload, searchQuery) {
  const normalized = normalizeConnectedProviderModelsPayload(payload);
  const normalizedSearchQuery = normalizeSidebarModelSearchQuery(searchQuery);
  const searchNeedle = normalizedSearchQuery.toLowerCase();

  const providersWithModelIds = normalized.providers.map((entry) => {
    const normalizedModelIds = entry.modelIds
      .map((modelId) => composeProviderModelId(entry.provider, modelId))
      .filter((modelId) => modelId.length > 0)
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
    const modelIds = [];
    const seenModelKeys = new Set();
    for (const modelId of normalizedModelIds) {
      const modelKey = modelId.toLowerCase();
      if (seenModelKeys.has(modelKey)) {
        continue;
      }

      seenModelKeys.add(modelKey);
      modelIds.push(modelId);
    }

    return {
      ...entry,
      modelIds,
    };
  });

  const visibleProviders =
    searchNeedle.length > 0
      ? providersWithModelIds
          .map((entry) => ({
            ...entry,
            modelIds: entry.modelIds.filter((modelId) => matchesSidebarModelSearch(modelId, normalizedSearchQuery)),
          }))
          .filter((entry) => entry.modelIds.length > 0)
      : providersWithModelIds;

  return {
    totalProviders: normalized.providers.length,
    visibleProviders,
    normalizedSearchQuery,
  };
}

function renderSidebarModels(payload) {
  if (!(sidebarModelsContentElement instanceof HTMLElement)) {
    return;
  }

  const modelEntries = buildSidebarModelEntries(payload, sidebarModelsSearchQuery);

  if (modelEntries.totalProviders === 0) {
    const message =
      typeof connectedProviderModelsError === "string" && connectedProviderModelsError.trim().length > 0
        ? `Unable to load model IDs (${escapeHtml(connectedProviderModelsError.trim())}).`
        : "No connected provider models yet.";
    sidebarModelsContentElement.innerHTML = `<p class="sidebar-models-empty">${message}</p>`;
    return;
  }

  if (modelEntries.visibleProviders.length === 0) {
    sidebarModelsContentElement.innerHTML = `<p class="sidebar-models-empty">No model IDs match &quot;${escapeHtml(modelEntries.normalizedSearchQuery)}&quot;.</p>`;
    return;
  }

  const markup = modelEntries.visibleProviders
    .map((entry) => {
      const providerName = providerNameById(entry.provider);
      const statusText = entry.status === "live" ? "live" : "unavailable";
      const countLabel = entry.accountCount === 1 ? "1 connection" : `${entry.accountCount} connections`;
      const modelList =
        entry.modelIds.length > 0
          ? `<ul class="sidebar-model-list">${entry.modelIds
              .map(
                (modelId) =>
                  `<li><button class="sidebar-model-id" type="button" data-copy-model-id="${escapeHtml(modelId)}" aria-label="Copy model ID ${escapeHtml(modelId)}" title="Copy ${escapeHtml(modelId)}">${escapeHtml(modelId)}</button></li>`,
              )
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
  quotaCadenceConsensusByScope = buildCadenceConsensusByScope(data.accounts);
  dashboardLoaded = true;
  statusError = false;
  dashboardAuthorized = Boolean(data.dashboardAuthorized);
  if (!dashboardAuthorized) {
    forceRevealApiKey = null;
  }

  setConnectorControlsEnabled(dashboardAuthorized);

  renderDashboardQuotaMetrics(data.accounts);
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
  setAccountsListBusy(true);
  try {
    void loadConnectedProviderModels();
    const payload = await request("/api/dashboard");
    renderDashboard(payload);
  } catch (error) {
    if (!dashboardLoaded) {
      renderAccountsLoadError(error instanceof Error ? error.message : "Request failed.");
    } else {
      setAccountsListBusy(false);
    }
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

  if (connectProvidersLoading) {
    connectProviderListElement.innerHTML = `
      <div class="connect-provider-empty">
        <i data-lucide="loader-circle"></i>
        <p>Loading providers...</p>
      </div>
    `;
    reRenderIcons();
    return;
  }

  if (connectProviders.length === 0) {
    connectProviderListElement.innerHTML = `
      <div class="connect-provider-empty">
        <i data-lucide="plug-zap"></i>
        <p>Provider list unavailable.</p>
        <p>Check provider configuration and retry.</p>
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
        ? '<span class="connect-provider-recommended">recommended</span>'
        : "";
      const headTags = recommendationTag
        ? `<div class="connect-provider-head-tags">${recommendationTag}</div>`
        : "";
      const warningTrigger = warnings.length > 0
        ? `
          <div class="connect-provider-warning-anchor">
            <button
              class="connect-provider-warning-trigger issue-tooltip-trigger"
              type="button"
              aria-label="Warnings for ${escapeHtml(provider.name)}"
              data-warning-items="${warningDataItems(warnings)}"
              data-warning-title="${escapeHtml(`${provider.name} warnings`)}"
              data-warning-severity="warning"
              data-warning-action="open-settings-page"
              data-warning-action-label="Open settings"
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
  hideConnectWarningTooltip();

  if (connectProviderListElement instanceof HTMLElement) {
    connectProviderListElement.hidden = false;
  }

  if (apiLinkForm instanceof HTMLFormElement) {
    apiLinkForm.hidden = true;
    apiLinkForm.reset();
  }
}

function isConnectModalOpen() {
  return connectModalElement instanceof HTMLElement && connectModalElement.hidden === false;
}

function isModalFocusableElement(element, modalRoot) {
  if (!(element instanceof HTMLElement) || !(modalRoot instanceof HTMLElement)) {
    return false;
  }

  if (element.hidden || element.getAttribute("aria-hidden") === "true") {
    return false;
  }

  if (typeof element.closest === "function") {
    const hiddenAncestor = element.closest("[hidden], [aria-hidden='true']");
    if (hiddenAncestor instanceof HTMLElement && hiddenAncestor !== modalRoot) {
      return false;
    }
  }

  if (typeof window.getComputedStyle === "function") {
    const styles = window.getComputedStyle(element);
    if (styles.display === "none" || styles.visibility === "hidden") {
      return false;
    }
  }

  return true;
}

function getConnectModalFocusableElements() {
  if (!isConnectModalOpen()) {
    return [];
  }

  const selector =
    "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
  const allFocusable = connectModalElement.querySelectorAll(selector);

  return [...allFocusable].filter((element) => isModalFocusableElement(element, connectModalElement));
}

function getAccountSettingsModalFocusableElements() {
  if (!isAccountSettingsModalOpen()) {
    return [];
  }

  const selector =
    "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
  const allFocusable = accountSettingsModalElement.querySelectorAll(selector);

  return [...allFocusable].filter((element) => isModalFocusableElement(element, accountSettingsModalElement));
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
  updateModalIsolationState();
  focusConnectModalPrimaryElement();
}

function closeConnectModal() {
  if (!(connectModalElement instanceof HTMLElement)) {
    return;
  }

  hideConnectWarningTooltip();
  hideApiLinkForm();
  connectModalElement.hidden = true;
  updateModalIsolationState();

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
    showToast("Connection settings are unavailable.", true);
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
    accountSettingsProviderAccountElement.textContent = maskProviderAccountId(account.providerAccountId);
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

  accountSettingsModalElement.hidden = false;
  updateModalIsolationState();
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
  updateModalIsolationState();
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
  connectProvidersLoading = false;

  connectProviders = providers
    .map((provider) => {
      if (!provider || typeof provider !== "object") {
        return null;
      }

      const id = typeof provider.id === "string" ? provider.id : "";
      const name = typeof provider.name === "string" ? provider.name : id;
      const supportsOAuth = provider.supportsOAuth === true;
      const oauthConfigured = provider.oauthConfigured === true;
      const oauthStartPath = sanitizeOauthStartPath(provider.oauthStartPath);
      const oauthOptions = Array.isArray(provider.oauthOptions)
        ? provider.oauthOptions
            .map((option) => {
              if (!option || typeof option !== "object") {
                return null;
              }

              const optionId = typeof option.id === "string" ? option.id : "";
              const optionLabel = typeof option.label === "string" ? option.label : optionId;
              const optionConfigured = option.configured === true;
              const optionStartPath = sanitizeOauthStartPath(
                typeof option.startPath === "string" ? option.startPath : oauthStartPath,
              );

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
    connectProvidersLoading = false;
    connectProviders = [];
    renderConnectProviderCards();
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

async function copySidebarModelId(fullModelId) {
  const modelId = typeof fullModelId === "string" ? fullModelId.trim() : "";
  if (!modelId) {
    showToast("Model ID unavailable.", true);
    return;
  }

  if (!navigator?.clipboard || typeof navigator.clipboard.writeText !== "function") {
    throw new Error("Clipboard is unavailable in this browser.");
  }

  await navigator.clipboard.writeText(modelId);
  showToast(`Copied ${modelId}.`);
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
  showToast("Connection removed.");
  await loadDashboard();
}

function checkConnectionToast() {
  const params = new URLSearchParams(window.location.search);
  let shouldRewriteUrl = false;

  if (params.get("connected") === "1") {
      showToast("Connection added successfully.");
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

  const topbarIssueButton = targetElement.closest("[data-topbar-issue-type]");
  if (topbarIssueButton instanceof HTMLElement) {
    const issueType = topbarIssueButton.dataset.topbarIssueType;
    await resolveTopbarIssue(issueType);
    return;
  }

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

    const safeStartPath = sanitizeOauthStartPath(oauthOption.startPath);
    if (!safeStartPath) {
      showToast("OAuth start path is invalid.", true);
      return;
    }

    window.location.assign(safeStartPath);
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
      showToast("Connection settings are unavailable.", true);
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
      const confirmed = window.confirm("Remove this connection?");
      if (!confirmed) {
        return;
      }
    }

    try {
      await removeAccount(accountId);
    } catch (error) {
      showToast(error.message || "Failed to remove connection.", true);
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

  const copyModelIdButton = targetElement.closest("[data-copy-model-id]");
  if (copyModelIdButton instanceof HTMLElement) {
    const fullModelId = copyModelIdButton.dataset.copyModelId;
    try {
      await copySidebarModelId(fullModelId);
    } catch (error) {
      showToast(error.message || "Failed to copy model ID.", true);
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

    if (apiLinkKeyInput instanceof HTMLInputElement) {
      apiLinkKeyInput.setCustomValidity("");
      apiLinkKeyInput.removeAttribute("aria-invalid");
    }

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
    const apiKey = String(data.get("apiKey") ?? "").trim();

    if (!apiKey) {
      if (apiLinkKeyInput instanceof HTMLInputElement) {
        apiLinkKeyInput.setCustomValidity("API key is required.");
        apiLinkKeyInput.setAttribute("aria-invalid", "true");
        apiLinkKeyInput.reportValidity();
        apiLinkKeyInput.focus();
      } else {
        showToast("API key is required.", true);
      }
      return;
    }

    try {
      await request("/api/accounts/link-api", {
        method: "POST",
        body: {
          provider: selectedApiProviderId,
          displayName,
          providerAccountId,
          apiKey,
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

    if (accountSettingsDisplayNameInput instanceof HTMLInputElement) {
      accountSettingsDisplayNameInput.setCustomValidity("");
      accountSettingsDisplayNameInput.removeAttribute("aria-invalid");
    }

    if (!selectedAccountSettingsId) {
      showToast("No account selected.", true);
      return;
    }

    const account = findDashboardAccount(selectedAccountSettingsId);
    if (!account) {
      showToast("Connection settings are unavailable.", true);
      return;
    }

    const displayName =
      accountSettingsDisplayNameInput instanceof HTMLInputElement
        ? accountSettingsDisplayNameInput.value.trim()
        : "";
    if (!displayName) {
      if (accountSettingsDisplayNameInput instanceof HTMLInputElement) {
        accountSettingsDisplayNameInput.setCustomValidity("Display name is required.");
        accountSettingsDisplayNameInput.setAttribute("aria-invalid", "true");
        accountSettingsDisplayNameInput.reportValidity();
        accountSettingsDisplayNameInput.focus();
      } else {
        showToast("Display name is required.", true);
      }
      return;
    }

    const payload = {
      displayName,
    };

    try {
      await request(`/api/accounts/${encodeURIComponent(selectedAccountSettingsId)}/settings`, {
        method: "POST",
        body: payload,
      });

      showToast("Connection settings saved.");
      closeAccountSettingsModal();
      await loadDashboard();
    } catch (error) {
      showToast(error.message || "Failed to save connection settings.", true);
    }
  });
}

if (apiLinkKeyInput instanceof HTMLInputElement) {
  apiLinkKeyInput.addEventListener("input", () => {
    apiLinkKeyInput.setCustomValidity("");
    apiLinkKeyInput.removeAttribute("aria-invalid");
  });
}

if (accountSettingsDisplayNameInput instanceof HTMLInputElement) {
  accountSettingsDisplayNameInput.addEventListener("input", () => {
    accountSettingsDisplayNameInput.setCustomValidity("");
    accountSettingsDisplayNameInput.removeAttribute("aria-invalid");
  });
}

if (sidebarModelsSearchInput instanceof HTMLInputElement) {
  sidebarModelsSearchInput.addEventListener("input", () => {
    sidebarModelsSearchQuery = normalizeSidebarModelSearchQuery(sidebarModelsSearchInput.value);
    renderSidebarModels(connectedProviderModelsPayload);
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
  if (isAccountSettingsModalOpen() && event.key === "Tab") {
    const focusableElements = getAccountSettingsModalFocusableElements();
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
