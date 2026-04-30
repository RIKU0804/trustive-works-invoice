# 05. API仕様

Next.js App Routerの **Server Actions** を主軸に、ファイルアップロードや重い処理は **Route Handlers** を使う。

## 認証

すべてのAPIは Supabase セッションでガード。Server Actions / Route Handlers の冒頭で：

```typescript
import { createServerClient } from '@/lib/supabase/server';

const supabase = createServerClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) throw new UnauthorizedError();
```

## 組織コンテキスト

ユーザーは複数組織に所属可能なので、リクエストに `currentOrganizationId` を含める（Cookie or Server Component経由）。クエリ時は必ず `organization_id` でフィルタ。RLSが二重で守ってくれる。

## エンドポイント一覧

### 1. PDFアップロード＆パース

**`POST /api/pdf/parse`**

ファイルアップロード→パース→preview用の一時データを返す（DB保存はしない）。確定はクライアント側で別アクション。

**Request**: `multipart/form-data`
- `file`: PDFファイル

**Response**:
```typescript
{
  paymentNoticeDraft: {
    fileName: string;
    storagePath: string;     // アップロード済みのStorage path
    paymentDate: string | null;
    reportMonth: string;     // YYYY-MM-DD
    constructionTotal: number | null;
    transferAmount: number | null;
    offsetInclTax: number | null;
  };
  properties: AggregatedProperty[];   // 集計済み邸データ
  warnings: string[];                  // パース警告
}
```

処理ステップ：
1. ファイルをSupabase Storageに保存（パス: `{org_id}/payment_notices/{uuid}.pdf`）
2. PDFパース実行
3. 振り分けロジック実行
4. 結果をJSONで返す（DBにはまだ書かない）

**エラー**: `400` (PDF不正), `401` (未認証), `500` (パース失敗)

### 2. 抽出結果の確定

**Server Action: `finalizePaymentNotice(draftData)`**

ユーザーがプレビュー画面で「確定」を押した時に呼ぶ。手動オーバーライド情報も含めて受け取り、DB保存する。

```typescript
async function finalizePaymentNotice(input: {
  paymentNoticeDraft: PaymentNoticeDraft;
  properties: Array<AggregatedProperty & {
    lines: Array<ClassifiedLine & {
      categoryOverridden?: 'sales' | 'shaho' | 'seisanka' | 'material';
    }>;
  }>;
}): Promise<{ paymentNoticeId: string }>
```

処理：
1. トランザクションで `payment_notices` → `properties` → `property_lines` を順に保存
2. オーバーライド時は `is_manually_overridden = true` で保存し、再集計
3. `parse_status = 'completed'`, `finalized_at = now()`

### 3. 担当者割り当て（一括）

**Server Action: `assignStaffToProperties(input)`**

```typescript
async function assignStaffToProperties(input: {
  staffMemberId: string;
  propertyIds: string[];
}): Promise<{ updated: number }>
```

`properties.staff_member_id` を一括更新。同じ組織のものだけ。

### 4. 邸一覧の取得

**`GET /api/properties` または Server Component で直接クエリ**

クエリパラメータ：
- `from`, `to`: 期間
- `staffMemberId`: 担当者フィルタ
- `search`: 邸名・担当者名の部分一致
- `unassignedOnly`: 未割当のみ

Response: `Property[]`

### 5. ダッシュボード集計

**Server Component で直接クエリ**

複数のSQLクエリを並列実行：
- 今月の合計（`SUM(amount_sales), COUNT(*)`）
- 月次推移（過去6ヶ月分のGROUP BY）
- 担当者別ランキング
- 未割当件数

### 6. 月次メモ

**Server Actions:**
- `getMonthlyMemo(reportMonth: string)` → `MonthlyMemo | null`
- `upsertMonthlyMemo(reportMonth: string, content: string)` → `MonthlyMemo`

### 7. 担当者マスタ（管理者のみ）

**Server Actions:**
- `listStaffMembers()` → `StaffMember[]`
- `createStaffMember({ name })` → `StaffMember`
- `updateStaffMember(id, { name?, isActive?, displayOrder? })` → `StaffMember`
- `deleteStaffMember(id)` → `void`（in_useなら soft delete = `is_active = false`）

### 8. ユーザー管理（管理者のみ）

**Server Actions:**
- `listMembers()` → `Membership[]`
- `inviteMember({ email, role })` → `Membership`（招待メール送信）
- `updateMemberRole(membershipId, role)` → `Membership`
- `removeMember(membershipId)` → `void`

### 9. Excel出力

**`POST /api/excel/export`**

**Request**:
```typescript
{
  format: 'legacy' | 'simple';      // 既存フォーマット or シンプル一覧
  reportMonth?: string;              // 月単位の出力
  staffMemberId?: string;            // 担当者フィルタ
  range?: { from: string; to: string };
}
```

**Response**: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` バイナリ

詳細は [`07-excel-export.md`](./07-excel-export.md) 参照。

### 10. PDF再ダウンロード

**`GET /api/payment-notices/[id]/pdf`**

Storage上のPDFを署名付きURLで返す or プロキシしてストリーミング。

## エラーレスポンス

統一フォーマット：

```typescript
{
  error: {
    code: string;              // 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | etc.
    message: string;           // ユーザー向けメッセージ
    details?: unknown;         // 開発者向け詳細（NODE_ENV=development時のみ）
  }
}
```

## バリデーション

すべての入力はZodで検証：

```typescript
import { z } from 'zod';

const AssignStaffSchema = z.object({
  staffMemberId: z.string().uuid(),
  propertyIds: z.array(z.string().uuid()).min(1).max(100),
});
```

## レート制限

MVPでは未実装でOK。フェーズ2でVercelのEdge ConfigやUpstash Redisを使ってPDFアップロード回数を制限。

## ロギング

`audit_logs`テーブルに以下を記録：
- PDF アップロード（`pdf.upload`）
- 抽出結果の確定（`payment_notice.finalize`）
- 担当者割り当て（`property.assign`）
- 担当者の変更（`property.reassign`）
- マスタ変更（`staff_member.create/update/delete`）

`metadata` JSONには対象IDや前後の値を記録。
