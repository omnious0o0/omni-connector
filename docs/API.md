# API

Base URL defaults to `http://127.0.0.1:1455`.

## `GET /api/auth/provider`

Returns OAuth provider metadata used by the frontend.

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

## OAuth entry

- Preferred: `GET /auth/omni/start`
- Legacy alias: `GET /auth/codex/start`
