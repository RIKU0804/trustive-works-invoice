-- v1.2.4 invoice-tool 仕様: 立替金(非課税・税抜=税込)を別カラムで追跡する
-- amount_sales には立替金分も含まれるが、振込金額照合の税抜逆算で
-- 1.1 で割らない補正のため amount_tatekae を別途保持する
alter table properties
  add column if not exists amount_tatekae numeric not null default 0;

comment on column properties.amount_tatekae is
  '立替金(非課税)の合計。amount_sales には含まれるが税抜逆算の補正用に追跡する。';
