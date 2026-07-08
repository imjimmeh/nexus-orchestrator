import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://localhost:3010/api";

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    username: string;
    email: string;
    roles: string[];
    createdAt: string;
  };
};

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
};

function uniqueTag(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}`;
}

async function registerUser(request: APIRequestContext): Promise<AuthSession> {
  const tag = uniqueTag("session");
  const payload = {
    username: tag,
    email: `${tag}@example.com`,
    password: "TestPass123!",
  };

  const response = await request.post(`${apiBaseUrl}/auth/register`, {
    data: payload,
  });

  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as ApiEnvelope<AuthSession>;
  return body.data;
}

async function loginUser(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<AuthSession | null> {
  const response = await request.post(`${apiBaseUrl}/auth/login`, {
    data: { username, password, rememberMe: false },
  });

  if (!response.ok()) {
    return null;
  }

  const body = (await response.json()) as ApiEnvelope<AuthSession>;
  return body.data;
}

async function resolveSession(
  request: APIRequestContext,
): Promise<AuthSession | null> {
  const envUsername = process.env.E2E_USERNAME;
  const envPassword = process.env.E2E_PASSWORD;

  if (envUsername && envPassword) {
    return loginUser(request, envUsername, envPassword);
  }

  return registerUser(request);
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

async function getFirstWorkflowId(
  request: APIRequestContext,
  accessToken: string,
): Promise<string | null> {
  const response = await request.get(
    `${apiBaseUrl}/workflows?limit=20&offset=0`,
    {
      headers: authHeaders(accessToken),
    },
  );

  if (!response.ok()) {
    return null;
  }

  const body = (await response.json()) as ApiEnvelope<Array<{ id: string }>>;
  return body.data[0]?.id ?? null;
}

async function executeWorkflow(
  request: APIRequestContext,
  accessToken: string,
  workflowId: string,
): Promise<string | null> {
  const response = await request.post(
    `${apiBaseUrl}/workflows/${workflowId}/execute`,
    {
      headers: authHeaders(accessToken),
      data: { trigger_data: { source: "playwright-active-session-e2e" } },
    },
  );

  if (!response.ok()) {
    return null;
  }

  const body = (await response.json()) as ApiEnvelope<{ runId: string }>;
  return body.data.runId;
}

async function getOrCreateProjectId(
  request: APIRequestContext,
  accessToken: string,
): Promise<string | null> {
  const listResponse = await request.get(`${apiBaseUrl}/projects`, {
    headers: authHeaders(accessToken),
  });

  if (!listResponse.ok()) {
    return null;
  }

  const listBody = (await listResponse.json()) as ApiEnvelope<
    Array<{ id: string }>
  >;
  if (listBody.data.length > 0) {
    return listBody.data[0].id;
  }

  const createResponse = await request.post(`${apiBaseUrl}/projects`, {
    headers: authHeaders(accessToken),
    data: {
      name: `e2e-project-${Date.now().toString(36)}`,
      description: "Playwright active session e2e project",
    },
  });

  if (!createResponse.ok()) {
    return null;
  }

  const createBody = (await createResponse.json()) as ApiEnvelope<{
    id: string;
  }>;
  return createBody.data.id;
}

async function createWorkItem(
  request: APIRequestContext,
  accessToken: string,
  projectId: string,
  title: string,
): Promise<string> {
  const response = await request.post(
    `${apiBaseUrl}/projects/${projectId}/work-items`,
    {
      headers: authHeaders(accessToken),
      data: {
        type: "task",
        title,
        description: "Playwright active session e2e work item",
        status: "backlog",
        priority: "p2",
      },
    },
  );

  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as ApiEnvelope<{ id: string }>;
  return body.data.id;
}

async function bindRunToWorkItem(
  request: APIRequestContext,
  accessToken: string,
  projectId: string,
  workItemId: string,
  runId: string,
): Promise<void> {
  const response = await request.patch(
    `${apiBaseUrl}/projects/${projectId}/work-items/${workItemId}/status`,
    {
      headers: authHeaders(accessToken),
      data: {
        status: "backlog",
        currentExecutionId: runId,
      },
    },
  );

  expect(response.ok()).toBeTruthy();
}

async function seedAuthenticatedBrowser(
  page: Page,
  session: AuthSession,
): Promise<void> {
  await page.addInitScript((data) => {
    localStorage.setItem("nexus_token", data.accessToken);
    localStorage.setItem(
      "nexus-auth-storage",
      JSON.stringify({
        state: {
          user: data.user,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        },
        version: 0,
      }),
    );
  }, session);
}

test.describe("Active Session Workspace (web ↔ api)", () => {
  test("injects operator guidance into a bound run", async ({
    page,
    request,
  }) => {
    const health = await request.get(`${apiBaseUrl}/health`);
    expect(health.ok()).toBeTruthy();

    const session = await resolveSession(request);
    test.skip(
      !session,
      "Unable to authenticate test user. Provide E2E_USERNAME/E2E_PASSWORD or ensure registration is available.",
    );

    const workflowId = await getFirstWorkflowId(request, session!.accessToken);
    test.skip(
      !workflowId,
      "No workflows available. Complete setup/seed workflows first.",
    );

    const projectId = await getOrCreateProjectId(request, session!.accessToken);
    test.skip(
      !projectId,
      "No project available and user cannot create one (admin required).",
    );

    const runId = await executeWorkflow(
      request,
      session!.accessToken,
      workflowId as string,
    );
    test.skip(
      !runId,
      "Workflow execution is not available for this user/environment.",
    );

    const workItemTitle = `active-session-${Date.now().toString(36)}`;
    const workItemId = await createWorkItem(
      request,
      session!.accessToken,
      projectId as string,
      workItemTitle,
    );

    await bindRunToWorkItem(
      request,
      session!.accessToken,
      projectId as string,
      workItemId,
      runId as string,
    );

    await seedAuthenticatedBrowser(page, session!);

    await page.goto(
      `/projects/${projectId}/work-items/${workItemId}/active-session`,
    );

    await expect(
      page.getByRole("heading", { name: "Active Session Workspace" }),
    ).toBeVisible();
    await expect(page.getByText(workItemTitle)).toBeVisible();

    const guidance = `Please commit the changes from e2e at ${Date.now().toString(36)}`;
    const chatInput = page.getByPlaceholder(
      "Inject guidance to the running agent",
    );

    await chatInput.fill(guidance);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(chatInput).toHaveValue("", { timeout: 15000 });
    await expect(page.getByText(guidance)).toBeVisible({ timeout: 20000 });
  });
});
