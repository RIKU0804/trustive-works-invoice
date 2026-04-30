-- ============================================================
-- 初期シードデータ
-- 組織の初期レコード。担当者は管理画面から登録する想定で空。
-- ============================================================

insert into organizations (id, name, display_name)
values (
  'a1b2c3d4-0000-0000-0000-000000000001',
  'demo-org',
  'Demo Organization'
)
on conflict (id) do nothing;
