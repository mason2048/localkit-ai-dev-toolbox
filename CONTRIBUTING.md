# Contributing to LocalKit

Thanks for helping improve LocalKit. Contributions must preserve the browser-only, local-first, zero-input-persistence model.

## Before opening a change

- Use GitHub Issues for ordinary bugs and feature proposals.
- Use [Private Vulnerability Reporting](https://github.com/mason2048/localkit-ai-dev-toolbox/security/advisories/new) for security issues.
- Never attach real credentials, private prompts, customer data, browser profiles, or proprietary Skills.
- Do not add telemetry, analytics, cloud APIs, executable plugins, credential storage, or a business backend without an explicit product/security review.

## Development setup

```bash
git clone https://github.com/mason2048/localkit-ai-dev-toolbox.git
cd localkit-ai-dev-toolbox
npm ci
npm run dev
```

Use Node.js `20.19+`.

## Required checks

```bash
npm run check
npm run test:e2e
npm audit
```

The E2E suite must use its fresh production preview. Do not change `reuseExistingServer: false` merely to make a stale local server pass.

## Privacy and safety invariants

- Tool operations must not send input over the network.
- Input, results, rules, policies, and recent-tool state must disappear on refresh.
- Cache Storage may contain only same-origin application assets.
- Downloads require an explicit user action and are generated locally.
- Skill and policy content is bounded text/data and is never executed.
- Built-in checks cannot be disabled by a custom policy.
- Safe reports must not contain bodies, matched values, raw paths, filenames, or user rule/policy identifiers.
- Tests that need provider-shaped credentials must assemble synthetic values at runtime; never commit a credential-shaped literal.

## Pull request checklist

- Explain user-visible, privacy, offline, and first-bundle effects.
- Add or update unit and Playwright coverage.
- Update English and Chinese user documentation together.
- Verify desktop and 390 px mobile behavior when the UI changes.
- Keep builds, browsers, caches, reports, traces, downloads, and local state out of the change.
- Confirm no private path, credential-shaped literal, or file larger than 95 MB is included.
- State remaining real-user, low-end Android, weak-network, and browser-installation risks.

By contributing, you agree that your contribution is licensed under Apache License 2.0.
