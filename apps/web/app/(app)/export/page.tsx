import { redirect } from "next/navigation";
import { resolveCaller } from "@/lib/auth/membership";
import { ExportForm } from "./ExportForm";

export default async function ExportPage() {
  const caller = await resolveCaller();
  if (caller.kind === "unauthenticated") redirect("/login");
  if (caller.kind !== "ok") return null;

  const { supabase, membership } = caller.ctx;

  const { data: notices } = await supabase
    .from("payment_notices")
    .select("report_month")
    .eq("organization_id", membership.organization_id)
    .eq("parse_status", "completed")
    .order("report_month", { ascending: false });

  const months = Array.from(
    new Set(
      (notices ?? [])
        .map((n) => n.report_month)
        .filter((m): m is string => typeof m === "string" && m.length > 0)
    )
  );

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
