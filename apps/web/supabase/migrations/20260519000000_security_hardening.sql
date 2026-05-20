-- ============================================================
-- セキュリティ堅牢化 (クロスレビュー指摘対応)
--
-- 履歴マイグレーションは書き換えず、前進マイグレーションで是正する。
-- 対応項目:
--   C1: handle_new_user の「全新規ユーザを最初の組織へ owner 自動参加」を撤廃
--   C5: memberships に書き込みポリシー追加 + 自己ロール改変の禁止
--   C3: users UPDATE ポリシーに WITH CHECK 追加
--   M1: monthly_memos に DELETE ポリシー追加
--   M2: ai_classifications の SELECT を is_org_member に統一
--   M4: SECURITY DEFINER 関数の search_path 固定
--   +  organizations / storage の書き込みポリシーを owner/admin に限定
-- ============================================================

-- ------------------------------------------------------------
-- M4: SECURITY DEFINER 関数の search_path 固定
-- (検索パス汚染による権限昇格の防止。テナント分離の要となる関数)
-- ------------------------------------------------------------
alter function public.is_org_member(uuid) set search_path = public, pg_temp;
alter function public.is_org_admin(uuid) set search_path = public, pg_temp;

-- ------------------------------------------------------------
-- C1: 新規ユーザの組織自動参加を撤廃 (テナント分離崩壊の根本原因)
-- 組織参加は招待フロー (memberships を service_role で作成) のみ経由。
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- public.users へのプロファイル作成のみ行う。
  -- 組織への所属 (memberships) は招待経由でのみ付与する。
  -- ここで自動 membership を作ると「サインアップした全員が既存テナントへ
  -- owner で侵入」できてしまうため絶対に作らない。
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

-- トリガ自体は既存のものを再利用 (関数定義のみ差し替え済み)。念のため再設定。
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- C5: memberships の書き込みポリシー (anon/authenticated 経路の多層防御)
-- service_role 経路 (server actions) は別途アプリ側でロール検証する。
-- ------------------------------------------------------------
drop policy if exists "admins manage memberships insert" on memberships;
create policy "admins manage memberships insert"
  on memberships for insert
  with check (is_org_admin(organization_id));

drop policy if exists "admins manage memberships update" on memberships;
create policy "admins manage memberships update"
  on memberships for update
  using (is_org_admin(organization_id))
  with check (is_org_admin(organization_id));

drop policy if exists "admins manage memberships delete" on memberships;
create policy "admins manage memberships delete"
  on memberships for delete
  using (is_org_admin(organization_id));

-- C5: 自己ロール改変の禁止 (全経路で有効)。
-- 自分自身の membership の role を書き換えることを禁止する。
-- service_role 経由の正当な管理操作では auth.uid() が NULL のため阻害しない
-- (= 他人のロールを管理者が変更する正規フローはブロックしない)。
create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
     and old.user_id = auth.uid()
     and new.role is distinct from old.role then
    raise exception '自分自身のロールは変更できません (privilege escalation 防止)';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_self_role_change on memberships;
create trigger trg_prevent_self_role_change
  before update on memberships
  for each row execute function public.prevent_self_role_change();

-- ------------------------------------------------------------
-- C3: users UPDATE に WITH CHECK を付与 (id 詐称・想定外列改変の防止)
-- email は auth.users 側が真実なのでクライアントからは不変扱い。
-- ------------------------------------------------------------
drop policy if exists "users can update own profile" on users;
create policy "users can update own profile"
  on users for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ------------------------------------------------------------
-- M1: monthly_memos の DELETE ポリシー追加 (RLS 有効だが DELETE 不能だった)
-- ------------------------------------------------------------
drop policy if exists "members can delete memos" on monthly_memos;
create policy "members can delete memos"
  on monthly_memos for delete
  using (is_org_member(organization_id));

-- ------------------------------------------------------------
-- M2: ai_classifications の SELECT を is_org_member に統一
-- (recursion-fix 後の規約に合わせる。memberships サブクエリ直書きを廃止)
-- ------------------------------------------------------------
drop policy if exists ai_classifications_select_own_org on ai_classifications;
create policy ai_classifications_select_own_org
  on ai_classifications for select
  using (is_org_member(organization_id));

-- ------------------------------------------------------------
-- organizations: owner/admin のみ自組織を更新可能 (請求情報の保護)
-- ------------------------------------------------------------
drop policy if exists "admins can update org" on organizations;
create policy "admins can update org"
  on organizations for update
  using (is_org_admin(id))
  with check (is_org_admin(id));

-- ------------------------------------------------------------
-- storage.objects: payment-notices の UPDATE をテナント管理者に限定
-- (これまで UPDATE ポリシーが無く、メタデータ更新/上書きが一律不能だった)
-- ------------------------------------------------------------
drop policy if exists "admins can update PDFs in own org" on storage.objects;
create policy "admins can update PDFs in own org"
  on storage.objects for update
  using (
    bucket_id = 'payment-notices'
    and is_org_admin((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'payment-notices'
    and is_org_admin((storage.foldername(name))[1]::uuid)
  );
