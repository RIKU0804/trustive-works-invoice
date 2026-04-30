"use client";

import { useRouter } from "next/navigation";

type Props = {
  months: string[];
  selected: string | null;
};

export default function MonthSelect({ months, selected }: Props) {
  const router = useRouter();

  if (months.length === 0) {
    return (
      <span className="text-sm text-muted-foreground">対象月なし</span>
    );
  }

  return (
    <select
      value={selected ?? ""}
      onChange={(e) => {
        router.push(`/properties?month=${e.target.value}`);
      }}
      className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {months.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}
