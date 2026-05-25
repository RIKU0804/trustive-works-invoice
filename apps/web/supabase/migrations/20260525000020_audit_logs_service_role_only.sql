-- ============================================================
-- Fix: audit_logs を service_role からの INSERT のみに限定する
--
-- 背景:
--   20260501000100_init_rls.sql の "members can insert logs" ポリシーにより、
--   組織メンバーであれば任意の audit_log を直接 INSERT できる状態だった。
--   これでは監査ログを偽造 (forge) されうるため、append-only かつ
--   service_role (server actions) 経由のみに限定する。
--
-- service_role について:
--   service_role は RLS を bypass するため、ポリシー削除後も
--   createServiceClient() からの INSERT は引き続き成功する。
--   authenticated / anon (= ブラウザ直 SDK) からの INSERT は拒否される。
--
-- 冪等性:
--   既知の policy 名を DROP IF EXISTS で網羅的に削除する。
--
-- ⚠️ アプリ側依存:
--   apps/web/app/actions/ 配下の logAction(...) 呼び出しのうち、
--   user-scoped クライアント (`supabase`) を使っているサイトはこの変更後
--   audit_logs INSERT が RLS で拒否される (silent warn にのみ落ちる)。
--   - apps/web/app/actions/staff.ts:39, 94   (supabase = user-scoped)
--   - apps/web/app/actions/members.ts:54, 88 (supabase = user-scoped)
--   別エージェントで service_role クライアントに差し替える必要がある。
--   logAction 自体は error を warn ログに落とすだけなのでメイン処理は
--   停止しないが、監査ログ自体が記録されない状態は許容できない。
-- ============================================================

drop policy if exists "members can insert logs" on public.audit_logs;
drop policy if exists "Members can insert logs" on public.audit_logs;
drop policy if exists "members_insert_logs"     on public.audit_logs;

revoke insert, update, delete on public.audit_logs from authenticated, anon;

comment on table public.audit_logs is
  'Append-only audit log. INSERT only via service_role (server actions using service client).';
