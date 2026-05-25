-- ============================================================
-- Fix: データ整合性 CHECK 制約の追加
--
-- 1) payment_notices.report_month は必ず月初 (1日) であること
--    月次集計のロールアップ前提を制約として固定する。
-- 2) properties.amount_* (数値列) は非負であること
--    金額の符号反転による粗利計算の崩壊を防止する。
-- 3) property_lines.classification_method のデフォルト = 'rule'
--    AI / ルールベース分類の流入で NULL が混入することを防ぐ。
--    既存の NULL 行は許容 (legacy data 互換)。
--
-- 冪等性:
--   1) DROP CONSTRAINT IF EXISTS → ADD CONSTRAINT
--   2) DO ブロック内で動的に列名を列挙し、列ごとに制約を再追加
--   3) ALTER COLUMN ... SET DEFAULT は冪等
-- ============================================================

-- ------------------------------------------------------------
-- 1) payment_notices.report_month: 月初日 (day = 1) のみ許可
-- ------------------------------------------------------------
alter table public.payment_notices
  drop constraint if exists payment_notices_report_month_first_chk;

alter table public.payment_notices
  add constraint payment_notices_report_month_first_chk
    check (extract(day from report_month) = 1);

-- ------------------------------------------------------------
-- 2) properties.amount_*: 非負制約 (動的列挙)
--    amount_gross_profit (粗利) は赤字案件で正当に負値となるため除外する。
--    is_generated = 'ALWAYS' の列も (定義上同じ理由で) 除外する。
--    対象は実体 INSERT される売上原価系の amount_sales / amount_shaho /
--    amount_seisanka / amount_material / amount_tatekae / amount_*_tax 等。
-- ------------------------------------------------------------
do $$
declare
  col text;
begin
  for col in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'properties'
      and column_name like 'amount\_%'
      and column_name <> 'amount_gross_profit'
      and data_type in ('numeric', 'integer', 'bigint')
      and is_generated = 'NEVER'
  loop
    execute format(
      'alter table public.properties drop constraint if exists chk_%s_nonneg',
      col
    );
    execute format(
      'alter table public.properties add constraint chk_%s_nonneg check (%I >= 0)',
      col, col
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3) property_lines.classification_method: default = 'rule'
--    既存 NULL 行は legacy として許容 (制約変更はしない)。
--    新規 INSERT は明示指定が無ければ 'rule' で埋まる。
-- ------------------------------------------------------------
alter table public.property_lines
  alter column classification_method set default 'rule';
