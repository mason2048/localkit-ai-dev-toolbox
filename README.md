# LocalKit · AI Dev Toolbox

[中文说明](README.zh-CN.md) · [English user guide](docs/USER_GUIDE.en.md) · [中文用户指南](docs/USER_GUIDE.zh-CN.md)

LocalKit is a local-first, offline-capable PWA with six practical AI development utilities. It has no application backend, login, telemetry, analytics, or cloud AI dependency. Inputs and results stay in the current browser memory unless the user explicitly downloads a file.

Current version: `0.2.0`.

## Six tools

| Tool | Main capability | Local download |
|---|---|---|
| JSON Formatter | Format JSON; validate Context Package v0.1 and its static safety boundary | JSON / safe validation report |
| YAML Converter | Format and validate YAML; convert JSON ↔ YAML | JSON or YAML |
| Prompt Diff | Compare line-level or word-level additions, removals, and unchanged text | JSON |
| Token Counter | Estimate budgets or count exact `cl100k_base` / `o200k_base` body tokens | JSON |
| Sensitive-data Redaction | Detect built-in types and safe custom literal/mask rules | redacted TXT / safe report |
| Skill Validator | Statically check structures, references, suspicious commands, policies, and batches | safe report / aggregate report |

Static validation is not malware analysis, provenance verification, or a guarantee that a Skill is safe to execute.

## Quick start

Requirements: Node.js `20.19+` and npm.

```bash
git clone https://github.com/mason2048/localkit-ai-dev-toolbox.git
cd localkit-ai-dev-toolbox
npm ci
npm run dev
```

Open the local URL printed by Vite, normally <http://localhost:5173>. Choose **JSON Formatter**, load the sample, and run it for the fastest first success. Stop with `Ctrl+C`.

Production preview:

```bash
npm run build
npm run preview
```

The production preview is the correct environment for PWA and offline testing. The development server intentionally does not register the Service Worker.

## First offline activation

1. Start the production preview and open it while connected.
2. Wait for the first page load to finish.
3. Refresh once so the page is controlled by the installed Service Worker.
4. Switch the browser to offline mode and refresh again.
5. Run all six tools using built-in examples.

The first connected load precaches HTML, CSS, JavaScript, the web manifest, and both tokenizer datasets. Offline support is not ready until that first activation completes.

## Install as a PWA

Serve LocalKit from `localhost` or HTTPS; `file://` is not supported. In a browser that offers installation, use the address-bar install button or **Install app** in the browser menu. Installed and tab-based versions use the same local-only processing and static cache.

Browser install affordances vary by browser and platform. A successful production build alone does not prove that a specific device offered or completed installation.

## Privacy and downloads

- Tool inputs, results, recent-tool order, custom rules, and policies live in React memory and disappear on refresh or close.
- No input is written to Local Storage, Session Storage, IndexedDB, cookies, analytics, or logs.
- Cache Storage contains only same-origin application assets required for offline operation.
- Downloads are generated from a browser `Blob` after an explicit click. The downloaded file is outside LocalKit and must be managed by the user.
- Skill files are read as bounded text and never executed.
- Reports use safe IDs and whitelist projections rather than source bodies, matched values, or raw paths.

See [SECURITY.md](SECURITY.md) and the [privacy verification steps](docs/USER_GUIDE.en.md#9-verify-the-privacy-boundary).

## Verification

```bash
npm run check
npm run test:e2e
npm audit
```

- Unit tests cover the six tools, protocol bounds, tokenizer fixtures, redaction limits, zero-execution policies, report rejection, and Service Worker cache isolation.
- The 16-path Playwright suite covers desktop and mobile flows, actual downloads, refresh clearing, zero operation requests, and offline reload with all six tools.
- E2E starts a fresh production preview with `reuseExistingServer: false`.

Automated checks are not a substitute for real-user testing, low-end Android testing, weak-network testing, or browser-specific PWA installation acceptance.

## Mobile first-load risk

Both exact tokenizer datasets ship in the first production bundle so they remain available offline. The current JavaScript payload is about 3.3 MB before compression and about 1.6 MB gzip. This can delay first interaction or increase memory pressure on low-end mobile devices. Use a stable connection for the first activation and do not describe offline mode as ready before the Service Worker controls the page.

## Documentation

- [English user guide](docs/USER_GUIDE.en.md)
- [中文用户指南](docs/USER_GUIDE.zh-CN.md)
- [P1/P2 acceptance contract](P1-P2-ACCEPTANCE.md)
- [Historical PRD v0.1](PRD.md)
- [Contributing](CONTRIBUTING.md)

## Security reporting

Report vulnerabilities through [GitHub Private Vulnerability Reporting](https://github.com/mason2048/localkit-ai-dev-toolbox/security/advisories/new), not a public issue. Do not include real credentials, private prompts, customer data, or proprietary Skills in a report.

## License

Apache License 2.0. See [LICENSE](LICENSE).
