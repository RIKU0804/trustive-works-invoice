-- ============================================================
-- Reaper: payment_notices stuck in 'parsing' state
--
-- 何らかの障害 (Python API クラッシュ / Vercel timeout / DB 接続断) で
-- payment_notices.parse_status が 'parsing' のまま残ったレコードを、
-- 15 分経過後に 'failed' へ降格させる。
-- 放置するとフロント UI のスピナーが永久に回り続けてしまう。
--
-- スケジュール方法:
--   A. Supabase の pg_cron 拡張が使える場合 (推奨)
--        最終行のコメントアウトを外す。5 分間隔で実行される。
--   B. pg_cron が無い場合
--        外部スケジューラ (GitHub Actions / Vercel Cron / Railway Cron)
--        から `select public.reap_stale_parse_status();` を定期実行する。
--        手動でも OK:
--            psql ... -c "select public.reap_stale_parse_status();"
--
-- 関数は SECURITY DEFINER。search_path を public,pg_temp に固定して
-- 検索パス汚染による権限昇格を防ぐ (security_hardening と同じ規約)。
-- ============================================================

create or replace function public.reap_stale_parse_status()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.payment_notices
  set parse_status = 'failed',
      parse_error  = coalesce(parse_error, '') ||
                     case when parse_error is null or parse_error = '' then '' else ' | ' end ||
                     'parse_timeout: stuck in parsing > 15 min'
  where parse_status = 'parsing'
    and uploaded_at < now() - interval '15 minutes';
$$;

comment on function public.reap_stale_parse_status() is
  'Demote payment_notices stuck in parsing > 15 min to failed. Schedule every 5 min.';

-- pg_cron がある場合に schedule (Supabase Cloud は dashboard か拡張機能から有効化可能):
-- select cron.schedule(
--   'reap-stale-parse-status',
--   '*/5 * * * *',
--   $$select public.reap_stale_parse_status();$$
-- );
