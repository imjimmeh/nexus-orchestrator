import { test, expect } from "@playwright/test";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://localhost:3010/api";

function buildUser(prefix: string) {
  const unique = Date.now().toString(36);
  return {
    username: `${prefix}_${unique}`,
    email: `${prefix}_${unique}@example.com`,
    password: "TestPass123!",
  };
}

test.describe("Authentication (web ↔ api)", () => {
  test.beforeEach(async ({ request }) => {
    const health = await request.get(`${apiBaseUrl}/health`);
    expect(health.ok()).toBeTruthy();
  });

  test("registers via UI and lands on dashboard", async ({ page }) => {
    const user = buildUser("register");

    await page.goto("/register");
    await page.getByLabel("Username").fill(user.username);
    await page.getByLabel("Email").fill(user.email);
    await page.getByPlaceholder("••••••••").nth(0).fill(user.password);
    await page.getByPlaceholder("••••••••").nth(1).fill(user.password);
    await page.getByRole("button", { name: "Create Account" }).click();

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
  });

  test("logs in via UI with api-seeded user", async ({ page, request }) => {
    const user = buildUser("login");
    const registerResponse = await request.post(`${apiBaseUrl}/auth/register`, {
      data: {
        username: user.username,
        email: user.email,
        password: user.password,
      },
    });
    expect(registerResponse.ok()).toBeTruthy();

    await page.goto("/login");
    await page.getByLabel("Username").fill(user.username);
    await page.getByPlaceholder("Enter your password").fill(user.password);
    await page.getByRole("button", { name: "Sign In" }).click();

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
  });
});
