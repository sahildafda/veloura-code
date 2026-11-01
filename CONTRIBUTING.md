# Contributing to Veloura Code

Thank you for your interest in contributing to **Veloura Code**!

---

## Development Setup

1. **Clone & Install**:
   ```bash
   cd E:\Software\veloura-code
   npm install
   ```

2. **Run in Development Mode (Live TS Execution)**:
   ```bash
   npm run dev -- --help
   ```

3. **Run Test Suites**:
   ```bash
   npm test
   ```

4. **Type Check**:
   ```bash
   npm run lint
   ```

5. **Build Distribution**:
   ```bash
   npm run build
   ```

---

## Architecture Principles for Contributors

- **Zero Cloud Storage**: All persistent data must be saved to the local SQLite database via `LocalDatabase`.
- **Zod Validation**: All new tool arguments, configurations, and external inputs must be validated with Zod schemas.
- **Cross-Platform Compatibility**: Paths must use Node's `node:path` normalization; shell commands must support Windows (`cmd.exe`/PowerShell) and POSIX shells.
- **Privacy First**: Any code that sends text to OpenRouter must pass through `ContextManager.sanitizeMessages()`.
- **No Mocking in Production**: Tests may mock external AI responses, but the production engine must execute real filesystem and terminal tools.

---

## Submitting Pull Requests

1. Create a feature branch (`git checkout -b feat/my-feature`).
2. Verify all tests pass (`npm test`).
3. Ensure no TypeScript errors (`npm run lint`).
4. Commit your changes and open a pull request.
