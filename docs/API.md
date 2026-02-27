# Omni-Connector API

A single smart key that routes requests across all connected AI providers, automatically, uninterrupted.

---

## Not a developer?

Just tell your AI agent this:
> **Tip:** Gemini CLI is free and can handle this task easily.

```
I want to use Omni-Connector as my AI provider.
Base URL: http://localhost:1455/v1
API Key: <YOUR-API-KEY>
Use model: auto

<TYPE HERE WHERE YOU WANT TO USE IT (e.g. opencode, cursor, etc.)>

Set this up exactly as you would an OpenAI-compatible provider.
Replace any existing base URL and API key with the above.
Do not change anything else.

Please research `https://github.com/omnious0o0/omni-connector` first, especially `docs/`

Note: if the user did not fill in the <> parts, ask them to before proceeding.
```

That's all. The agent will handle the rest.

---

## Quick Setup

> **IMPORTANT:** make sure you've installed omni-connector (see README.md)

**1.** Run `omni-connector` to start the server, then navigate to `http://localhost:1455` in your browser to see the dashboard
**2.** Connect AI providers (via OAuth or API key), and set your preferences via the dashboard.
**3.** Generate an API key that starts with `omni-`...
**4.** Use it anywhere (see below)

---

## Using with a Code SDK

Drop-in replacement for any OpenAI-compatible client:

```python
from openai import OpenAI

client = OpenAI(
    api_key="omni-abc123",
    base_url="http://localhost:1455/v1"
)

response = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Hello"}]
)
```

Works with any library or tool that accepts a custom `base_url`.

---

## Using with a Tool or App

Most AI-powered tools (like opencode) have a **custom provider** or **"other"** option in settings. Use these values:

| Field | Value |
|---|---|
| **API Key** | `omni-abc123` |
| **Base URL** | `http://localhost:1455/v1` |
| **Model** | `auto` *(or any model ID below)* |

If the tool asks for an **API type**, select `OpenAI` or `OpenAI-compatible`.

---

## Targeting a Specific Provider or Model

By default, `model: auto` lets Omni pick the best available option. To be more specific:

| Model Value | Behavior |
|---|---|
| `auto` | Picks best available across all connected providers |
| `provider-id` | Best available connection for that provider |
| `model-id` | Exact model, best matching account |

---

## Custom / Self-Hosted Providers

[coming soon]

---

## How Routing Works

```
Request arrives
-> omni-key decoded -> connected providers loaded
-> filter: which can serve this request?
-> pick best match (quota, latency, cost, preference)
-> translate to provider's native format
-> call provider
-> if fail -> fallback to next best
-> translate response back to OpenAI format
-> return
```

---

## Errors

| Code | Meaning |
|---|---|
| `401` | Invalid or expired omni-key |
| `503` | No providers available, all down or quota exhausted |

On `503`, the response body includes a per-provider failure breakdown.

---

## Endpoint Reference

```
POST http://localhost:1455/v1/chat/completions
Authorization: Bearer omni-abc123
Content-Type: application/json
```
