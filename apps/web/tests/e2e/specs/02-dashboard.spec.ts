import { test, expect } from "@playwright/test";

/**
 * ダッシュボード
 *  - 12 件の支払通知が一覧表示される（実データ前提）
 *  - 行のリンクから preview / assign ページへ遷移できる
 */
test.describe("ダッシュボード", () => {
  test("支払通知の一覧が表示される（12 件）", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: "ダッシュボード" })
    ).toBeVisible();

    // table の tbody 行数を assert
    const rows = page.locator("table tbody tr");
    await expect(rows).toHaveCount(12);

    // 「完了」ステータスバッジが少なくとも 1 件存在
    await expect(
      page.locator("table tbody").getByText("完了").first()
    ).toBeVisible();
  });

  test("行のアクションリンクから詳細ページに遷移できる", async ({ page }) => {
    await page.goto("/dashboard");
    const firstRow = page.locator("table tbody tr").first();
    // first() を付けて、月詳細/割当/詳細 のどれか一つを取得
    const actionLink = firstRow.getByRole("link", { name: /割当|詳細/ }).first();
    await expect(actionLink).toBeVisible();

    const href = await actionLink.getAttribute("href");
    expect(href).toMatch(/^\/(assign|preview|month)\//);

    await actionLink.click();
    await page.waitForURL(/\/(assign|preview|month)\//);
    expect(page.url()).toMatch(/\/(assign|preview|month)\//);
  });
});
