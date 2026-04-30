"use client";

import { useOptimistic, useTransition } from "react";
import { assignStaff } from "@/app/actions/staff";

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

const fmt = (n: number | null) => n != null ? `¥${n.toLocaleString()}` : "—";

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
    startTransition(async () => {
      updateOptimistic({ propertyId, staffId: value || null, staffName: staff?.name ?? null });
      await assignStaff(propertyId, value || null);
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
              <td className="px-3 py-2 text-right">{fmt(p.amountSales)}</td>
              <td className="px-3 py-2 text-right font-medium">{fmt(p.amountGrossProfit)}</td>
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
