# Contributing to Leapfrog

Thanks for your interest. Contributions are welcome -- bug fixes, tests, docs, and feature ideas.

## Setup

```bash
git clone https://github.com/anthropics/leapfrog.git
cd leapfrog
npm install
npx playwright install chromium
npm run build
npm test
```

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests if applicable
4. Run `npm test` and make sure everything passes
5. Open a PR against `main`

## Code Style

- **TypeScript** -- all source lives in `src/`
- **Vitest** -- tests live in `src/__tests__/`
- Keep functions focused. Small PRs merge faster than big ones.
- No lint config yet -- just match the existing style.

## Tests

Tests need Playwright's Chromium browser installed. If `npm test` fails with a browser error:

```bash
npx playwright install chromium
```

## Asking Questions

Open a [GitHub Issue](https://github.com/anthropics/leapfrog/issues). There's no Discord or forum -- issues are the place for questions, ideas, and bugs.

## Response Times

This is a solo-maintained project. I review PRs and issues as time allows. If something is urgent, note it in the issue and I'll prioritize accordingly.

## Security Issues

Do **not** open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md) for the disclosure process.
