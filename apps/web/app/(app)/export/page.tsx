import { createClient } from "@/lib/supabase/server";
import { ExportForm } from "./ExportForm";

export default async function ExportPage() {
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

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold">Excel出力</h1>
        <p className="text-sm text-muted-foreground mt-1">
          月を選択してCSVをダウンロードしてください
        </p>
      </div>

      <ExportForm months={months} />
    </div>
  );
}
