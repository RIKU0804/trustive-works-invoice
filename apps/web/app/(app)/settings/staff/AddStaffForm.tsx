"use client";

import { useState, useTransition } from "react";
import { addStaffMember } from "@/app/actions/staff";

export function AddStaffForm() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.append("name", name.trim());
    startTransition(async () => {
      try {
        await addStaffMember(fd);
        setName("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "追加に失敗しました");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="担当者名を入力"
        className="flex-1 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        disabled={isPending}
      />
      <button
        type="submit"
        disabled={!name.trim() || isPending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
      >
        {isPending ? "追加中..." : "追加"}
      </button>
      {error && <p className="text-xs text-destructive self-center">{error}</p>}
    </form>
  );
}
