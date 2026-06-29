# Contributing to PermaBrain

First off, thanks for taking the time to contribute!

## Getting Started

### Prerequisites

- Node.js 20 or later
- npm

### Development Setup

```sh
git clone https://github.com/twilson63/permabrain.git
cd permabrain
npm install
npm link
```

Initialize a local PermaBrain home:

```sh
permabrain init
```

### Running Tests

```sh
npm test
```

Targeted test runs:

```sh
npm run test:transport-resilience
npm run test:hyperbeam
npm run test:wikipedia
npm run test:arweave
```

Transport integration tests (HyperBEAM, Wikipedia, Arweave) skip cleanly when dependencies are unavailable.

### Making Changes

1. Create a branch for your work: `git checkout -b feature/your-feature`
2. Make your changes
3. Run the test suite: `npm test`
4. Ensure no secrets, keys, or private data are in your changes
5. Push and open a pull request

## Pull Request Process

1. Ensure all tests pass (`npm test`)
2. Update the CHANGELOG.md with a note under [Unreleased] if your change is notable
3. Describe what your PR does and why
4. Link any related issues

## Coding Standards

- ES modules (`.mjs`) throughout
- No secrets, private keys, or credentials in any file
- Keep modules focused — one concern per file
- Test coverage: add tests for new functionality
- Use `PERMABRAIN_HOME` for configurable state paths, never hardcode

## Reporting Issues

Use the [GitHub issue tracker](https://github.com/twilson63/permabrain/issues). Please include:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (Node version, OS, permabrain version)

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.

## Security

If you find a security vulnerability, please see [SECURITY.md](SECURITY.md). **Do not open a public issue for security concerns.**
