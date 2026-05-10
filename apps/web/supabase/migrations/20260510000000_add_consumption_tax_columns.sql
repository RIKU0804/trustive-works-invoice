-- 進化版要件 (260510): カテゴリ別消費税の分離管理
-- 山本さんの「進化版」テンプレで、各カテゴリ(売上/社保/生産課/材料費)が
-- 税抜と消費税の2列に分割されたため、DB側でも別カラムで保持する。
--
-- 既存の amount_sales / amount_shaho / amount_seisanka / amount_material は
-- すべて税抜額として継続使用し、各カテゴリの消費税額を新カラムで追加する。

alter table properties
  add column if not exists amount_sales_tax     numeric not null default 0,
  add column if not exists amount_shaho_tax     numeric not null default 0,
  add column if not exists amount_seisanka_tax  numeric not null default 0,
  add column if not exists amount_material_tax  numeric not null default 0;

comment on column properties.amount_sales_tax     is '①一般売上の消費税額 (進化版要件)';
comment on column properties.amount_shaho_tax     is '②社保の消費税額 (進化版要件)';
comment on column properties.amount_seisanka_tax  is '③生産課の消費税額 (進化版要件)';
comment on column properties.amount_material_tax  is '④材料費の消費税額 (進化版要件)';
