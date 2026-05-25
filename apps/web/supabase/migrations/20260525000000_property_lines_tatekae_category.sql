-- ============================================================
-- Fix C1: property_lines.category CHECK に 'tatekae' を追加
--
-- 背景:
--   Python 分類器 (apps/api) は 'tatekae' (立替金) を category として返すが、
--   既存の CHECK 制約は ('sales','shaho','seisanka','material') のみを許可。
--   結果として tatekae 行の INSERT が CHECK 違反で silent に失敗していた。
--
-- 影響範囲:
--   property_lines のみ。properties.amount_tatekae は別カラムなので影響なし。
--
-- 冪等性:
--   既存の CHECK 制約を DROP IF EXISTS → 再追加する。複数回実行しても安全。
-- ============================================================

alter table public.property_lines
  drop constraint if exists property_lines_category_check;

alter table public.property_lines
  add constraint property_lines_category_check
    check (category in ('sales','shaho','seisanka','material','tatekae'));

comment on column public.property_lines.category is
  'Line classification: sales/shaho/seisanka/material/tatekae(立替金)';
