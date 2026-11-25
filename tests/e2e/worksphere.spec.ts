import { expect, test } from "@playwright/test";

test.describe("WorkSphere Core User Journeys (WS-703)", () => {
  test("renders pure-light bilingual landing page and protects /app routes", async ({ page }) => {
    await page.goto("/th");
    await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
    await expect(page.getByRole("link", { name: /เข้าสู่ระบบ/i }).first()).toBeVisible();

    // Switch language to English
    await page.goto("/en");
    await expect(page.getByRole("link", { name: /Log in/i }).first()).toBeVisible();

    // Unauthenticated access to /en/app must redirect to /en/login
    await page.goto("/en/app");
    await expect(page).toHaveURL(/\/en\/login/);
  });

  test("full onboarding -> organization -> project -> Kanban task -> comment & analytics flow", async ({
    page,
  }) => {
    const uniqueSuffix = Date.now().toString(36);
    const email = `e2e.${uniqueSuffix}@worksphere.local`;

    // 1. Register a fresh account
    await page.goto("/en/register");
    await page.getByLabel(/Full name/i).fill("E2E Engineer");
    await page.getByLabel(/Work email/i).fill(email);
    await page.getByLabel(/Password/i).fill("StrongPass#2026");
    await page.getByRole("button", { name: /Create account/i }).click();

    // 2. Create first Organization on onboarding screen
    await expect(page).toHaveURL(/\/en\/app/);
    await page.getByLabel(/Organization name/i).fill(`Acme ${uniqueSuffix}`);
    await page.getByLabel(/Organization slug/i).fill(`acme-${uniqueSuffix}`);
    await page.getByRole("button", { name: /Create organization/i }).click();

    // 3. Navigate to Projects & create a Project
    await page.goto("/en/app/projects");
    await page.getByRole("button", { name: /New project/i }).click();
    await page.getByLabel(/Project name/i).fill("Platform Launch");
    await page.getByLabel(/Key/i).fill("PLT");
    await page.getByRole("button", { name: /Create project/i }).click();

    await page.getByRole("link", { name: /Open board/i }).first().click();
    await expect(page.getByRole("heading", { name: "Platform Launch" })).toBeVisible();

    // 4. Create a Task on the Kanban Board
    await page.getByRole("button", { name: /New task/i }).click();
    await page.getByPlaceholder(/What needs to be done/i).fill("Ship Phase 7 E2E Suite");
    await page.getByRole("button", { name: /^Add$/i }).click();
    await expect(page.getByText("PLT-1")).toBeVisible();

    // 5. Open Task Drawer & post a Comment
    await page.getByText("Ship Phase 7 E2E Suite").click();
    await page.getByPlaceholder(/Write an update or comment/i).fill("Verified by Playwright @E2E");
    await page.locator("form").filter({ hasText: /Send|Comment/i }).locator("button[type='submit']").first().click().catch(async () => {
      await page.keyboard.press("Enter");
    });

    // 6. Inspect Project Analytics Tab
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Analytics/i }).click();
    await expect(page.getByText(/Completion Rate/i)).toBeVisible();
  });
});
