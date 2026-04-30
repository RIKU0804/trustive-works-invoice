"use client";

import { useState, useTransition } from "react";
import { inviteMember } from "@/app/actions/members";

type InvitableRole = "admin" | "member";

const ROLE_LABELS: Record<InvitableRole, string> = {
  admin: "管理者",
  member: "メンバー",
};

export function InviteForm() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("member");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setError("メールアドレスを入力してください");
      return;
    }

    startTransition(async () => {
      try {
        await inviteMember(trimmed, role);
        // メール列挙攻撃対策: 既存/新規いずれかを区別する情報は出さず、常に同じ文言
        setSuccessMessage(`${trimmed} 宛に招待を送信しました`);
        setEmail("");
        setRole("member");
      } catch (err) {
        setError(err instanceof Error ? err.message : "招待に失敗しました");
      }
    });
  }

  return (
    <div className="rounded-lg border p-4 bg-card">
      <h2 className="text-base font-semibold mb-1">メンバーを招待</h2>
      <p className="text-sm text-muted-foreground mb-4">
        メールアドレス宛に招待リンクを送信します
      </p>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <label
            htmlFor="invite-email"
            className="block text-xs font-medium mb-1"
          >
            メールアドレス
          </label>
          <input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isPending}
            placeholder="user@example.com"
            className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 bg-background"
            required
          />
        </div>

        <div className="sm:w-40">
          <label
            htmlFor="invite-role"
            className="block text-xs font-medium mb-1"
          >
            役割
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as InvitableRole)}
            disabled={isPending}
            className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 bg-background"
          >
            {(Object.keys(ROLE_LABELS) as InvitableRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "送信中..." : "招待を送信"}
        </button>
      </form>

      {error && (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      )}
      {successMessage && (
        <p className="mt-3 text-sm text-green-600">{successMessage}</p>
      )}
    </div>
  );
}
