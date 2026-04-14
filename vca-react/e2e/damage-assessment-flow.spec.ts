import { test, expect } from "@playwright/test";
import { attachDamageAssessmentE2eMocks, E2E_CLAIM_ID } from "./api-mock";

test.describe("Damage assessment cards + drawer", () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });
    (page as unknown as { _vcaErrors: string[] })._vcaErrors = errors;

    await attachDamageAssessmentE2eMocks(page);
  });

  function assertNoPageErrors(page: import("@playwright/test").Page) {
    const list = (page as unknown as { _vcaErrors?: string[] })._vcaErrors ?? [];
    const filtered = list.filter(
      (m) =>
        !m.includes("favicon") &&
        !m.includes("ResizeObserver") &&
        !m.includes("404") &&
        !m.includes("React Router Future Flag")
    );
    expect(filtered, `Console/page errors: ${JSON.stringify(filtered)}`).toEqual([]);
  }

  test("login, claims list, claim detail, four cards, drawers, refresh, keyboard close", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("e2e");
    await page.getByLabel("Password").fill("any");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    await page.goto("/claims");
    await expect(page.getByRole("heading", { name: /Claims List/i })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("link", { name: /View claim/i }).first().click();
    await expect(page).toHaveURL(new RegExp(`/claims/${E2E_CLAIM_ID}`));

    await page.getByRole("tab", { name: /Damage Assessment/i }).click();

    const panel = page.getByTestId("damage-assessment-cards-panel");
    await expect(panel).toBeVisible({ timeout: 20_000 });

    await expect(page.getByTestId("da-summary-card-image_authenticity")).toBeVisible();
    await expect(page.getByTestId("da-summary-card-duplicate_screening")).toBeVisible();
    await expect(page.getByTestId("da-summary-card-estimated_value")).toBeVisible();
    await expect(page.getByTestId("da-summary-card-damage_detection")).toBeVisible();

    await page.getByTestId("da-view-details-image_authenticity").click();
    const drawer = page.getByTestId("damage-assessment-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Claim context", { exact: true })).toBeVisible();
    await expect(drawer.getByText("Figures & metrics")).toBeVisible();
    await expect(drawer.getByText("E2E narrative summary from backend.")).toBeVisible();

    const refreshBtn = page.locator("#da-drawer-refresh");
    await expect(refreshBtn).toBeFocused();
    await refreshBtn.click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(/#1/)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("damage-assessment-drawer")).toHaveCount(0);

    await page.getByTestId("da-view-details-duplicate_screening").click();
    await expect(page.getByTestId("damage-assessment-drawer")).toBeVisible();
    await expect(
      page.getByText("E2E duplicate headline specific to this claim")
    ).toBeVisible();
    expect(await page.getByText("How screening works").count()).toBe(0);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("damage-assessment-drawer")).toHaveCount(0);

    await page.getByTestId("da-view-details-estimated_value").click();
    await expect(page.getByText("Valuation narrative from backend.")).toBeVisible();
    await expect(page.getByText("Gross estimate").first()).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("damage-assessment-drawer")).toHaveCount(0);

    await page.getByTestId("da-view-details-damage_detection").click();
    const drawerDd = page.getByTestId("damage-assessment-drawer");
    await expect(page.getByText("Scratch and dent noted in E2E.")).toBeVisible();
    await expect(
      drawerDd.getByLabel("Assessment status: Incomplete")
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("damage-assessment-drawer")).toHaveCount(0);
    await page.getByTestId("da-view-details-image_authenticity").click();
    await expect(page.getByTestId("damage-assessment-drawer")).toBeVisible();

    assertNoPageErrors(page);
  });

  test("partial card summary shows caveat; drawer close then reopen works", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "vca_user",
        JSON.stringify({
          id: 1,
          username: "e2e",
          email: "e2e@test.local",
          first_name: "E2E",
          last_name: "User",
        })
      );
      localStorage.setItem("vca_token", "e2e-test-token");
    });

    await page.goto(`/claims/${E2E_CLAIM_ID}`);
    await page.getByRole("tab", { name: /Damage Assessment/i }).click();

    await expect(
      page.getByTestId("da-summary-card-damage_detection").getByText(/low confidence/i)
    ).toBeVisible();

    await page.getByTestId("da-view-details-damage_detection").click();
    await expect(page.getByTestId("damage-assessment-drawer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("damage-assessment-drawer")).toHaveCount(0);
    await page.getByTestId("da-view-details-damage_detection").click();
    await expect(page.getByTestId("damage-assessment-drawer")).toBeVisible();
  });
});
