You are working inside a reusable Playwright QA repository called web-app-qa-tests.

Goal:
Improve and complete this framework so it can test multiple web apps:
- Local Man
- KBean
- INSSA

Requirements:
- Keep TypeScript and Playwright.
- Keep one folder per app under tests/.
- Keep one page-object folder per app under pages/.
- Use .env variables for app URLs.
- Do not hardcode secrets.
- Do not create fake passing tests.
- Add stable selectors where possible.
- Add helpers only when repeated logic exists.
- Keep smoke tests quick and reliable.

For Local Man, improve coverage for:
- discovery page load
- map or fallback map rendering
- vendor card visibility
- vendor detail navigation
- call and directions buttons
- mobile overflow check

For KBean, improve coverage for:
- landing page load
- auth page load
- sign-in buttons visibility
- marketplace route smoke check if URL is known

For INSSA, improve coverage for:
- landing page load
- sign-in/onboarding route load
- main navigation buttons

After changes:
- Update README with commands.
- Run tests if possible.
- Summarize what changed and what still needs real credentials or environment access.
