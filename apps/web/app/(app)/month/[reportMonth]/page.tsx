import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MonthGrid, type PropertyRow, type StaffOption } from "./MonthGrid";

type Params = { reportMonth: string };

function fmtJpy(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(Number(n)).toLocaleString();
}

export default async function MonthDetailPage({ params }: { params: Params }) {
  const supabase = createClient();

  const match = params.reportMonth.match(/^(\d{4})-(\d{2})/);
  if (!match) notFound();
  const monthStart = `${match[1]}-${match[2]}-01`;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();
  if (!membership) notFound();

  const orgId = membership.organization_id;

  const { data: notices } = await supabase
    .from("payment_notices")
    .select("id, payment_date, transfer_amount, offset_incl_tax, file_name")
    .eq("organization_id", orgId)
    .eq("report_month", monthStart);

  if (!notices || notices.length === 0) notFound();

  const noticeIds = notices.map((n) => n.id);

  const { data: properties } = await supabase
    .from("properties")
    .select(`
      id,
      property_name,
      contract_no,
      work_summary,
      amount_sales,
      amount_shaho,
      amount_seisanka,
      amount_material,
      amount_gross_profit,
      gross_profit_rate,
      staff_member_id,
      staff_members(id, name)
    `)
    .in("payment_notice_id", noticeIds)
    .order("property_name");

  const props = properties ?? [];

  const { data: staffList } = await supabase
    .from("staff_members")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("display_order");

  const staffOptions: StaffOption[] = (staffList ?? []).map((s) => ({
    id: s.id,
    name: s.name,
  }));

  // 行データ
  const rows: PropertyRow[] = props.map((p) => {
    const staff = (p.staff_members as { id: string; name: string } | null) ?? null;
    return {
      id: p.id,
      propertyName: p.property_name,
      workSummary: p.work_summary ?? null,
      amountSales: Number(p.amount_sales ?? 0),
      amountShaho: Number(p.amount_shaho ?? 0),
      amountSeisanka: Number(p.amount_seisanka ?? 0),
      amountMaterial: Number(p.amount_material ?? 0),
      amountGrossProfit: Number(p.amount_gross_profit ?? 0),
      grossProfitRate: Number(p.gross_profit_rate ?? 0),
      staffMemberId: staff?.id ?? p.staff_member_id ?? null,
      staffName: staff?.name ?? "",
    };
  });

  // 合計
  const totalSales = rows.reduce((s, p) => s + p.amountSales, 0);
  const totalShaho = rows.reduce((s, p) => s + p.amountShaho, 0);
  const totalSeisanka = rows.reduce((s, p) => s + p.amountSeisanka, 0);
  const totalMaterial = rows.reduce((s, p) => s + p.amountMaterial, 0);
  const totalGrossProfit = rows.reduce((s, p) => s + p.amountGrossProfit, 0);
  const totalGrossProfitRate = totalSales > 0 ? totalGrossProfit / totalSales : 0;

  // 班長別集計（DB登録の有効担当者ベース）
  const staffSummary = staffOptions.map((s) => {
    const ofStaff = rows.filter((p) => p.staffName === s.name);
    return {
      name: s.name,
      grossProfit: ofStaff.reduce((acc, p) => acc + p.amountGrossProfit, 0),
      count: ofStaff.length,
    };
  });
  const unassignedCount = rows.filter((p) => !p.staffMemberId).length;

  // 振込・相殺
  const transferTotal = notices.reduce(
    (s, n) => s + Number(n.transfer_amount ?? 0),
    0
  );
  const offsetTotal = notices.reduce(
    (s, n) => s + Number(n.offset_incl_tax ?? 0),
    0
  );

  const { data: memo } = await supabase
    .from("monthly_memos")
    .select("content")
    .eq("organization_id", orgId)
    .eq("report_month", monthStart)
    .maybeSingle();

  const monthLabel = `${match[1]}年${match[2]}月`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{monthLabel} 詳細</h1>
          <p className="text-sm text-muted-foreground mt-1">
            支払通知 {notices.length} 件 / {rows.length} 邸
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/export?month=${match[1]}-${match[2]}&format=xlsx`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90"
          >
            Excelダウンロード
          </a>
          <Link
            href="/dashboard"
            className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
          >
            ← 一覧へ
          </Link>
        </div>
      </div>

      <MonthGrid
        rows={rows}
        totals={{
          sales: totalSales,
          shaho: totalShaho,
          seisanka: totalSeisanka,
          material: totalMaterial,
          grossProfit: totalGrossProfit,
          grossProfitRate: totalGrossProfitRate,
        }}
        staffOptions={staffOptions}
      />

      {/* 下段: 班長別集計 + 担当邸数 + 振込照合 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-white">
          <div className="bg-blue-50 border-b px-3 py-2 text-xs font-semibold">
            班長別 粗利
          </div>
          <table className="w-full text-xs">
            <tbody>
              {staffSummary.map((s) => (
                <tr key={s.name} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{s.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    ¥{fmtJpy(s.grossProfit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border bg-white">
          <div className="bg-green-50 border-b px-3 py-2 text-xs font-semibold">
            担当邸数
          </div>
          <table className="w-full text-xs">
            <tbody>
              {staffSummary.map((s) => (
                <tr key={s.name} className="border-b">
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="px-3 py-2 text-right">{s.count} 邸</td>
                </tr>
              ))}
              <tr className="border-b">
                <td className="px-3 py-2 text-red-600">未入力</td>
                <td className="px-3 py-2 text-right text-red-600">{unassignedCount} 邸</td>
              </tr>
              <tr className="bg-green-50 font-semibold">
                <td className="px-3 py-2">合計</td>
                <td className="px-3 py-2 text-right">{rows.length} 邸</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border bg-white">
          <div className="bg-purple-50 border-b px-3 py-2 text-xs font-semibold">
            振込照合
          </div>
          <table className="w-full text-xs">
            <tbody>
              <tr className="border-b">
                <td className="px-3 py-2">振込金額</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  ¥{fmtJpy(transferTotal)}
                </td>
              </tr>
              <tr className="border-b">
                <td className="px-3 py-2">相殺（税込）</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  ¥{fmtJpy(offsetTotal)}
                </td>
              </tr>
              <tr className="bg-purple-50 font-semibold">
                <td className="px-3 py-2">差引</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  ¥{fmtJpy(transferTotal + offsetTotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {memo?.content && (
        <div className="rounded-lg border bg-white">
          <div className="bg-yellow-50 border-b px-3 py-2 text-xs font-semibold">
            月次メモ
          </div>
          <div className="px-3 py-2 text-sm whitespace-pre-wrap">{memo.content}</div>
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        対象PDF: {notices.map((n, i) => (
          <span key={n.id}>
            {i > 0 && " / "}
            <a
              href={`/api/payment-notices/${n.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {n.file_name}
            </a>
          </span>
        ))}
      </div>
    </div>
  );
}
