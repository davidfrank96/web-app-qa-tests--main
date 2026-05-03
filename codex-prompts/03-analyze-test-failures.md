Analyze the latest Playwright failures.

Tasks:
1. Identify failed tests.
2. Group each failure by likely cause:
   - app bug
   - test selector issue
   - environment/config issue
   - network/timing issue
   - auth/permissions issue
3. Explain the root cause in plain English.
4. Suggest the smallest safe fix.
5. Patch only the necessary files.
6. Do not weaken tests just to make them pass.
7. Tell me whether the build is safe to merge or should be blocked.

Use available Playwright traces, screenshots, and error logs if present.
