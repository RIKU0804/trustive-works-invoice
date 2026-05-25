-- ============================================================
-- Fix: ai_classifications の書き込み権限を service_role に限定 (意思の明示)
--
-- 背景:
--   20260501000600_ai_classification.sql ではコメント上は
--   「INSERT/UPDATE/DELETE は service_role 経由のみ (policy なし = 拒否)」
--   と記述されているが、policy が無いだけで GRANT 自体は authenticated /
--   anon に残存している。policy が後から誤って追加された場合に書き込みが
--   通ってしまうため、テーブルレベルの GRANT を明示的に REVOKE する。
--
-- 影響:
--   service_role は RLS 同様に GRANT を bypass するため、サーバ側
--   (apps/web/app/actions/upload.ts の ai_classifications.insert) は
--   引き続き動作する。
--
-- 冪等性:
--   REVOKE は対象権限が無くてもエラーにならない (PostgreSQL の仕様)。
-- ============================================================

revoke insert, update, delete on public.ai_classifications from authenticated, anon;

comment on table public.ai_classifications is
  'AI classification audit log. service_role writes only.';
