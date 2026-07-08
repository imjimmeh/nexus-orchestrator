import { test, expect } from "@playwright/test";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://localhost:3010/api";

test.describe("Workflows", () => {
  test("should display workflows page for authenticated user", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const username = `workflow_${unique}`;
    const password = "TestPass123!";
    const email = `workflow_${unique}@example.com`;

    const registerResponse = await request.post(`${apiBaseUrl}/auth/register`, {
      data: { username, email, password },
    });
    expect(registerResponse.ok()).toBeTruthy();

    await page.goto("/login");
    await page.getByLabel("Username").fill(username);
    await page.getByPlaceholder("Enter your password").fill(password);
    await page.getByRole("button", { name: "Sign In" }).click();

    await expect(page).toHaveURL("/");

    await page.goto("/workflows");
    await expect(page.locator("h2")).toContainText("Workflows");
  });
});
