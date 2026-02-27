export type ProviderId =
  | "codex"
  | "gemini"
  | "claude"
  | "openrouter";
export type AccountAuthMethod = "oauth" | "api";
export type QuotaWindowMode = "units" | "percent";
export type RoutingPreferredProvider = ProviderId | "auto";

export interface RoutingPreferences {
  preferredProvider: RoutingPreferredProvider;
  fallbackProviders: ProviderId[];
  priorityModels: string[];
}

export function createDefaultRoutingPreferences(): RoutingPreferences {
  return {
    preferredProvider: "auto",
    fallbackProviders: [],
    priorityModels: ["auto"],
  };
}

export interface QuotaWindowState {
  limit: number;
  used: number;
  mode?: QuotaWindowMode;
  label?: string | null;
  windowMinutes?: number | null;
  windowStartedAt: string;
  resetsAt?: string | null;
}

export interface AccountQuotaState {
  fiveHour: QuotaWindowState;
  weekly: QuotaWindowState;
}

export interface ConnectedAccount {
  id: string;
  provider: ProviderId;
  authMethod?: AccountAuthMethod;
  oauthProfileId?: string;
  providerAccountId: string;
  chatgptAccountId?: string | null;
  displayName: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  quotaSyncedAt?: string | null;
  quotaSyncStatus?: "live" | "stale" | "unavailable";
  quotaSyncError?: string | null;
  estimatedUsageSampleCount?: number;
  estimatedUsageTotalUnits?: number;
  estimatedUsageUpdatedAt?: string | null;
  planType?: string | null;
  creditsBalance?: string | null;
  quota: AccountQuotaState;
}

export interface ConnectorState {
  apiKey: string;
  createdAt: string;
  lastRotatedAt: string;
  routingPreferences: RoutingPreferences;
}

export interface PersistedData {
  connector: ConnectorState;
  accounts: ConnectedAccount[];
}

export interface OAuthLinkedAccountPayload {
  provider: ProviderId;
  authMethod?: Extract<AccountAuthMethod, "oauth">;
  oauthProfileId?: string;
  providerAccountId: string;
  chatgptAccountId?: string | null;
  displayName: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: string;
  quotaSyncedAt?: string | null;
  quotaSyncStatus?: "live" | "stale" | "unavailable";
  quotaSyncError?: string | null;
  planType?: string | null;
  creditsBalance?: string | null;
  quota: {
    fiveHourLimit: number;
    fiveHourUsed?: number;
    fiveHourMode?: QuotaWindowMode;
    fiveHourLabel?: string | null;
    fiveHourWindowMinutes?: number | null;
    fiveHourWindowStartedAt?: string;
    fiveHourResetsAt?: string | null;
    weeklyLimit: number;
    weeklyUsed?: number;
    weeklyMode?: QuotaWindowMode;
    weeklyLabel?: string | null;
    weeklyWindowMinutes?: number | null;
    weeklyWindowStartedAt?: string;
    weeklyResetsAt?: string | null;
  };
}

export interface ApiLinkedAccountPayload {
  provider: ProviderId;
  providerAccountId: string;
  displayName: string;
  apiKey: string;
  manualFiveHourLimit?: number;
  manualWeeklyLimit?: number;
}

export interface AccountSettingsUpdatePayload {
  displayName?: string;
  manualFiveHourLimit?: number;
  manualWeeklyLimit?: number;
}

export interface DashboardQuotaWindow {
  limit: number;
  used: number;
  mode?: QuotaWindowMode;
  label?: string | null;
  windowMinutes?: number | null;
  remaining: number;
  remainingRatio: number;
  resetsAt?: string | null;
}

export interface DashboardAccount {
  id: string;
  provider: ProviderId;
  authMethod?: AccountAuthMethod;
  oauthProfileId?: string;
  providerAccountId: string;
  chatgptAccountId?: string | null;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  quotaSyncedAt?: string | null;
  quotaSyncStatus?: "live" | "stale" | "unavailable";
  quotaSyncError?: string | null;
  estimatedUsageSampleCount?: number;
  estimatedUsageTotalUnits?: number;
  estimatedUsageUpdatedAt?: string | null;
  planType?: string | null;
  creditsBalance?: string | null;
  quota: {
    fiveHour: DashboardQuotaWindow;
    weekly: DashboardQuotaWindow;
  };
  routingScore: number;
}

export interface DashboardTotals {
  fiveHourLimit: number;
  fiveHourUsed: number;
  fiveHourRemaining: number;
  weeklyLimit: number;
  weeklyUsed: number;
  weeklyRemaining: number;
}

export interface DashboardPayload {
  connector: ConnectorState;
  totals: DashboardTotals;
  bestAccount: DashboardAccount | null;
  accounts: DashboardAccount[];
}

export interface ConnectedProviderModelsEntry {
  provider: ProviderId;
  accountCount: number;
  status: "live" | "unavailable";
  modelIds: string[];
  syncError: string | null;
  fetchedAt: string;
}

export interface ConnectedProviderModelsPayload {
  providers: ConnectedProviderModelsEntry[];
}

export interface RouteDecision {
  routedTo: {
    id: string;
    provider: ProviderId;
    authMethod?: AccountAuthMethod;
    providerAccountId: string;
    displayName: string;
  };
  unitsConsumed: number;
  quotaConsumed?: boolean;
  authorizationHeader: string;
  remaining: {
    fiveHour: number;
    weekly: number;
  };
}
