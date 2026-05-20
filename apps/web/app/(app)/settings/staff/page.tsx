import { redirect } from "next/navigation";
import { resolveCaller } from "@/lib/auth/membership";
import { AddStaffForm } from "./AddStaffForm";

export default async function StaffSettingsPage() {
  const caller = await resolveCaller();
  if (caller.kind === "unauthenticated") redirect("/login");
  if (caller.kind !== "ok") return null;

  const { supabase, membership } = caller.ctx;
  const orgId = membership.organization_id;
  const isAdmin = membership.role === "owner" || membership.role === "admin";

  const { data: staff } = await supabase
    .from("staff_members")
    .select("*")
    .eq("organization_id", orgId)
    .order("display_order");

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold">担当者マスタ</h1>
        <p className="text-sm text-muted-foreground mt-1">物件に割り当てる担当者（班長）を管理します</p>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">名前</th>
              <th className="px-4 py-3 text-left font-medium">状態</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {staff?.map((s) => (
              <tr key={s.id} className="hover:bg-muted/30">
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                    {s.is_active ? "有効" : "無効"}
                  </span>
                </td>
              </tr>
            ))}
            {(!staff || staff.length === 0) && (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  担当者がいません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isAdmin && <AddStaffForm />}
    </div>
  );
}
