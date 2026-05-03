Add a new web app target to this Playwright QA framework.

Inputs:
- App name: <APP_NAME>
- Base URL env variable: <APP_NAME>_URL
- Test folder: tests/<app-name>
- Page object folder: pages/<app-name>

Tasks:
1. Add a Playwright project in playwright.config.ts.
2. Add npm script in package.json.
3. Add a basic smoke test.
4. Add a page object.
5. Update .env.example.
6. Update README.

Rules:
- Do not hardcode secrets.
- Keep naming consistent.
- Do not modify unrelated app tests.
