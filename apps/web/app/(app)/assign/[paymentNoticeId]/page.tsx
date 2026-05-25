import { notFound, redirect } from "next/navigation";
import { resolveCaller } from "@/lib/auth/membership";
import { AssignTable } from "./AssignTable";

export default async function AssignPage({ params }: { params: { paymentNoticeId: string } }) {
  // 認証・組織解決を先に行う (旧コードはデータ取得後に認証していた)
  const caller = await resolveCaller();
  if (caller.kind === "unauthenticated") redirect("/login");
  if (caller.kind !== "ok") notFound();

  const { supabase, membership } = caller.ctx;
  const orgId = membership.organization_id;

  // 通知書は必ず組織でスコープする (IDOR 対策の多層防御)
  const { data: notice } = await supabase
    .from("payment_notices")
    .select("id, file_name, report_month")
    .eq("id", params.paymentNoticeId)
    .eq("organization_id", orgId)
    .single();

  if (!notice) notFound();

  const { data: properties } = await supabase
    .from("properties")
    .select(
      `id,
       property_name,
       amount_sales,
       amount_shaho,
       amount_seisanka,
       amount_material,
       amount_gross_profit,
       staff_member_id,
       staff_members ( id, name )`
    )
    .eq("organization_id", orgId)
    .eq("payment_notice_id", params.paymentNoticeId)
    .order("property_name");

  const { data: staffList } = await supabase
    .from("staff_members")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("display_order");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">担当者割り当て</h1>
        <p className="text-sm text-muted-foreground mt-1">{notice.file_name} — {notice.report_month}</p>
      </div>

      <AssignTable
        properties={(properties ?? []).map((p) => {
          const staff = (p.staff_members as { id: string; name: string } | null) ?? null;
          return {
            id: p.id,
            propertyName: p.property_name,
            amountSales: p.amount_sales,
            amountShaho: p.amount_shaho,
            amountSeisanka: p.amount_seisanka,
            amountMaterial: p.amount_material,
            amountGrossProfit: p.amount_gross_profit ?? 0,
            staffMemberId: staff?.id ?? null,
            staffMemberName: staff?.name ?? null,
          };
        })}
        staffList={staffList ?? []}
      />
    </div>
  );
}
