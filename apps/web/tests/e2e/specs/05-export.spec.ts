import { test, expect } from "@playwright/test";

/**
 * Excel 出力
 *  - 月選択画面が表示される
 *  - /api/export?month=YYYY-MM&format=xlsx が xlsx を返す
 *  - Content-Type が xlsx
 *  - ファイル名が日本語を含む
 *
 * 既知のバグ: ExportForm は select 値として "YYYY-MM-DD" を渡してしまい、
 * /api/export は "YYYY-MM" のみ受け付ける。本テストでは API を直接叩いて
 * 動作することを確認する（UI 経由でのダウンロードは未対応）。
 */
test.describe("Excel 出力", () => {
  test("Excel 出力ページが表示される", async ({ page }) => {
    await page.goto("/export");
    await expect(
      page.getByRole("heading", { name: "Excel出力" })
    ).toBeVisible();

    // ダウンロードボタンが少なくとも 1 つ
    const downloadButton = page.getByRole("button", {
      name: /Excelダウンロード/,
    });
    expect(await downloadButton.count()).toBeGreaterThan(0);
  });

  test("API から xlsx ファイルがダウンロードできる", async ({ page, request }) => {
    // 既知データの月（2025-10）を直接叩く
    const response = await request.get("/api/export?month=2025-10&format=xlsx");
    expect(response.status()).toBe(200);

    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    const disposition = response.headers()["content-disposition"] ?? "";
    // ファイル名は legacy 形式（日本語含む）
    expect(disposition).toMatch(/filename\*?=/);
    // RFC 5987 形式に日本語（URL エンコード）が含まれる、
    // または素のファイル名内に日本語が含まれる
    const looksJapanese =
      /%E3%|%E4%|%E5%|%E6%|%E7%|%E8%|%E9%/.test(disposition) ||
      /[　-鿿]/.test(disposition);
    expect(looksJapanese).toBe(true);

    // バイナリが空でない
    const buffer = await response.body();
    expect(buffer.byteLength).toBeGreaterThan(100);

    // xlsx は ZIP なので magic number "PK"
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);

    // 副次的: page を一度 navigate しておくことで auth 適用を保証
    await page.goto("/export");
  });

  test("不正な月パラメータは 400 を返す", async ({ request }) => {
    const response = await request.get("/api/export?month=invalid&format=xlsx");
    expect(response.status()).toBe(400);
  });
});
