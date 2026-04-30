# E2E Tests (Playwright)

invoice-saas2 の Web アプリ向け E2E テストスイート。

## 前提

以下が起動済みであること:

| サービス | ポート |
|----------|--------|
| Next.js dev server | 3000 |
| Supabase (local) | 54331 |
| Python API | 8001 |

`apps/web/.env.local` に下記が設定されていること:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## セットアップ

```bash
cd apps/web
npm install
npx playwright install chromium
```

## 実行

```bash
# ヘッドレス
npm run test:e2e

# ブラウザ表示
npm run test:e2e:headed

# UI モード (debug 用)
npm run test:e2e:ui

# 単一 spec のみ
npx playwright test tests/e2e/specs/01-auth.spec.ts
```

オプション:

```bash
# baseURL を上書き
E2E_BASE_URL=http://localhost:3001 npm run test:e2e

# テストアカウントを上書き（既定: e2e-tester@example.com）
E2E_TEST_EMAIL=foo@example.com E2E_TEST_PASSWORD=Pass123! npm run test:e2e
```

## 認証バイパスの仕組み

Google OAuth はテストできないので、Playwright の `globalSetup` で以下を行う:

1. **テストユーザー作成**: `supabase.auth.admin.createUser()` を service_role で呼び、
   `e2e-tester@example.com` をパスワード `Playwright!E2E_4242` で冪等に作成。
2. **membership 紐付け**: 既存の組織 `a1b2c3d4-...` に owner として参加させる。
3. **password sign-in**: anon client で `signInWithPassword()` を実行してセッションを取得。
4. **storageState 生成**:
   - `@supabase/ssr` が読むクッキー名 `sb-127-auth-token` に
     `base64-${base64url(JSON.stringify(session))}` 形式で書き込む。
   - cookie のみで `tests/e2e/.auth/user.json` に保存。
5. 各テストはこの storageState を使って起動するので、ログイン済みで開始する。

注意点:
- service_role キーはテスト環境（`localhost:54331`）でのみ使うこと。本番では絶対に使わない。
- テストユーザーは `e2e-tester@example.com` 固定。実ユーザーには影響しない。
- 担当者割当テストは実 DB を変更するが、`finally` ブロックで元の状態に戻す。

## テスト一覧

| ファイル | 内容 |
|----------|------|
| `01-auth.spec.ts` | 認証フロー（ログイン済 / 未認証時のリダイレクト） |
| `02-dashboard.spec.ts` | ダッシュボード（12 件表示、リンク遷移） |
| `03-properties.spec.ts` | 物件一覧（月セレクタ、288 邸合計） |
| `04-assign.spec.ts` | 担当者割当（optimistic 更新、リロード保持） |
| `05-export.spec.ts` | Excel 出力 API（xlsx Content-Type、日本語ファイル名） |

## トラブルシューティング

### `SUPABASE_SERVICE_ROLE_KEY が未設定です`
`.env.local` が `apps/web/` に存在し、service_role キーが書かれているか確認する。

### `テストユーザー作成に失敗`
Supabase が `54331` で起動しているか、auth schema にアクセスできるか確認する。

### dashboard が空 / 12 件にならない
`payment_notices` テーブルのデータが存在することを前提にしている。
別 organization のデータで運用している場合、`tests/e2e/setup/auth.ts` の
`TEST_ORG_ID` を実際の組織 ID に書き換える。

### `ELIFECYCLE` などで Playwright が落ちる
`npx playwright install chromium` を再実行。
`tests/e2e/.artifacts/` を削除してリトライ。
