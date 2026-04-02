# Security Policy

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email **info@lakesidecreativelabs.com** with:

- Description of the vulnerability
- Steps to reproduce
- Impact assessment (what an attacker could do)
- Any suggested fix, if you have one

## Response Timeline

This is a solo-maintained open-source project. I'll do my best to:

- **Acknowledge** your report within 72 hours
- **Triage** and confirm the issue within 1 week
- **Ship a fix** as soon as reasonably possible, depending on severity

Critical issues (arbitrary code execution, data exfiltration) get top priority.

## Scope

The following are considered security issues:

- **SSRF bypasses** -- circumventing URL validation to reach internal networks
- **XSS in snapshots** -- injected content in snapshot output that could be executed
- **Arbitrary code execution** -- escaping the browser sandbox or exploiting eval
- **Profile data leaks** -- saved auth profiles exposed or accessible cross-session
- **URL scheme bypass** -- accessing `file://`, `javascript:`, or other blocked schemes
- **Path traversal** -- escaping profile directory boundaries

The following are **not** in scope:

- Vulnerabilities in Playwright or Chromium themselves (report upstream)
- Denial of service via resource exhaustion (known limitation of local tools)
- Issues requiring local machine access (this runs locally by design)

## Supported Versions

Only the latest published version receives security updates.

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
| < Latest | No       |

## Disclosure

Once a fix is released, the vulnerability will be documented in the CHANGELOG. I'm happy to credit reporters unless they prefer anonymity.
