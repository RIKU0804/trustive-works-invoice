"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { assignStaff } from "@/app/actions/staff";
import { fmtJpy } from "@/lib/format";

type Property = {
  id: string;
  propertyName: string;
  amountSales: number;
  amountShaho: number;
  amountSeisanka: number;
  amountMaterial: number;
  amountGrossProfit: number;
  staffMemberId: string | null;
  staffMemberName: string | null;
};

type Staff = { id: string; name: string };

export function AssignTable({
  properties,
  staffList,
}: {
  properties: Property[];
  staffList: Staff[];
}) {
  const [optimistic, updateOptimistic] = useOptimistic(
    properties,
    (state, { propertyId, staffId, staffName }: { propertyId: string; staffId: string | null; staffName: string | null }) =>
      state.map((p) =>
        p.id === propertyId ? { ...p, staffMemberId: staffId, staffMemberName: staffName } : p
      )
  );
  const [, startTransition] = useTransition();

  function handleChange(propertyId: string, value: string) {
    const staff = staffList.find((s) => s.id === value) ?? null;
    const property = optimistic.find((p) => p.id === propertyId);
    const propertyName = property?.propertyName ?? "物件";
    const previousStaffId = property?.staffMemberId ?? null;
    const previousStaffName = property?.staffMemberName ?? null;

    startTransition(async () => {
      updateOptimistic({ propertyId, staffId: value || null, staffName: staff?.name ?? null });
      try {
        await assignStaff(propertyId, value || null);
        toast.success(
          staff
            ? `${propertyName} を ${staff.name} に割当しました`
            : `${propertyName} の担当者を解除しました`,
          {
            action: {
              label: "元に戻す",
              onClick: () => {
                startTransition(async () => {
                  updateOptimistic({
                    propertyId,
                    staffId: previousStaffId,
                    staffName: previousStaffName,
                  });
                  try {
                    await assignStaff(propertyId, previousStaffId);
                    toast.success(`${propertyName} を元に戻しました`);
                  } catch (err) {
                    toast.error(
                      err instanceof Error ? err.message : "元に戻すのに失敗しました"
                    );
                  }
                });
              },
            },
          }
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "割当に失敗しました");
      }
    });
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left font-medium">物件名</th>
            <th className="px-3 py-2 text-right font-medium">売上</th>
            <th className="px-3 py-2 text-right font-medium">粗利</th>
            <th className="px-3 py-2 text-left font-medium">担当者</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {optimistic.map((p) => (
            <tr key={p.id} className="hover:bg-muted/30">
              <td className="px-3 py-2">{p.propertyName}</td>
              <td className="px-3 py-2 text-right">{fmtJpy(p.amountSales)}</td>
              <td className="px-3 py-2 text-right font-medium">{fmtJpy(p.amountGrossProfit)}</td>
              <td className="px-3 py-2">
                <select
                  value={p.staffMemberId ?? ""}
                  onChange={(e) => handleChange(p.id, e.target.value)}
                  className="rounded border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary w-32"
                >
                  <option value="">未割当</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
