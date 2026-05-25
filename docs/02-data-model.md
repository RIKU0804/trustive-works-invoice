# 02. データモデル

## Recent changes (post-init migrations)

| 日付 | マイグレーション | 内容 |
|---|---|---|
| 2026-05-04 | `20260504000000_add_amount_tatekae.sql` | `properties.amount_tatekae` (立替金・非課税) を追加。税抜逆算の補正に使用 |
| 2026-05-10 | `20260510000000_add_consumption_tax_columns.sql` | `properties.amount_*_tax` (sales/shaho/seisanka/material 各カテゴリの消費税) を追加 |
| 2026-05-01 | `20260501000600_ai_classification.sql` | `property_lines` に `classification_confidence` / `classification_method` 追加。`ai_classifications` テーブル新設 (AI 呼び出し履歴) |
| 2026-05-19 | `20260519000000_security_hardening.sql` | 自動 membership 撤廃、`memberships` 書き込みポリシー、関数の search_path 固定など |
| 2026-05-25 | `20260525000000_property_lines_tatekae_category.sql` | `property_lines.category` の CHECK に `tatekae` を追加 |
| 2026-05-25 | `20260525000010_handle_new_user_no_automembership.sql` | 既存環境への security_hardening 再適用 |
| 2026-05-25 | `20260525000050_parse_reaper_job.sql` | `parse_status='parsing'` の停滞行を 15 分後に `failed` 降格する関数 |

> ⚠️ `classification_corrections` テーブルは未実装。`09-ai-classification.md` の "Future" セクション参照。
> 現状の AI 履歴は `ai_classifications` (上記マイグレーション参照) で扱う。

## 業務用語の対応表

実装前に必ず把握すること。日本語→英語のマッピング：

| 業務用語 | 英語/コード | 説明 |
|---|---|---|
| 邸 | property | 1つの工事案件・顧客（PDFの1邸名） |
| 邸名（顧客名） | property_name | 邸の主キー（例: 中川 明子） |
| 契約NO | contract_no | 旭化成側の契約番号（例: 10644CB-RA） |
| 工種 | work_type | 工事の種類（例: 防水（社保）、柱脚（労）） |
| 班長 | staff / staff_member | 担当者（例: 山本／熱田／安保） |
| 工事代計 | construction_total | PDF末尾の工事合計 |
| 相殺計 | offset_total | 退職年金掛金など |
| 支払日 | payment_date | PDFから抽出 |
| ①税抜 | amount_sales | 一般売上（プラス行合計） |
| ②社保 | amount_shaho | 中口分の社保マイナス絶対値 |
| ③生産課 | amount_seisanka | 中口分（社保以外）マイナス絶対値 |
| ④材料費 | amount_material | その他マイナス（防水シート相殺等） |
| ⑤外注 小林 | amount_outsource_kobayashi | 現状未使用 |
| ⑥外注 南 | amount_outsource_minami | 現状未使用 |
| ⑦粗利益 | amount_gross_profit | ① − ② − ③ − ④ |
| 粗利率 | gross_profit_rate | ⑦ ÷ ① |
| 振込金額 | transfer_amount | PDFの税込合計 |
| 税込相殺 | offset_incl_tax | 退職年金等の税込相殺 |

## ER図（テキスト）

```
organizations (1) ──────< (M) memberships >── (M) ────── (1) users
     │
     ├──< (M) staff_members
     │
     ├──< (M) payment_notices ──< (M) properties ──< (M) property_lines
     │                                                          │
     │                                                          └──< (M) ai_classifications
     │
     ├──< (M) monthly_memos
     │
     └──< (M) audit_logs

将来追加予定 (未実装):
  - classification_corrections : 人間が AI/ルール結果を修正した履歴 (Few-shot 用)
  - classification_rules       : 承認された追加ルール (Phase 9)
```

## テーブル定義

### organizations
組織（テナント）。MVPでは「山本さんの会社」1レコードから始める。

```sql
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_name text,
  -- 将来の課金用（MVPでは未使用、箱だけ）
  plan text not null default 'free',           -- 'free' | 'standard' | 'pro'
  subscription_status text default 'active',   -- 'active' | 'past_due' | 'canceled'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### users
Supabase Authの`auth.users`と1:1で対応するプロファイル。

```sql
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);
```

### memberships
ユーザーと組織の中間テーブル。1ユーザーが複数組織に所属可能。

```sql
create table memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  role text not null,                          -- 'owner' | 'admin' | 'member'
  invited_by uuid references users(id),
  joined_at timestamptz not null default now(),
  unique(user_id, organization_id)
);

create index on memberships(organization_id);
create index on memberships(user_id);
```

### staff_members
担当者マスタ（班長）。MVPでは山本／熱田／安保の3名で開始。

```sql
create table staff_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,                          -- '山本' / '熱田' / '安保'
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(organization_id, name)
);

create index on staff_members(organization_id);
```

### payment_notices
PDFアップロード単位。1ファイル=1レコード。

```sql
create table payment_notices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  file_name text not null,
  storage_path text not null,                  -- Supabase Storage上のパス
  report_month date not null,                  -- 対象月（YYYY-MM-01）
  payment_date date,                           -- PDFから抽出
  construction_total numeric,                  -- 工事代計（検証用）
  transfer_amount numeric,                     -- 振込金額（税込）
  offset_incl_tax numeric,                     -- 税込相殺
  parse_status text not null default 'pending', -- 'pending'|'parsing'|'completed'|'failed'
  parse_error text,                            -- 失敗時のエラーメッセージ
  uploaded_by uuid not null references users(id),
  uploaded_at timestamptz not null default now(),
  finalized_at timestamptz                     -- ユーザーが「確定」を押したタイミング
);

create index on payment_notices(organization_id, report_month);
create index on payment_notices(organization_id, parse_status);
```

**parse_status の遷移**:
`pending` → (Python API 呼び出し開始) → `parsing` → (成功) → `completed`
                                              └── (失敗) → `failed`

> `parsing` で 15 分以上停滞したレコードは `reap_stale_parse_status()` 関数
> (マイグレーション `20260525000050_parse_reaper_job.sql`) で `failed` に降格する。
> 詳細は `docs/12-operations.md` 参照。

### properties
邸ごとの集計値。1 payment_notice に対して N 邸。

```sql
create table properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  payment_notice_id uuid not null references payment_notices(id) on delete cascade,

  -- 識別子
  property_name text not null,                 -- 邸名（顧客名・主キー的役割）
  contract_no text,                            -- 契約NO（補助）
  work_summary text,                           -- 工事名称サマリ（例: 防水・柱脚）

  -- ①〜④集計値 (税抜)
  amount_sales numeric not null default 0,     -- ①税抜 (一般売上、立替金分を含む)
  amount_shaho numeric not null default 0,     -- ②社保
  amount_seisanka numeric not null default 0,  -- ③生産課
  amount_material numeric not null default 0,  -- ④材料費

  -- 立替金（非課税）。amount_sales に含まれるが税抜逆算 (÷1.1) しないための補正用。
  -- 20260504 追加。
  amount_tatekae numeric not null default 0,

  -- カテゴリ別 消費税 (進化版 / 20260510 追加)
  -- 各カテゴリの税抜額に対応する消費税を別カラムで保持する。
  amount_sales_tax    numeric not null default 0,
  amount_shaho_tax    numeric not null default 0,
  amount_seisanka_tax numeric not null default 0,
  amount_material_tax numeric not null default 0,

  -- 計算列（DBではトリガー or アプリ層で計算）
  amount_gross_profit numeric generated always as
    (amount_sales - amount_shaho - amount_seisanka - amount_material) stored,
  gross_profit_rate numeric generated always as
    (case when amount_sales = 0 then 0
          else (amount_sales - amount_shaho - amount_seisanka - amount_material) / amount_sales
     end) stored,

  -- 担当者
  staff_member_id uuid references staff_members(id),

  -- 補助情報
  pdf_page_number integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on properties(organization_id, payment_notice_id);
create index on properties(organization_id, staff_member_id);
create index on properties(organization_id, property_name);
```

### property_lines
邸ごとの明細行（生データ）。後からロジック変更があった時に再集計できるよう保持。

```sql
create table property_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,

  work_type text not null,                     -- 工種（例: 防水（社保））
  amount_excl_tax numeric not null,            -- 税抜金額（マイナスはそのまま）
  consumption_tax numeric not null default 0,
  amount_incl_tax numeric not null default 0,
  note text,                                   -- 備考

  -- 振り分け先（自動判定結果）
  -- 20260525 から 'tatekae' (立替金) を追加。
  category text not null,                      -- 'sales' | 'shaho' | 'seisanka' | 'material' | 'tatekae'
  is_manually_overridden boolean not null default false,

  -- AI 分類機能 (20260501 追加)
  classification_confidence numeric(3,2),      -- 0.00 - 1.00。null=未判定
  classification_method text,                  -- 'rule' | 'ai' | 'manual' | null

  sort_order integer not null,
  created_at timestamptz not null default now()
);

create index on property_lines(organization_id, property_id, sort_order);
```

### monthly_memos
月毎メモ。1組織×1月で1レコード。

```sql
create table monthly_memos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  report_month date not null,
  content text not null default '',
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  unique(organization_id, report_month)
);
```

### audit_logs
操作履歴（推奨機能）。

```sql
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references users(id),
  action text not null,                        -- 'pdf.upload' | 'property.assign' | etc.
  resource_type text,
  resource_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index on audit_logs(organization_id, created_at desc);
```

### ai_classifications

AI 再分類の呼び出し履歴。デバッグ・コスト把握用 (20260501 追加)。

```sql
create table ai_classifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  property_line_id uuid references property_lines(id) on delete set null,

  prompt_input jsonb not null,    -- { work_type, amount, note, ... }
  ai_response jsonb,              -- { category, confidence, reasoning }
  model text not null,            -- 'claude-haiku-4-5' など
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  error text,                     -- エラー時のメッセージ

  created_at timestamptz not null default now()
);

create index ai_classifications_org_created_idx
  on ai_classifications(organization_id, created_at desc);
create index ai_classifications_line_idx
  on ai_classifications(property_line_id);
```

> **未実装**: `09-ai-classification.md` で言及される `classification_corrections` と
> `classification_rules` テーブルは未作成。Phase 9 候補。

## RLS（Row Level Security）ポリシー

すべてのテーブルでRLSを有効化し、**自分が所属する組織のデータのみ見える**ようにする。

```sql
-- 全テーブル共通の例（organizations以外）
alter table properties enable row level security;

create policy "members can read own org properties"
  on properties for select
  using (
    organization_id in (
      select organization_id from memberships where user_id = auth.uid()
    )
  );

create policy "members can write own org properties"
  on properties for insert
  with check (
    organization_id in (
      select organization_id from memberships where user_id = auth.uid()
    )
  );

-- update / delete も同様
```

**重要**: 全テーブルにRLSを必ず設定する。設定漏れがあると、悪意あるユーザーが他組織のデータを取得できてしまう。

## TypeScript型の自動生成

Supabase CLIで型定義を自動生成する：

```bash
npx supabase gen types typescript --project-id <project-id> > lib/supabase/types.ts
```

これを `Database` 型として import し、Supabaseクライアント呼び出し時に型安全にする。

## ドメイン型（types/domain.ts）

DB型とは別に、UI表示用のドメイン型を定義する：

```typescript
export type Property = {
  id: string;
  propertyName: string;
  contractNo: string | null;
  workSummary: string | null;
  amounts: {
    sales: number;        // ①
    shaho: number;        // ②
    seisanka: number;     // ③
    material: number;     // ④
    grossProfit: number;  // ⑦（計算済み）
  };
  grossProfitRate: number;
  staff: StaffMember | null;
  reportMonth: Date;
  paymentDate: Date | null;
};

export type PropertyLine = {
  id: string;
  workType: string;
  amountExclTax: number;
  consumptionTax: number;
  amountInclTax: number;
  note: string;
  category: 'sales' | 'shaho' | 'seisanka' | 'material';
  isManuallyOverridden: boolean;
};

export type StaffMember = {
  id: string;
  name: string;
  isActive: boolean;
};
```

## マイグレーション戦略

Supabaseの公式マイグレーション機能を使う：

```
supabase/
└── migrations/
    ├── 20260501000000_init_schema.sql
    ├── 20260501000100_init_rls.sql
    ├── 20260501000200_seed_data.sql        # 山本さん組織・3名の班長
    └── ...
```

初期シードデータには以下を含める：
- 山本さんの会社（organizations 1件）
- 班長3名（山本／熱田／安保）

## マイグレーション実行手順

### ファイル構成
```
supabase/migrations/
├── 20260501000000_init_schema.sql    # テーブル定義
├── 20260501000100_init_rls.sql       # RLSポリシー
├── 20260501000200_seed_data.sql      # 初期データ
└── 20260501000300_auth_trigger.sql   # 認証トリガー
```

### ローカル開発
```bash
# Supabase起動（初回はマイグレーションも自動実行）
supabase start

# 新規マイグレーション追加
supabase migration new <migration_name>

# 型定義の自動生成
supabase gen types typescript --local > lib/supabase/database.types.ts
```

### 本番（Supabase Cloud）
```bash
supabase db push
```
