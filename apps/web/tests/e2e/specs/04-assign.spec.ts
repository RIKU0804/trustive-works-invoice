import { test, expect } from "@playwright/test";

/**
 * 担当者割当
 *  - select で担当者を変更すると optimistic に UI が更新される
 *  - 「未割当」を選んで保存できる
 *  - リロード後も状態が保持される
 *
 * 注意: 実 DB を使うため、テスト終了時に元の担当者へ巻き戻す finally ステップを入れる。
 */
test.describe("担当者割当", () => {
  test("担当者を変更 → optimistic 更新 → リロード後も保持", async ({ page }) => {
    // 1) ダッシュボード経由で完了済 notice を見つける
    await page.goto("/dashboard");
    const assignLink = page
      .getByRole("link", { name: "割当" })
      .first();
    await expect(assignLink).toBeVisible();
    const assignHref = await assignLink.getAttribute("href");
    expect(assignHref).toMatch(/^\/assign\//);
    await assignLink.click();
    await page.waitForURL(/\/assign\//);

    // 2) 割当テーブルが表示されるまで待機
    const tableRows = page.locator("table tbody tr");
    await expect(tableRows.first()).toBeVisible();

    const firstRow = tableRows.first();
    const select = firstRow.locator("select");
    await expect(select).toBeVisible();

    const initial = await select.inputValue();

    // staff option を取得
    const optionValues: string[] = await select.evaluate((el) =>
      Array.from((el as HTMLSelectElement).options).map((o) => o.value)
    );
    // 「未割当」(value="") + 少なくとも 1 名の staff
    expect(optionValues.length).toBeGreaterThan(1);

    // initial と違う値で staff option を 1 つ選ぶ（"" 以外）
    const candidate = optionValues.find((v) => v !== initial && v !== "");
    expect(candidate).toBeTruthy();

    try {
      // 3) 担当者を変更（optimistic 反映を確認）
      await select.selectOption(candidate!);
      await expect(select).toHaveValue(candidate!);

      // server action 完了を待つ。revalidate 後に同じ値が維持されている
      await page.waitForLoadState("networkidle");
      await expect(select).toHaveValue(candidate!);

      // 4) リロード後も保持
      await page.reload();
      const reloadedSelect = page
        .locator("table tbody tr")
        .first()
        .locator("select");
      await expect(reloadedSelect).toHaveValue(candidate!);

      // 5) 「未割当」(value="") に戻す
      await reloadedSelect.selectOption("");
      await expect(reloadedSelect).toHaveValue("");
      await page.waitForLoadState("networkidle");

      await page.reload();
      const finalSelect = page
        .locator("table tbody tr")
        .first()
        .locator("select");
      await expect(finalSelect).toHaveValue("");
    } finally {
      // 6) 元の状態に戻す（テスト独立性のため）
      const restore = page
        .locator("table tbody tr")
        .first()
        .locator("select");
      await restore.selectOption(initial);
      await page.waitForLoadState("networkidle");
    }
  });
});
