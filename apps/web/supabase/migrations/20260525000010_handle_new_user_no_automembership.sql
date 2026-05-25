-- ============================================================
-- Forward-fix: handle_new_user() を再定義し、auto-membership を恒久的に排除する
--
-- 背景:
--   20260501000300_auth_trigger.sql の初期実装では、新規ユーザを
--   最初の組織に owner として自動加入させていた。これは複数テナント運用で
--   全ユーザが既存テナントの owner になる致命的なテナント分離崩壊だった。
--   20260519000000_security_hardening.sql で is fixed されたが、
--   マイグレーション順序や branch 復元時の事故を防ぐため、
--   このファイルで「membership は決して作らない」ことを再確認・固定化する。
--
-- スキーマ整合:
--   public.users カラムは (id, email, display_name, avatar_url, created_at)。
--   ここでは display_name / avatar_url を auth.users.raw_user_meta_data から
--   生成する。既存 20260519 と同じロジックを踏襲。
--
-- 冪等性:
--   CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER で複数回適用可能。
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- public.users へのプロファイル作成のみを行う。
  -- 組織 (memberships) への自動加入は絶対に行わない。
  -- テナント分離の根幹: 組織所属の付与は明示的な招待フロー
  -- (service_role 経由の memberships INSERT) のみが正規ルート。
  insert into public.users (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        avatar_url   = excluded.avatar_url;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

comment on function public.handle_new_user is
  'Inserts a row in public.users on auth.users INSERT. Never creates org memberships (tenant isolation guarantee).';
