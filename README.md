# omni-connector

omni-connector is a simple interface to connect & track all your AI service providers via OAuth or API key, then combine them into one smart key you can use anywhere uninterrupted, because it automatically picks the best available connection.

## Installation

Use the global installer one-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/omnious0o0/omni-connector/main/scripts/install.sh | bash
```

Then start it with:

```bash
omni-connector
```

## Commands

- `omni-connector` - Start the globally installed server
- `omni-connector --init-only` - Initialize runtime files without starting the server
- `npm run dev` - Run in watch mode via `tsx`
- `npm run typecheck` - Type-check without building
- `npm run test` - Run the test suite
- `npm run build` - Clean and build TypeScript into `dist/`
- `npm run start` - Run production build

## Optional Environment Overrides

Defaults are ready out of the box. Use `.env` only if you want to override behavior.

- `HOST`, `PORT`, `DATA_FILE`, `SESSION_SECRET`, `SESSION_SECRET_FILE`, `DATA_ENCRYPTION_KEY`, `PUBLIC_DIR`
- `OAUTH_PROVIDER_NAME`, `OAUTH_AUTHORIZATION_URL`, `OAUTH_TOKEN_URL`
- `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_SCOPES`, `OAUTH_REDIRECT_URI`, `OAUTH_ORIGINATOR`
- `OAUTH_USERINFO_URL`, `OAUTH_QUOTA_URL`, `OAUTH_REQUIRE_QUOTA`
- `DEFAULT_FIVE_HOUR_LIMIT`, `DEFAULT_FIVE_HOUR_USED`, `DEFAULT_WEEKLY_LIMIT`, `DEFAULT_WEEKLY_USED`

By default `OAUTH_REQUIRE_QUOTA=true`, so account linking fails if real quota cannot be fetched.

## API

Read API docs [here](docs/API.md)

## Support

If you found this project useful, please consider starring the repo and dropping me a follow for more stuff like this :)
It takes less than a minute and helps a lot ❤️

> If you find a bug or unexpected behavior, please report it!

---


**RECOMMENDED:** Check out [commands-wrapper](https://github.com/omnious0o0/commands-wrapper) you and your agent will love it!

---

If you want to show extra love, consider *[buying me a coffee](https://buymeacoffee.com/specter0o0)*! ☕


[![Buy Me a Coffee](https://imgs.search.brave.com/FolmlC7tneei1JY_QhD9teOLwsU3rivglA3z2wWgJL8/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly93aG9w/LmNvbS9ibG9nL2Nv/bnRlbnQvaW1hZ2Vz/L3NpemUvdzIwMDAv/MjAyNC8wNi9XaGF0/LWlzLUJ1eS1NZS1h/LUNvZmZlZS53ZWJw)](https://buymeacoffee.com/specter0o0)

### Related projects

- [commands-wrapper](https://github.com/omnious0o0/commands-wrapper)
- [extract](https://github.com/omnious0o0/extract)

**And more on [omnious](https://github.com/omnious0o0)!**

## License

[MIT](LICENSE)
