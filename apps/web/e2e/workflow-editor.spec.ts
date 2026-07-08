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

test.describe("Workflow Editor", () => {
  test("creates a workflow and redirects to detail page", async ({
    page,
    request,
  }) => {
    const user = buildUser("workflow_editor");

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

    await page.goto("/workflows/new");
    await expect(
      page.getByRole("heading", { name: "Create Workflow" }),
    ).toBeVisible();

    await page.getByLabel("Name").fill("E2E Test Workflow");

    const yamlContent = `workflow_id: e2e_test_workflow
name: E2E Test Workflow
trigger:
  type: webhook
jobs: []
`;
    await page.locator(".monaco-editor").click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type(yamlContent);

    await page.getByRole("button", { name: "Save Workflow" }).click();

    await expect(page).toHaveURL(
      /\/workflows\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    );

    await expect(page.getByText("E2E Test Workflow")).toBeVisible();
  });
});
