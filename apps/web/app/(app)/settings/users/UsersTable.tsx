"use client";

import { useState, useTransition } from "react";
import { updateMemberRole, removeMember } from "@/app/actions/members";

type MemberRole = "owner" | "admin" | "member";

interface MemberRow {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: MemberRole;
  joinedAt: string;
}

interface UsersTableProps {
  members: MemberRow[];
  currentUserId: string;
  currentUserRole: MemberRole;
}

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "オーナー",
  admin: "管理者",
  member: "メンバー",
};

const ROLE_OPTIONS: MemberRole[] = ["owner", "admin", "member"];

function RoleSelect({
  membershipId,
  email,
  currentRole,
  isDisabled,
  currentUserRole,
}: {
  membershipId: string;
  email: string;
  currentRole: MemberRole;
  isDisabled: boolean;
  currentUserRole: MemberRole;
}) {
  const [selectedRole, setSelectedRole] = useState<MemberRole>(currentRole);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const availableRoles =
    currentUserRole === "owner" ? ROLE_OPTIONS : ROLE_OPTIONS.filter((r) => r !== "owner");

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newRole = e.target.value as MemberRole;
    const previousRole = selectedRole;

    if (newRole === previousRole) return;

    const confirmed = confirm(
      `${email} の役割を ${ROLE_LABELS[previousRole]} → ${ROLE_LABELS[newRole]} に変更しますか？`
    );
    if (!confirmed) {
      // ユーザーがキャンセルした場合、selectの値を元に戻す
      e.target.value = previousRole;
      return;
    }

    setError(null);
    setSelectedRole(newRole);
    startTransition(async () => {
      try {
        await updateMemberRole(membershipId, newRole);
      } catch (err) {
        setError(err instanceof Error ? err.message : "更新に失敗しました");
        // 失敗時は元のロールへ復元
        setSelectedRole(previousRole);
      }
    });
  }

  if (isDisabled) {
    return (
      <span className="text-sm text-muted-foreground">
        {ROLE_LABELS[currentRole]}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        value={selectedRole}
        onChange={handleChange}
        disabled={isPending}
        className="rounded-md border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 bg-background"
      >
        {availableRoles.map((role) => (
          <option key={role} value={role}>
            {ROLE_LABELS[role]}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function RemoveButton({
  membershipId,
  displayName,
}: {
  membershipId: string;
  displayName: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    const name = displayName ?? "このメンバー";
    if (!confirm(`${name}を削除しますか？`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await removeMember(membershipId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "削除に失敗しました");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1 items-end">
      <button
        onClick={handleClick}
        disabled={isPending}
        className="text-xs text-destructive hover:underline disabled:opacity-50"
      >
        {isPending ? "削除中..." : "削除"}
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function UsersTable({
  members,
  currentUserId,
  currentUserRole,
}: UsersTableProps) {
  const canManage = currentUserRole === "owner" || currentUserRole === "admin";

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium">メールアドレス</th>
            <th className="px-4 py-3 text-left font-medium">表示名</th>
            <th className="px-4 py-3 text-left font-medium">役割</th>
            <th className="px-4 py-3 text-left font-medium">参加日</th>
            {canManage && (
              <th className="px-4 py-3 text-right font-medium">操作</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y">
          {members.map((member) => {
            const isSelf = member.userId === currentUserId;
            const isOwner = member.role === "owner";

            return (
              <tr key={member.membershipId} className="hover:bg-muted/30">
                <td className="px-4 py-3">{member.email}</td>
                <td className="px-4 py-3 font-medium">
                  {member.displayName ?? "—"}
                  {isSelf && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      （自分）
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {canManage && !isSelf ? (
                    <RoleSelect
                      membershipId={member.membershipId}
                      email={member.email}
                      currentRole={member.role}
                      isDisabled={false}
                      currentUserRole={currentUserRole}
                    />
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {ROLE_LABELS[member.role]}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(member.joinedAt).toLocaleDateString("ja-JP")}
                </td>
                {canManage && (
                  <td className="px-4 py-3 text-right">
                    {!isSelf && !isOwner && (
                      <RemoveButton
                        membershipId={member.membershipId}
                        displayName={member.displayName}
                      />
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {members.length === 0 && (
            <tr>
              <td
                colSpan={canManage ? 5 : 4}
                className="px-4 py-8 text-center text-muted-foreground text-sm"
              >
                メンバーがいません
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
