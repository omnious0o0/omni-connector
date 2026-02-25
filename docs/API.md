# API

Base URL defaults to `http://127.0.0.1:1455`.

## `GET /api/auth/provider`

Returns OAuth provider metadata used by the frontend.

## `GET /api/auth/providers`

Returns connect modal provider catalog with supported methods (`oauth` / `api`) and OAuth entry path when available.

Response includes:

- `strictLiveQuota`: whether strict live-quota routing mode is enabled
- `providers[].usageConfigured`: whether a provider usage adapter is configured
- `providers[].oauthOptions[]`: OAuth choices per provider (`id`, `label`, `configured`, `startPath`)

## `GET /api/dashboard`

Headers:

- `X-Omni-Client: dashboard`

Returns connector key, totals, best route target, and linked accounts.

## `POST /api/connector/key/rotate`

Headers:

- `X-Omni-Client: dashboard`

Rotates and returns the connector API key.

## `POST /api/accounts/:accountId/remove`

Headers:

- `X-Omni-Client: dashboard`

Removes the linked account.

## `POST /api/accounts/link-api`

Headers:

- `X-Omni-Client: dashboard`

Body:

```json
{
  "provider": "gemini",
  "displayName": "Gemini Workspace",
  "providerAccountId": "gemini-primary",
  "apiKey": "your-api-key",
  "manualFiveHourLimit": 50000,
  "manualWeeklyLimit": 500000
}
```

Links or updates an API-key account for the selected provider.

## `POST /api/connector/route`

Headers:

- `Authorization: Bearer <connector-api-key>`

Body:

```json
{
  "units": 1
}
```

Returns the selected account, consumed units, and remaining quota snapshot.

When `STRICT_LIVE_QUOTA=true`, returns `503 strict_live_quota_required` if no account has live usage data.

## OAuth entry

- Preferred: `GET /auth/omni/start`
- Legacy alias: `GET /auth/codex/start`
- Provider route: `GET /auth/:provider/start`
- Profile route: `GET /auth/:provider/start?profile=<profile-id>`
  - Gemini currently exposes `profile=gemini-cli` and `profile=antigravity`
  - Anthropic currently exposes `profile=claude-code`
