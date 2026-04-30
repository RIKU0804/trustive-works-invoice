-- ============================================================
-- AI分類機能 (P5)
-- - property_lines に信頼度・分類方法カラムを追加
-- - ai_classifications テーブルで AI 呼び出し履歴を記録
-- ============================================================

-- property_lines に信頼度カラムを追加
alter table property_lines
  add column if not exists classification_confidence numeric(3,2)
    check (classification_confidence is null
           or (classification_confidence >= 0 and classification_confidence <= 1));

alter table property_lines
  add column if not exists classification_method text
    check (classification_method is null
           or classification_method in ('rule', 'ai', 'manual'));

-- AI 呼び出し履歴
create table if not exists ai_classifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  property_line_id uuid references property_lines(id) on delete set null,

  -- AI 呼び出し内容
  prompt_input jsonb not null,    -- { work_type, amount, note, ... } 入力
  ai_response jsonb,              -- { category, confidence, reasoning } 結果
  model text not null,            -- 'claude-haiku-4-5' など
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  error text,                     -- エラー時のメッセージ

  created_at timestamptz not null default now()
);

create index if not exists ai_classifications_org_created_idx
  on ai_classifications(organization_id, created_at desc);
create index if not exists ai_classifications_line_idx
  on ai_classifications(property_line_id);

-- RLS
alter table ai_classifications enable row level security;

-- 組織メンバーだけが自組織のレコードを SELECT 可能
create policy ai_classifications_select_own_org on ai_classifications
  for select using (
    organization_id in (
      select organization_id from memberships where user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE は service_role 経由のみ（policy なし = 拒否）
