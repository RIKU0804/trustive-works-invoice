import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AssignTable } from "./AssignTable";

export default async function AssignPage({ params }: { params: { paymentNoticeId: string } }) {
  const supabase = createClient();

  const { data: notice } = await supabase
    .from("payment_notices")
    .select("*")
    .eq("id", params.paymentNoticeId)
    .single();

  if (!notice) notFound();

  const { data: properties } = await supabase
    .from("properties")
    .select("*, staff_members(id, name)")
    .eq("payment_notice_id", params.paymentNoticeId)
    .order("property_name");

  const { data: { user } } = await supabase.auth.getUser();
  const { data: membership } = user
    ? await supabase
        .from("memberships")
        .select("organization_id")
        .eq("user_id", user.id)
        .single()
    : { data: null };

  const { data: staffList } = membership
    ? await supabase
        .from("staff_members")
        .select("id, name")
        .eq("organization_id", membership.organization_id)
        .eq("is_active", true)
        .order("display_order")
    : { data: [] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">担当者割り当て</h1>
        <p className="text-sm text-muted-foreground mt-1">{notice.file_name} — {notice.report_month}</p>
      </div>

      <AssignTable
        properties={(properties ?? []).map((p) => ({
          id: p.id,
          propertyName: p.property_name,
          amountSales: p.amount_sales,
          amountShaho: p.amount_shaho,
          amountSeisanka: p.amount_seisanka,
          amountMaterial: p.amount_material,
          amountGrossProfit: p.amount_gross_profit ?? 0,
          staffMemberId: (p as { staff_members?: { id: string } | null }).staff_members?.id ?? null,
          staffMemberName: (p as { staff_members?: { name: string } | null }).staff_members?.name ?? null,
        }))}
        staffList={staffList ?? []}
      />
    </div>
  );
}
