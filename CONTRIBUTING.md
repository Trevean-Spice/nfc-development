# Contributing to Trevean Spice NFC Prototype

Thank you for your interest in contributing to the NFC Smart Packaging project. This guide helps ensure smooth collaboration between the Trevean Spice and Microgroove teams.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Branching Strategy](#branching-strategy)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Testing Requirements](#testing-requirements)
- [Documentation](#documentation)
- [Reporting Issues](#reporting-issues)

## Getting Started

1. Ensure you have been added as a collaborator to the repository.
2. Clone the repository and follow the setup instructions in the [README](README.md).
3. Create a new branch from `develop` for your work (see [Branching Strategy](#branching-strategy)).
4. Make your changes, write tests, and submit a pull request.

## Development Workflow

We use a **Git Flow** branching model adapted for our two-team collaboration:

1. Pull the latest changes from `develop`.
2. Create a feature branch following the naming convention below.
3. Develop and test locally.
4. Push your branch and open a pull request against `develop`.
5. Address review feedback.
6. Once approved, the branch will be merged by a maintainer.

## Branching Strategy

### Branch Types

| Branch | Purpose | Naming Convention | Base Branch |
|--------|---------|------------------|-------------|
| `main` | Production-ready releases | — | — |
| `develop` | Integration branch for features | — | `main` |
| `feature/*` | New features and enhancements | `feature/short-description` | `develop` |
| `bugfix/*` | Bug fixes | `bugfix/short-description` | `develop` |
| `hotfix/*` | Urgent production fixes | `hotfix/short-description` | `main` |
| `release/*` | Release preparation | `release/vX.Y.Z` | `develop` |

### Naming Examples

```
feature/nfc-tap-to-discover
feature/graphql-api-content-retrieval
bugfix/read-distance-timeout
hotfix/landing-page-404
release/v0.1.0
```

### Rules

- Never push directly to `main` or `develop`.
- All changes must go through a pull request.
- Delete branches after merging.

## Commit Messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes |
| `style` | Code formatting (no logic changes) |
| `refactor` | Code restructuring (no feature or fix) |
| `test` | Adding or updating tests |
| `chore` | Build process, tooling, or dependency updates |
| `perf` | Performance improvements |

### Examples

```
feat(api): add GraphQL endpoint for spice blend content
fix(nfc): resolve NTAG 216 read timeout on Android 12+
docs(readme): update installation instructions for mobile SDK
test(web): add integration tests for landing page rendering
chore(ci): configure GitHub Actions for automated testing
```

## Pull Request Process

1. **Create your PR** against the `develop` branch.
2. **Fill out the PR template** with a clear description, related issues, and testing steps.
3. **Ensure all checks pass** — CI tests, linting, and build must succeed.
4. **Request a review** from at least one team member:
   - Trevean team for product/content changes.
   - Microgroove team for technical/architecture changes.
5. **Address feedback** promptly and re-request review when ready.
6. **Merge** — PRs require at least one approval. Use "Squash and merge" for feature branches.

### PR Checklist

Before submitting, confirm:

- [ ] Code follows the project style guide.
- [ ] Tests have been added or updated for the changes.
- [ ] Documentation has been updated if needed.
- [ ] No secrets, API keys, or credentials are included.
- [ ] The branch is up to date with `develop`.

## Code Style

### TypeScript / JavaScript

- Use **TypeScript** for all new code.
- Follow the project ESLint and Prettier configuration.
- Use meaningful variable and function names.
- Prefer `const` over `let`; avoid `var`.
- Use async/await over raw promises.
- Export types and interfaces explicitly.

### File Organization

- One component or module per file.
- Group related files in descriptive directories.
- Keep files under 300 lines where practical.
- Use index files for clean module exports.

### Linting

```bash
npm run lint        # Check for issues
npm run lint:fix    # Auto-fix where possible
```

## Testing Requirements

All pull requests must include appropriate tests:

| Change Type | Required Tests |
|------------|----------------|
| New API endpoint | Unit tests + integration tests |
| UI component | Unit tests + snapshot tests |
| NFC utility | Unit tests + device matrix notes |
| Bug fix | Regression test covering the fixed behavior |
| Configuration | Validation test |

### Running Tests

```bash
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:int      # Integration tests only
npm run test:e2e      # End-to-end tests
npm run test:coverage # Generate coverage report
```

### Coverage Targets

- **80%+** code coverage on new code.
- **95%+** on critical paths (NFC read flow, API content delivery).

## Documentation

- Update `docs/` when adding or changing features.
- Add JSDoc comments to all public functions and interfaces.
- Keep the README current with any setup or usage changes.
- Document API changes in the API reference.

## Reporting Issues

Use [GitHub Issues](https://github.com/Trevean-Spice/nfc-prototype/issues) to report bugs or request features.

### Bug Reports

Please include: a clear title, steps to reproduce, expected vs. actual behavior, device/OS/browser info (especially for NFC issues), and screenshots or logs if applicable.

### Feature Requests

Please include: a clear description, the problem it solves, and any relevant context from the development proposal.

---

Thank you for helping build the future of spice technology.
