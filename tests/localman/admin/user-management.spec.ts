import { expect, type Locator, type Page, type Response } from "@playwright/test";
import {
  createCriticalPageMonitor,
  expectPageNotBlank,
  expectPageReady,
  expectVisiblePageUi
} from "../../../utils/assertions";
import { expect as localExpect, test } from "../fixtures";

const ADMIN_LOGIN_PATH = "/admin/login";
const ADMIN_SESSION_STORAGE_KEY = "local-man-admin-session";
const ADMIN_USERS_CANDIDATE_PATHS = [
  "/admin/team",
  "/admin/users",
  "/admin/user-management",
  "/admin/accounts",
  "/admin/agents"
] as const;
const QA_PASSWORD = "Test123!";
const USER_CREATE_BUTTON_PATTERN = /create user|new user|add user|invite user/i;
const USER_SUBMIT_BUTTON_PATTERN = /create account|create user|save user|add user|invite user|create|save/i;
const USER_DELETE_BUTTON_PATTERN = /delete|remove|deactivate/i;
const USER_CONFIRM_BUTTON_PATTERN = /delete|remove|confirm|continue|yes/i;
const USER_ROUTE_SIGNAL_PATTERN = /users|accounts|team|agents|admins/i;
const DEFAULT_TIMEOUT = 20_000;

type Credentials = {
  email: string;
  password: string;
};

type QaUserRecord = {
  email: string;
  fullName: string;
  role: "admin" | "agent";
};

type VisibleUser = {
  email: string;
  role: string;
  text: string;
};

test.describe.serial("Local Man admin user management", () => {
  const credentials = getAdminCredentials();
  const suffix = Date.now().toString(36);
  const adminUser: QaUserRecord = {
    email: `qa_admin_${suffix}@test.com`,
    fullName: `QA Admin ${suffix}`,
    role: "admin"
  };
  const agentUser: QaUserRecord = {
    email: `qa_agent_${suffix}@test.com`,
    fullName: `QA Agent ${suffix}`,
    role: "agent"
  };

  test.afterAll(async ({ browser }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const context = await browser.newContext(typeof baseURL === "string" ? { baseURL } : {});
    const page = await context.newPage();

    try {
      await loginToAdmin(page, credentials);
      await gotoAdminUsers(page);

      for (const user of [agentUser, adminUser]) {
        await deleteUserIfVisible(page, user);
      }
    } finally {
      await context.close();
    }
  });

  test("admin can create and delete qa admin and agent users safely", async ({ page }) => {
    test.slow();

    await loginToAdmin(page, credentials);
    const adminUsersPath = await gotoAdminUsers(page);
    const monitor = createCriticalPageMonitor(page, {
      ignorePatterns: [/ERR_ABORTED/i]
    });

    await test.step("create qa admin user", async () => {
      await openCreateUserSurface(page);
      await fillUserForm(page, adminUser);
      await submitUserForm(page);
      await assertUserVisible(page, adminUser, adminUsersPath);
    });

    await test.step("create qa agent user", async () => {
      await openCreateUserSurface(page);
      await fillUserForm(page, agentUser);
      await submitUserForm(page);
      await assertUserVisible(page, agentUser, adminUsersPath);
    });

    await test.step("delete qa agent user", async () => {
      await deleteUser(page, agentUser, adminUsersPath);
      await assertUserAbsent(page, agentUser, adminUsersPath);
    });

    await test.step("delete qa admin user", async () => {
      await deleteUser(page, adminUser, adminUsersPath);
      await assertUserAbsent(page, adminUser, adminUsersPath);
    });

    await monitor.expectNoCriticalIssues();
  });
});

function getAdminCredentials(): Credentials {
  const email = process.env.LOCALMAN_ADMIN_EMAIL?.trim();
  const password = process.env.LOCALMAN_ADMIN_PASSWORD?.trim();

  if (!email || !password) {
    throw new Error("LOCALMAN_ADMIN_EMAIL and LOCALMAN_ADMIN_PASSWORD must be configured for Local Man admin user tests.");
  }

  return { email, password };
}

async function loginToAdmin(page: Page, credentials: Credentials) {
  await page.goto(ADMIN_LOGIN_PATH, { waitUntil: "domcontentloaded" });
  await expectAdminPageUsable(page, "Expected the Local Man admin login page to render visible UI.");

  await page.getByLabel(/^Email$/i).fill(credentials.email);
  await page.getByLabel(/^Password$/i).fill(credentials.password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();

  await page.waitForURL((url) => !url.pathname.endsWith(ADMIN_LOGIN_PATH), { timeout: DEFAULT_TIMEOUT });
  await expect(page).toHaveURL(/\/admin(\/|$)/);
  await waitForAuthenticatedAdminSession(page, credentials.email);
  await expectAdminPageUsable(page, "Expected Local Man admin UI to render after sign-in.");
}

async function gotoAdminUsers(page: Page): Promise<string> {
  for (const path of ADMIN_USERS_CANDIDATE_PATHS) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    if (response && response.status() >= 400) {
      continue;
    }

    await expectAdminPageUsable(page, `Expected the Local Man admin users page candidate "${path}" to render visible UI.`);
    await waitForAuthenticatedAdminSession(page).catch(() => undefined);
    await waitForUsersRefresh(page).catch(() => undefined);
    if (await hasUserManagementSurface(page)) {
      return safePathname(page.url()) || path;
    }
  }

  const usersNav = await findVisible([
    page.getByRole("link", { name: /users|manage users|accounts|team|agents|admins/i }),
    page.getByRole("button", { name: /users|manage users|accounts|team|agents|admins/i })
  ]);

  if (usersNav) {
    await usersNav.click();
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveURL(/\/admin(\/|$)/);
    await waitForAuthenticatedAdminSession(page).catch(() => undefined);
    await waitForUsersRefresh(page).catch(() => undefined);
    await expectAdminPageUsable(page, "Expected the Local Man admin users area to render after using admin navigation.");
    if (await hasUserManagementSurface(page)) {
      return safePathname(page.url()) || "/admin/users";
    }
  }

  throw new Error(
    `Could not find a Local Man admin user-management surface on any candidate route: ${ADMIN_USERS_CANDIDATE_PATHS.join(", ")}`
  );
}

async function hasUserManagementSurface(page: Page): Promise<boolean> {
  return Boolean(
    await findVisible(
      [
        page.getByRole("heading", { name: /users|manage users|accounts|team|agents|admins/i }),
        page.getByRole("button", { name: USER_CREATE_BUTTON_PATTERN }),
        page.getByLabel(/email/i),
        page.getByLabel(/role/i),
        page.locator("table, [role='table'], [role='grid'], [role='rowgroup'], ul, ol"),
        page.locator("form")
      ],
      3_000
    )
  );
}

async function openCreateUserSurface(page: Page) {
  await gotoAdminUsers(page);
  const emailInput = await getEmailInput(page, 1_500);
  const passwordInput = await getPasswordInput(page, 1_500);
  const submitButton = await findVisible([
    page.getByRole("button", { name: USER_SUBMIT_BUTTON_PATTERN }),
    page.locator("form button[type='submit']")
  ], 1_500);

  if (emailInput && passwordInput && submitButton) {
    return;
  }

  const createButton = await findVisible([
    page.getByRole("button", { name: USER_CREATE_BUTTON_PATTERN }),
    page.getByRole("link", { name: USER_CREATE_BUTTON_PATTERN })
  ]);

  localExpect(createButton, "Expected the Local Man admin users page to expose a Create User action.").not.toBeNull();
  await createButton!.click();
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);

  const createEmailInput = await getEmailInput(page, 5_000);
  localExpect(createEmailInput, "Expected a visible email input after opening the Local Man create-user surface.").not.toBeNull();
}

async function fillUserForm(page: Page, user: QaUserRecord) {
  const emailInput = await getEmailInput(page, 5_000);
  const passwordInput = await getPasswordInput(page, 5_000);
  const fullNameInput = await getFullNameInput(page, 2_000);

  localExpect(emailInput, "Expected the Local Man create-user form to expose an email field.").not.toBeNull();
  localExpect(passwordInput, "Expected the Local Man create-user form to expose a password field.").not.toBeNull();

  await emailInput!.fill(user.email);
  await passwordInput!.fill(QA_PASSWORD);
  if (fullNameInput) {
    await fullNameInput.fill(user.fullName);
  }
  await selectUserRole(page, user.role);
}

async function submitUserForm(page: Page) {
  await waitForAuthenticatedAdminSession(page).catch(() => undefined);
  const createResponsePromise = page
    .waitForResponse((response) => /\/api\/admin\/create-user/i.test(response.url()), { timeout: 10_000 })
    .catch(() => null);
  const usersRefreshPromise = waitForUsersRefresh(page).catch(() => null);
  const submitButton = await findVisible([
    page.getByRole("button", { name: USER_SUBMIT_BUTTON_PATTERN }),
    page.locator("form button[type='submit']")
  ]);

  localExpect(submitButton, "Expected the Local Man create-user form to expose a submit action.").not.toBeNull();
  await submitButton!.click();
  await Promise.allSettled([createResponsePromise, usersRefreshPromise]);
}

async function selectUserRole(page: Page, role: QaUserRecord["role"]) {
  const roleLabel = new RegExp(`^${escapeRegExp(role)}$`, "i");
  const roleTitle = role.charAt(0).toUpperCase() + role.slice(1);

  const select = await findVisible([
    page.getByLabel(/role/i),
    page.locator("select[name*='role' i]"),
    page.locator("select")
  ], 2_000);

  if (select) {
    try {
      await select.selectOption({ value: role });
      return;
    } catch {}

    try {
      await select.selectOption({ label: roleTitle });
      return;
    } catch {}

    const values = await select.locator("option").evaluateAll((options) =>
      options.map((option) => ({
        label: (option.textContent ?? "").trim(),
        value: (option as HTMLOptionElement).value.trim()
      }))
    );
    const match = values.find((option) => roleLabel.test(option.label) || roleLabel.test(option.value));
    if (match) {
      await select.selectOption(match.value);
      return;
    }
  }

  const combobox = await findVisible([
    page.getByRole("combobox", { name: /role/i }),
    page.getByRole("button", { name: /role/i })
  ], 2_000);

  if (combobox) {
    await combobox.click();
    const option = await findVisible([
      page.getByRole("option", { name: roleLabel }),
      page.getByRole("menuitem", { name: roleLabel }),
      page.getByRole("button", { name: roleLabel }),
      page.getByText(roleLabel).locator("xpath=ancestor::*[self::button or @role='option' or @role='menuitem'][1]")
    ], 2_000);
    if (option) {
      await option.click();
      return;
    }
  }

  const radio = await findVisible([
    page.getByLabel(roleLabel),
    page.getByRole("radio", { name: roleLabel })
  ], 2_000);
  if (radio) {
    await radio.check?.().catch(async () => {
      await radio.click();
    });
    return;
  }

  throw new Error(`Expected the Local Man create-user form to expose a selectable "${role}" role.`);
}

async function assertUserVisible(page: Page, user: QaUserRecord, usersPath: string) {
  await waitForUsersRefresh(page).catch(() => undefined);

  await expect
    .poll(
      async () => {
        const users = await getVisibleUsers(page, usersPath, user.email);
        return users.map((visibleUser) => visibleUser.email);
      },
      {
        timeout: 10_000,
        message: `Expected Local Man admin users list to show "${user.email}".`
      }
    )
    .toContain(user.email.toLowerCase());

  await expect
    .poll(
      async () => {
        const users = await getVisibleUsers(page, usersPath, user.email);
        return users.find((visibleUser) => visibleUser.email === user.email)?.role ?? null;
      },
      {
        timeout: 10_000,
        message: `Expected Local Man to show the "${user.role}" role for "${user.email}".`
      }
    )
    .toBe(user.role === "admin" ? "Admin" : "Agent");
}

async function assertUserAbsent(page: Page, user: QaUserRecord, usersPath: string) {
  await waitForUsersRefresh(page).catch(() => undefined);

  await expect
    .poll(
      async () => {
        const users = await getVisibleUsers(page, usersPath, user.email);
        return users.map((visibleUser) => visibleUser.email);
      },
      {
        timeout: 10_000,
        message: `Expected Local Man admin users list to remove "${user.email}".`
      }
    )
    .not.toContain(user.email.toLowerCase());
}

async function deleteUser(page: Page, user: QaUserRecord, usersPath: string) {
  localExpect(
    user.email.startsWith("qa_"),
    `Refusing to delete non-QA user "${user.email}". Only qa_* test users may be removed.`
  ).toBeTruthy();

  await gotoUsersPath(page, usersPath);
  await searchUsersIfSupported(page, user.email);

  let userSurface = await findUserSurface(page, user.email);
  localExpect(userSurface, `Expected Local Man admin users list to show "${user.email}" before deleting it.`).not.toBeNull();

  let deleteButton = await findVisible([
    userSurface!.getByRole("button", { name: USER_DELETE_BUTTON_PATTERN }),
    userSurface!.getByRole("link", { name: USER_DELETE_BUTTON_PATTERN })
  ], 2_000);

  if (!deleteButton) {
    await userSurface!.click().catch(() => undefined);
    deleteButton = await findVisible([
      page.getByRole("button", { name: USER_DELETE_BUTTON_PATTERN }),
      page.getByRole("link", { name: USER_DELETE_BUTTON_PATTERN })
    ], 2_000);
  }

  localExpect(deleteButton, `Expected a delete action for QA user "${user.email}".`).not.toBeNull();
  const mutationPromise = waitForUserMutationResponse(page, "DELETE").catch(() =>
    waitForUserMutationResponse(page, "PATCH").catch(() => waitForUserMutationResponse(page, "POST").catch(() => null))
  );
  const disappearancePromise = assertUserAbsent(page, user, usersPath);

  await deleteButton!.click();
  await confirmDeletionIfNeeded(page);
  await Promise.race([mutationPromise, disappearancePromise]);
  await assertUserAbsent(page, user, usersPath);
}

async function deleteUserIfVisible(page: Page, user: QaUserRecord) {
  if (!user.email.startsWith("qa_")) {
    return;
  }

  try {
    const usersPath = await gotoAdminUsers(page);
    await searchUsersIfSupported(page, user.email);
    const userSurface = await findUserSurface(page, user.email);
    if (!userSurface) {
      return;
    }

    await deleteUser(page, user, usersPath);
  } catch {
    return;
  }
}

async function confirmDeletionIfNeeded(page: Page) {
  const dialog = page
    .locator("[role='dialog'], [role='alertdialog']")
    .filter({ has: page.getByRole("button", { name: USER_CONFIRM_BUTTON_PATTERN }) })
    .first();
  const deadline = Date.now() + 2_000;

  while (Date.now() <= deadline) {
    if (await dialog.isVisible().catch(() => false)) {
      const confirmButton = dialog.getByRole("button", { name: USER_CONFIRM_BUTTON_PATTERN }).first();
      await localExpect(confirmButton, "Expected the Local Man delete-user modal to expose a confirm action.").toBeVisible();
      await confirmButton.click();
      return;
    }

    await page.waitForTimeout(100);
  }
}

async function waitForUserMutationResponse(page: Page, method: "POST" | "DELETE" | "PATCH"): Promise<Response> {
  const response = await page.waitForResponse(
    (candidate) =>
      candidate.request().method() === method &&
      (/\/api\/.*users/i.test(candidate.url()) || /\/admin_users\b/i.test(candidate.url())) &&
      candidate.status() < 500,
    { timeout: 10_000 }
  );

  localExpect(
    response.status(),
    `Expected Local Man user-management ${method} request to avoid server failure.`
  ).toBeLessThan(500);
  return response;
}

async function waitForUsersRefresh(page: Page): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      (/\/api\/admin\/team/i.test(response.url()) || /\/admin_users\b/i.test(response.url())) && response.status() === 200,
    { timeout: 10_000 }
  );
}

async function waitForAuthenticatedAdminSession(page: Page, expectedEmail?: string): Promise<void> {
  await expect(page).toHaveURL(/\/admin(\/|$)/);

  await expect
    .poll(async () => {
      const session = await readAdminSession(page);
      return Boolean(session?.accessToken && session?.accessToken.length > 0);
    })
    .toBe(true);

  if (expectedEmail) {
    await expect
      .poll(async () => {
        const session = await readAdminSession(page);
        return session?.email ?? null;
      })
      .toBe(expectedEmail);
  }
}

async function readAdminSession(page: Page): Promise<{ accessToken: string | null; email: string | null }> {
  return page.evaluate((storageKey) => {
    const rawValue = window.localStorage.getItem(storageKey);
    if (!rawValue) {
      return {
        accessToken: null,
        email: null
      };
    }

    try {
      const parsed = JSON.parse(rawValue) as {
        accessToken?: unknown;
        email?: unknown;
        user?: {
          email?: unknown;
        } | null;
      };

      const accessToken =
        typeof parsed.accessToken === "string" && parsed.accessToken.trim().length > 0 ? parsed.accessToken : null;
      const email =
        typeof parsed.email === "string" && parsed.email.trim().length > 0
          ? parsed.email
          : typeof parsed.user?.email === "string" && parsed.user.email.trim().length > 0
            ? parsed.user.email
            : null;

      return {
        accessToken,
        email
      };
    } catch {
      return {
        accessToken: null,
        email: null
      };
    }
  }, ADMIN_SESSION_STORAGE_KEY);
}

async function searchUsersIfSupported(page: Page, value: string) {
  const searchInput = await findVisible([
    page.getByLabel(/search/i),
    page.getByRole("searchbox"),
    page.getByRole("textbox", { name: /search/i }),
    page.locator("input[type='search'], input[name*='search' i]")
  ], 1_500);

  if (!searchInput) {
    return;
  }

  await searchInput.fill(value);
  const applyButton = await findVisible([
    page.getByRole("button", { name: /^Apply$/i }),
    page.getByRole("button", { name: /search|filter|apply/i })
  ], 1_000);

  if (applyButton && (await applyButton.isEnabled().catch(() => false))) {
    await applyButton.click();
  } else {
    await searchInput.press("Enter").catch(() => undefined);
  }

  await page.waitForLoadState("networkidle", { timeout: 1_500 }).catch(() => undefined);
}

async function findUserSurface(page: Page, email: string): Promise<Locator | null> {
  const emailPattern = new RegExp(escapeRegExp(email), "i");

  return findVisible([
    page.getByRole("row").filter({ hasText: emailPattern }),
    page.locator("[data-user-id], article, li, [role='listitem'], tr, [role='row']").filter({ hasText: emailPattern }),
    page.getByRole("button", { name: emailPattern }),
    page.getByRole("link", { name: emailPattern }),
    page.getByText(emailPattern).locator("xpath=ancestor::*[self::tr or @role='row' or self::li or self::article][1]")
  ], 2_000);
}

async function getVisibleUsers(page: Page, usersPath: string, searchEmail?: string): Promise<VisibleUser[]> {
  await gotoUsersPath(page, usersPath);
  if (searchEmail) {
    await searchUsersIfSupported(page, searchEmail);
  }

  const rows = page.getByRole("row").filter({ has: page.getByText(/@/) });
  const rowCount = await rows.count().catch(() => 0);
  const users: VisibleUser[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    if (!(await row.isVisible().catch(() => false))) {
      continue;
    }

    const cellTexts = await row.locator("td, [role='cell']").evaluateAll((cells) =>
      cells.map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean)
    );
    const text = normalizeText((cellTexts.length > 0 ? cellTexts.join(" ") : await row.textContent()) ?? "");
    const emailSource = cellTexts.find((value) => value.includes("@")) ?? text;
    const emailMatch = emailSource.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (!emailMatch) {
      continue;
    }

    const roleSource = cellTexts.find((value) => /^(Admin|Agent)$/i.test(value)) ?? text;
    const role = /^Admin$/i.test(roleSource) || /\bAdmin\b/i.test(roleSource) ? "Admin" : /^Agent$/i.test(roleSource) || /\bAgent\b/i.test(roleSource) ? "Agent" : "";
    users.push({
      email: emailMatch[0].toLowerCase(),
      role,
      text
    });
  }

  return users;
}

async function getEmailInput(page: Page, timeoutMs = 2_000): Promise<Locator | null> {
  return findVisible([
    page.getByLabel(/^Email$/i),
    page.getByRole("textbox", { name: /email/i }),
    page.locator("input[type='email']"),
    page.locator("input[name*='email' i]"),
    page.getByPlaceholder(/email/i)
  ], timeoutMs);
}

async function getPasswordInput(page: Page, timeoutMs = 2_000): Promise<Locator | null> {
  return findVisible([
    page.getByLabel(/^Password$/i),
    page.getByLabel(/temporary password/i),
    page.locator("input[type='password']"),
    page.locator("input[name*='password' i]"),
    page.getByPlaceholder(/password/i)
  ], timeoutMs);
}

async function getFullNameInput(page: Page, timeoutMs = 2_000): Promise<Locator | null> {
  return findVisible([
    page.getByLabel(/full name/i),
    page.locator("input[name*='full' i]"),
    page.locator("input[name*='name' i]"),
    page.getByPlaceholder(/operations agent|full name|name/i)
  ], timeoutMs);
}

async function gotoUsersPath(page: Page, usersPath: string) {
  await page.goto(usersPath, { waitUntil: "domcontentloaded" });
  await expectAdminPageUsable(page, "Expected the Local Man admin users page to remain usable.");
}

async function expectAdminPageUsable(page: Page, message: string) {
  await expectPageReady(page);
  await expectPageNotBlank(page);
  await expectVisiblePageUi(page, message);
}

async function findVisible(locators: Locator[], timeoutMs = 5_000): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    for (const locator of locators) {
      const count = await locator.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) {
          return candidate;
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return null;
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
