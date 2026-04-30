import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { CommandPalette, type MonthEntry } from "@/components/layout/command-palette";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("memberships")
    .select("role, organization_id")
    .eq("user_id", user.id)
    .single();

  const isAdmin = membership?.role === "admin" || membership?.role === "owner";
  const orgId = membership?.organization_id;

  // 未割当バッジ
  const { count: unassignedCount } = orgId
    ? await supabase
        .from("properties")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .is("staff_member_id", null)
    : { count: 0 };

  // コマンドパレット用の月一覧
  const { data: monthRows } = orgId
    ? await supabase
        .from("payment_notices")
        .select("report_month")
        .eq("organization_id", orgId)
        .eq("parse_status", "completed")
        .order("report_month", { ascending: false })
    : { data: [] };

  const months: MonthEntry[] = Array.from(
    new Set((monthRows ?? []).map((m) => String(m.report_month).slice(0, 7)))
  ).map((ym) => {
    const [y, mm] = ym.split("-");
    return { value: ym, label: `${y}年${mm}月` };
  });

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar isAdmin={isAdmin} unassignedCount={unassignedCount ?? 0} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header email={user.email} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
      <CommandPalette months={months} />
    </div>
  );
}
