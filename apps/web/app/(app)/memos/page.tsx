import { createClient } from "@/lib/supabase/server";
import { MemoEditor } from "./MemoEditor";

export default async function MemosPage() {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: membership } = user
    ? await supabase
        .from("memberships")
        .select("organization_id")
        .eq("user_id", user.id)
        .single()
    : { data: null };

  const orgId = membership?.organization_id;

  const { data: notices } = orgId
    ? await supabase
        .from("payment_notices")
        .select("report_month")
        .eq("organization_id", orgId)
        .eq("parse_status", "completed")
        .order("report_month", { ascending: false })
    : { data: [] };

  const months = Array.from(
    new Set((notices ?? []).map((n) => n.report_month).filter(Boolean))
  ) as string[];

  const { data: memos } = orgId
    ? await supabase
        .from("monthly_memos")
        .select("report_month, content")
        .eq("organization_id", orgId)
    : { data: [] };

  const memoMap = new Map(
    (memos ?? []).map((m) => [m.report_month, m.content])
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold">月次メモ</h1>
        <p className="text-sm text-muted-foreground mt-1">月ごとのメモを記録・編集できます</p>
      </div>

      {months.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">データがありません</p>
          <p className="text-xs text-muted-foreground mt-1">
            PDFをアップロードして解析を完了してください
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {months.map((month) => (
            <div key={month} className="rounded-lg border p-4 space-y-3">
              <h2 className="text-sm font-semibold text-gray-900">
                {month.replace(/^(\d{4})-(\d{2})$/, "$1年$2月")}
              </h2>
              {orgId && (
                <MemoEditor
                  reportMonth={month}
                  initialContent={memoMap.get(month) ?? ""}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
