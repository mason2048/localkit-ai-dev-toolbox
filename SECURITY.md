# Security and Privacy Policy

## Supported versions

Security fixes are currently prepared for the latest `0.2.x` source on the default branch. Older snapshots and unpublished local builds are not maintained as separate release lines.

## Report a vulnerability privately

Use [GitHub Private Vulnerability Reporting](https://github.com/mason2048/localkit-ai-dev-toolbox/security/advisories/new). Do not open a public issue for a suspected vulnerability.

Include the affected version/commit, the smallest synthetic reproduction, expected and observed behavior, impact, and required preconditions. Do not attach real credentials, private prompts, customer data, proprietary Skills, browser profiles, or downloaded reports containing private material. Revoke and rotate any credential exposed during testing before reporting.

The maintainer will aim to acknowledge a complete report within three business days, validate impact, coordinate a fix, and agree on disclosure timing. Please avoid public disclosure until a fix or mitigation is available.

## Local data flow

LocalKit accepts pasted text, user-selected Skill text files, redaction/policy JSON, and user-selected safe reports. Parsing, comparison, tokenization, redaction, and report generation happen in the current browser process.

The application has no business API, telemetry, analytics, advertising, error-reporting service, or third-party AI call. Production mode requests only same-origin HTML, JavaScript, CSS, the manifest, and Service Worker assets.

## Storage and downloads

- Tool inputs and results are not written to Local Storage, Session Storage, IndexedDB, cookies, or application logs.
- Recent tools, custom rules, and policies live only in React memory and disappear on refresh.
- Cache Storage contains same-origin static application assets, not user input or downloads.
- Downloads are created from a browser `Blob` only after a user action. The downloaded file is then controlled by the browser/operating system, not LocalKit.

## Context Package and Skill boundaries

- Context Package validation checks the implemented structure and static safety rules; it does not fetch `source.uri`, prove truth, or establish freshness.
- Skill validation reads a bounded set of user-selected text files. It never runs shell commands, scripts, package managers, dynamic imports, or network requests.
- Custom policies can only add warnings/blockers and cannot disable built-in checks.
- Passing static validation is not malware analysis or a guarantee that a Skill is safe to execute.

## Redaction and report boundaries

- Built-in detection is rule-based and can miss organization-specific identifiers.
- Custom redaction accepts only fixed text or simple linear masks; arbitrary regex, replacements, and executable matchers are rejected.
- Fail-closed limit errors do not produce partial redacted downloads.
- Safe reports use whitelist projections and omit input bodies, matched values, raw paths, filenames, and user policy identifiers.

## High-priority reports

- any input leaving the browser during a tool operation;
- input or result persistence after refresh through LocalKit-controlled storage;
- source bodies, matched values, raw paths, or secrets appearing in safe reports;
- script/command execution through YAML, Skill files, policies, or reports;
- path escape or reading files outside the user-selected Skill set;
- Service Worker cache poisoning or deletion of unrelated cache namespaces;
- offline fallback serving untrusted or cross-origin content.

See [README.md](README.md) and the [user guide](docs/USER_GUIDE.en.md) for verification steps and known limits.

## 中文说明

安全问题请使用 [GitHub 私密漏洞报告](https://github.com/mason2048/localkit-ai-dev-toolbox/security/advisories/new)，不要创建公开 Issue。复现必须使用人工构造数据，不要附带真实凭据、私有 Prompt、客户数据或专有 Skill；测试中暴露的凭据应先撤销并轮换。
