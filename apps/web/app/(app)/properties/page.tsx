import { createClient } from "@/lib/supabase/server";
import MonthSelect from "./MonthSelect";

type Props = {
  searchParams: { month?: string };
};

export default async function PropertiesPage({ searchParams }: Props) {
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

  const { data: months } = orgId
    ? await supabase
        .from("payment_notices")
        .select("report_month")
        .eq("organization_id", orgId)
        .order("report_month", { ascending: false })
    : { data: [] };

  const uniqueMonths = Array.from(
    new Set((months ?? []).map((m) => m.report_month).filter(Boolean))
  ) as string[];

  const selectedMonth = searchParams.month ?? uniqueMonths[0] ?? null;

  const { data: properties } = orgId && selectedMonth
    ? await supabase
        .from("properties")
        .select(
          "id, property_name, contract_no, amount_sales, amount_shaho, amount_seisanka, amount_material, amount_gross_profit, gross_profit_rate, staff_members(name), payment_notices!inner(report_month)"
        )
        .eq("organization_id", orgId)
        .eq("payment_notices.report_month", selectedMonth)
        .order("created_at", { ascending: true })
    : { data: [] };

  const fmt = (n: number | null) =>
    n != null ? `¥${n.toLocaleString()}` : "—";

  const fmtRate = (n: number | null) =>
    n != null ? `${(n * 100).toFixed(1)}%` : "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">邸一覧</h1>
        <MonthSelect months={uniqueMonths} selected={selectedMonth} />
      </div>

      {!properties || properties.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm">
            {selectedMonth
              ? `${selectedMonth} の邸データがありません`
              : "データがありません"}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium whitespace-nowrap">邸名</th>
                <th className="px-4 py-3 text-left font-medium whitespace-nowrap">担当者</th>
                <th className="px-4 py-3 text-right font-medium whitespace-nowrap">売上</th>
                <th className="px-4 py-3 text-right font-medium whitespace-nowrap">社保</th>
                <th className="px-4 py-3 text-right font-medium whitespace-nowrap">精算額</th>
                <th className="px-4 py-3 text-right font-medium whitespace-nowrap">材料費</th>
                <th className="px-4 py-3 text-right font-medium whitespace-nowrap">粗利</th>
                <th className="px-4 py-3 text-right font-medium whitespace-nowrap">粗利率</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {properties.map((p) => {
                const staff = Array.isArray(p.staff_members)
                  ? p.staff_members[0]
                  : p.staff_members;
                return (
                  <tr key={p.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium whitespace-nowrap">
                      {p.property_name}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {staff?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmt(p.amount_sales)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmt(p.amount_shaho)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmt(p.amount_seisanka)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmt(p.amount_material)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmt(p.amount_gross_profit)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmtRate(p.gross_profit_rate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
