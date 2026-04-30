import { test, expect } from "@playwright/test";

/**
 * 認証フロー
 *  - storageState で既にログイン済み状態として開始
 *  - /dashboard に到達できる
 *  - storageState を破棄したコンテキストでは /login にリダイレクトされる
 */
test.describe("認証", () => {
  test("ログイン済み状態で /dashboard を表示できる", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", { name: "ダッシュボード", level: 1 })
    ).toBeVisible();
  });

  test("未認証コンテキストでは /login にリダイレクトされる", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    const response = await page.goto("/dashboard");
    // middleware が /login に redirect する
    await expect(page).toHaveURL(/\/login/);
    expect(response?.ok()).toBeTruthy();
    await context.close();
  });
});
