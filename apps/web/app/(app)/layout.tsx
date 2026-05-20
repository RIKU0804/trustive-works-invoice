import { redirect } from "next/navigation";
import { resolveCaller } from "@/lib/auth/membership";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { CommandPalette, type MonthEntry } from "@/components/layout/command-palette";

function MessageScreen({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-50 p-6">
      <div className="max-w-md rounded-lg border bg-white p-8 text-center space-y-2">
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const caller = await resolveCaller();

  if (caller.kind === "unauthenticated") redirect("/login");

  // 「組織なし」と「取得失敗」を区別して明示表示する
  // (旧コードはどちらも空状態に潰しており障害切り分け不能だった)
  if (caller.kind === "no-membership") {
    return (
      <MessageScreen
        title="組織に所属していません"
        body="管理者から招待を受けてください。招待メール経由でのみ組織に参加できます。"
      />
    );
  }
  if (caller.kind === "error") {
    return (
      <MessageScreen
        title="読み込みに失敗しました"
        body="メンバーシップ情報の取得に失敗しました。時間をおいて再度お試しください。"
      />
    );
  }

  const { supabase, user, membership } = caller.ctx;
  const isAdmin = membership.role === "admin" || membership.role === "owner";
  const orgId = membership.organization_id;

  // 未割当バッジ
  const { count: unassignedCount } = await supabase
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .is("staff_member_id", null);

  // コマンドパレット用の月一覧
  const { data: monthRows } = await supabase
    .from("payment_notices")
    .select("report_month")
    .eq("organization_id", orgId)
    .eq("parse_status", "completed")
    .order("report_month", { ascending: false });

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
