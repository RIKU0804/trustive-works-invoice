import { test, expect } from "@playwright/test";

/**
 * 物件一覧
 *  - 月セレクタが描画されている
 *  - 全 12 ヶ月分（実データ）の合計で 288 邸が DB に存在することを保証する
 *    ↓ そのため、各月の行数を合算したときに 288 になることを確認する
 *  - 担当者カラムが表示される
 */
test.describe("物件一覧", () => {
  test("月セレクタが存在し、デフォルト月で物件が表示される", async ({
    page,
  }) => {
    await page.goto("/properties");
    await expect(
      page.getByRole("heading", { name: "邸一覧" })
    ).toBeVisible();

    // MonthSelect は <select> として描画される想定
    const monthSelect = page.locator("select").first();
    await expect(monthSelect).toBeVisible();

    // option は 12 ヶ月分
    const options = monthSelect.locator("option");
    await expect(options).toHaveCount(12);

    // 担当者カラムヘッダー
    await expect(
      page.locator("table thead").getByText("担当者")
    ).toBeVisible();

    // 1 行以上表示されている
    const rows = page.locator("table tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("全月合算で 288 邸が表示される（実データ）", async ({ page }) => {
    await page.goto("/properties");
    const monthSelect = page.locator("select").first();
    const optionValues = await monthSelect.evaluate((el) =>
      Array.from((el as HTMLSelectElement).options).map((o) => o.value)
    );
    expect(optionValues.length).toBe(12);

    let total = 0;
    for (const value of optionValues) {
      await page.goto(
        `/properties?month=${encodeURIComponent(value)}`
      );
      // 物件テーブル or empty state のどちらかが描画される
      await page.waitForLoadState("domcontentloaded");
      const rows = page.locator("table tbody tr");
      const count = await rows.count();
      total += count;
    }

    expect(total).toBe(288);
  });

  test("月フィルタを変えると URL が更新される", async ({ page }) => {
    await page.goto("/properties");
    const monthSelect = page.locator("select").first();
    const values = await monthSelect.evaluate((el) =>
      Array.from((el as HTMLSelectElement).options).map((o) => o.value)
    );
    expect(values.length).toBeGreaterThanOrEqual(2);

    // 現在と違う月へ切替
    const initial = await monthSelect.inputValue();
    const next = values.find((v) => v !== initial)!;
    await monthSelect.selectOption(next);

    await page.waitForURL(/[?&]month=/);
    expect(page.url()).toContain(`month=${encodeURIComponent(next)}`);
  });
});
