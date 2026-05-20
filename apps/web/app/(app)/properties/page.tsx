import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox, Upload } from "lucide-react";
import { resolveCaller } from "@/lib/auth/membership";
import MonthSelect from "./MonthSelect";
import { PropertiesFilters, type PropertyFilterRow } from "./PropertiesFilters";

type Props = {
  searchParams: { month?: string };
};

export default async function PropertiesPage({ searchParams }: Props) {
  const caller = await resolveCaller();
  if (caller.kind === "unauthenticated") redirect("/login");
  if (caller.kind !== "ok") return null;

  const { supabase, membership } = caller.ctx;
  const orgId = membership.organization_id;

  const { data: months } = await supabase
    .from("payment_notices")
    .select("report_month")
    .eq("organization_id", orgId)
    .order("report_month", { ascending: false });

  const uniqueMonths = Array.from(
    new Set((months ?? []).map((m) => m.report_month).filter(Boolean))
  ) as string[];

  const selectedMonth = searchParams.month ?? uniqueMonths[0] ?? null;

  const { data: properties } = orgId && selectedMonth
    ? await supabase
        .from("properties")
        .select(
          "id, property_name, contract_no, amount_sales, amount_shaho, amount_seisanka, amount_material, amount_sales_tax, amount_shaho_tax, amount_seisanka_tax, amount_material_tax, amount_gross_profit, gross_profit_rate, staff_members(name), payment_notices!inner(report_month)"
        )
        .eq("organization_id", orgId)
        .eq("payment_notices.report_month", selectedMonth)
        .order("created_at", { ascending: true })
    : { data: [] };

  // フィルタ用に正規化（進化版要件3）
  const filterRows: PropertyFilterRow[] = (properties ?? []).map((p) => {
    const staff = Array.isArray(p.staff_members) ? p.staff_members[0] : p.staff_members;
    return {
      id: p.id as string,
      property_name: (p.property_name as string) ?? "",
      contract_no: (p.contract_no as string | null) ?? null,
      staff_name: staff?.name ?? null,
      amount_sales: Number(p.amount_sales ?? 0),
      amount_shaho: Number(p.amount_shaho ?? 0),
      amount_seisanka: Number(p.amount_seisanka ?? 0),
      amount_material: Number(p.amount_material ?? 0),
      amount_sales_tax: Number(p.amount_sales_tax ?? 0),
      amount_shaho_tax: Number(p.amount_shaho_tax ?? 0),
      amount_seisanka_tax: Number(p.amount_seisanka_tax ?? 0),
      amount_material_tax: Number(p.amount_material_tax ?? 0),
      amount_gross_profit: Number(p.amount_gross_profit ?? 0),
      gross_profit_rate: Number(p.gross_profit_rate ?? 0),
    };
  });

  const staffOptions = Array.from(
    new Set(filterRows.map((r) => r.staff_name).filter((v): v is string => Boolean(v)))
  ).sort();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">邸一覧</h1>
        <MonthSelect months={uniqueMonths} selected={selectedMonth} />
      </div>

      {!properties || properties.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-white p-12">
          <div className="max-w-md mx-auto text-center space-y-4">
            <Inbox
              className="w-12 h-12 mx-auto text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <h2 className="text-base font-semibold">
                {selectedMonth
                  ? `${selectedMonth} の邸データがありません`
                  : "データがありません"}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                支払通知書のPDFをアップロードすると、ここに邸別の集計が表示されます。
              </p>
            </div>

            <ol className="text-left text-sm text-muted-foreground space-y-2 mx-auto max-w-xs">
              <li className="flex gap-2">
                <span className="font-semibold text-foreground">1.</span>
                <span>支払通知書のPDFを準備</span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-foreground">2.</span>
                <span>アップロード画面でPDFを送信</span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-foreground">3.</span>
                <span>邸別の粗利・担当を確認</span>
              </li>
            </ol>

            <Link
              href="/upload"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Upload className="w-4 h-4" aria-hidden="true" />
              PDFをアップロードする
            </Link>
          </div>
        </div>
      ) : (
        <PropertiesFilters rows={filterRows} staffOptions={staffOptions} />
      )}
    </div>
  );
}
