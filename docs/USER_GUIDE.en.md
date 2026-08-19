# LocalKit User Guide

[中文版本](USER_GUIDE.zh-CN.md) · [README](../README.md)

This guide covers installation, all six tools, PWA/offline activation, downloads, privacy verification, cleanup, and troubleshooting for LocalKit `0.2.0`.

## 1. Clone and install

Requirements:

- Node.js `20.19+`
- npm
- A modern Chromium, Firefox, or Safari browser for normal use
- Chromium installed by Playwright for the repository E2E suite

```bash
git clone https://github.com/mason2048/localkit-ai-dev-toolbox.git
cd localkit-ai-dev-toolbox
npm ci
```

LocalKit does not need a server-side API key, database, account, or cloud model.

## 2. Start and stop

Development mode:

```bash
npm run dev
```

Open the URL printed by Vite, normally <http://localhost:5173>. Stop with `Ctrl+C`.

Production/PWA preview:

```bash
npm run build
npm run preview
```

Open the printed preview URL. Stop with `Ctrl+C`. Use production preview for Service Worker and offline checks; development mode intentionally avoids Service Worker registration.

## 3. First successful operation

1. Open LocalKit.
2. Select **JSON Formatter**.
3. Select **Load sample**.
4. Select **Format and validate**.
5. Confirm that a formatted result and success status appear.
6. Refresh, return to JSON Formatter, and confirm that the previous input is gone.

This proves one local UI path, not the complete privacy or offline boundary. Use the checks below for those claims.

## 4. Use the six tools

### JSON Formatter

- Paste JSON, run formatting, and inspect line/column diagnostics when invalid.
- Switch to **Context Package v0.1** to validate required fields, enums, times, sources, revisions, duplicate IDs, embedded executable content, and secret-like text.
- A passing report proves only the implemented structure and static checks. It does not verify source truth or freshness.
- Downloads contain formatted JSON or a safe validation report, depending on the active mode.

### YAML Converter

- Paste YAML and format it, or convert between YAML and JSON.
- Parse errors include line and column guidance.
- YAML is treated as data; LocalKit does not instantiate classes or execute tags.

### Prompt Diff

- Enter before/after text.
- Choose line or word mode.
- Review additions, removals, and unchanged segments.
- Download the machine-readable summary when needed.

### Token Counter

- Use approximate mode for a quick budget estimate.
- Use exact mode for ordinary body text under `cl100k_base`, `o200k_base`, GPT-4, or GPT-4o mappings.
- Counts do not include chat wrappers, tool calls, images, provider caching rules, or billing adjustments.
- Both tokenizer datasets are bundled locally; exact counting performs no network request.

### Sensitive-data Redaction

- Paste text and run detection before revealing or downloading the redacted result.
- Built-in categories include provider-shaped keys/tokens, email, mainland China phone/ID, and IPv4.
- Custom rules allow only fixed text or simple linear masks; arbitrary regex and replacement code are rejected.
- If input, rule, or hit limits are exceeded, no partial download is produced.
- The safe report contains categories and safe IDs, not matched values or raw offsets.

### Skill Validator

- Select one or more Skill directories. Unsupported or oversized files reject the complete selection instead of being silently skipped.
- Run the built-in structural, reference, suspicious-command, and secret checks.
- Optional policy JSON can add warnings or blockers but cannot disable built-in safety rules.
- Batch mode accepts up to 20 objects. Safe report aggregation accepts only `localkit.report/v1` and strips source names, paths, and bodies.
- LocalKit never runs shell commands, scripts, package managers, dynamic imports, or network requests from a Skill.

## 5. First offline activation

1. Run `npm run build` and `npm run preview`.
2. Open the production preview while connected.
3. Wait for the page and static assets to finish loading.
4. Refresh once and confirm the Service Worker now controls the page in browser developer tools.
5. Enable offline mode in the browser Network panel.
6. Refresh the page.
7. Load and run an example in each of the six tools.

The Service Worker caches only same-origin HTML, CSS, JavaScript, the manifest, and tokenizer assets. It deletes only older cache keys beginning with `localkit-`; unrelated cache namespaces are preserved.

If the first load was interrupted, stay connected, reload, and wait for Service Worker readiness before testing offline behavior.

## 6. Install the PWA

PWA features require `localhost` or HTTPS. A page opened through `file://` cannot register the Service Worker.

In Chrome or Edge:

1. Open the production preview or an HTTPS deployment.
2. Wait for the first connected load.
3. Use the address-bar install icon or browser menu **Install app** when offered.
4. Launch the installed app and repeat one tool operation.

Safari and mobile browsers use platform-specific **Add to Home Screen** or installation flows. Availability varies by browser/version, so verify the actual target device rather than inferring installation from the manifest.

## 7. Download semantics

- A download begins only after the user selects a download button.
- LocalKit creates a browser `Blob`, clicks a temporary local download link, and immediately revokes the object URL.
- No server receives the output and LocalKit keeps no download history.
- The resulting file is stored wherever the browser or operating system places downloads. It is no longer managed by LocalKit.
- Safe reports deliberately omit input bodies, matched values, raw source paths, and user policy IDs.

Review any formatted, diff, or redacted text before sharing it. Rule-based redaction can miss organization-specific identifiers.

## 8. Mobile and weak-network guidance

The two tokenizer datasets make the first JavaScript load about 3.3 MB before compression and about 1.6 MB gzip. On a low-end Android device or weak network:

- Use a stable connection for first activation.
- Keep the tab in the foreground until loading completes.
- Do not switch offline until the Service Worker controls the page.
- Expect higher memory use when exact token counting is opened.
- Test 390 px and the real target viewport; desktop success is not mobile acceptance.

There is currently no lazy tokenizer download because offline exact counting is prioritized. This is an explicit performance tradeoff and a remaining product risk.

## 9. Verify the privacy boundary

Use a synthetic marker, never real private data.

1. Open browser developer tools and clear the Network list.
2. Enter a unique synthetic marker in one tool.
3. Run the operation. No new Fetch/XHR request should contain or transmit the marker.
4. Inspect Application/Storage:
   - Local Storage: no tool input
   - Session Storage: no tool input
   - IndexedDB: no tool input database
   - Cookies: no tool input
   - Cache Storage: static application URLs only
5. Refresh and confirm the editor/result are empty.
6. Download a result and confirm the intended output is present only in the downloaded file.

The normal initial page load still requests same-origin static files. “Zero operation requests” means running a tool after the app is loaded does not send the input anywhere.

## 10. Cleanup

- Refresh or close the page to clear in-memory input, results, custom rules, policies, and recent-tool order.
- Remove downloaded files through the browser/operating system if they are no longer needed.
- To reset offline installation, uninstall the PWA and clear this site's Service Worker and Cache Storage in browser settings/developer tools.
- `dist/`, `test-results/`, `playwright-report/`, coverage, and npm caches are generated and ignored by Git. They can be regenerated; LocalKit does not delete them automatically.

Do not clear another site's storage or unrelated cache namespace when testing LocalKit.

## 11. Tests

```bash
npm run check
npm run test:e2e
npm audit
```

`npm run check` runs unit tests and a production build. `npm run test:e2e` rebuilds and starts a fresh preview on `127.0.0.1:4185`, then runs the 16 desktop/mobile paths. If Chromium is not installed for Playwright, install the matching browser package before rerunning.

## 12. Troubleshooting

| Symptom | What to check |
|---|---|
| Node engine error | Use Node 20.19+ and rerun `npm ci`. |
| Page is blank | Check the browser console and confirm the Vite URL, not a `file://` path. |
| Offline refresh fails | Complete one connected production load, wait for Service Worker control, then retry. |
| Install option is missing | Use localhost/HTTPS, production build, and a browser/platform that offers PWA installation. |
| Input reappears after refresh | Check for browser form restoration or extensions; LocalKit does not persist it. |
| Exact token count feels slow | First open parses bundled tokenizer data; test memory/CPU on the target device. |
| Skill folder is rejected | Check the 20-object, 256-file, 1 MiB/file, 16 MiB total limits and supported text types. |
| Redaction has no download | Resolve input/rule/hit limit errors; fail-closed operations do not emit partial output. |
| Playwright cannot start | Ensure the matching Chromium is installed and port 4185 is available. |

## 13. Known limits

LocalKit is not a credential vault, malware sandbox, online API proxy, exact provider billing calculator, team product, or guarantee that rule-based redaction found every sensitive value. Real-user, low-end Android, weak-network, and browser-specific PWA installation verification remain external acceptance work.
