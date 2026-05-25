"use client";

import { useRef, useState, useTransition } from "react";
import { updateMemberRole, removeMember } from "@/app/actions/members";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { CallerRole } from "@/lib/auth/membership";

type MemberRole = CallerRole;

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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pendingChangeRef = useRef<{
    previous: MemberRole;
    next: MemberRole;
  } | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  const availableRoles =
    currentUserRole === "owner" ? ROLE_OPTIONS : ROLE_OPTIONS.filter((r) => r !== "owner");

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newRole = e.target.value as MemberRole;
    const previousRole = selectedRole;

    if (newRole === previousRole) return;

    pendingChangeRef.current = { previous: previousRole, next: newRole };
    // 確認待ちの間、UI上の select は古い値に戻しておく
    e.target.value = previousRole;
    setConfirmOpen(true);
  }

  function handleConfirm() {
    const pending = pendingChangeRef.current;
    if (!pending) {
      setConfirmOpen(false);
      return;
    }
    pendingChangeRef.current = null;
    setConfirmOpen(false);
    setError(null);
    setSelectedRole(pending.next);
    startTransition(async () => {
      try {
        await updateMemberRole(membershipId, pending.next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "更新に失敗しました");
        setSelectedRole(pending.previous);
      }
    });
  }

  function handleCancel(open: boolean) {
    if (!open) {
      pendingChangeRef.current = null;
      // select の表示値も元に戻す
      if (selectRef.current) {
        selectRef.current.value = selectedRole;
      }
    }
    setConfirmOpen(open);
  }

  if (isDisabled) {
    return (
      <span className="text-sm text-muted-foreground">
        {ROLE_LABELS[currentRole]}
      </span>
    );
  }

  const confirmMessage = pendingChangeRef.current
    ? `${email} の役割を ${ROLE_LABELS[pendingChangeRef.current.previous]} → ${ROLE_LABELS[pendingChangeRef.current.next]} に変更しますか？`
    : "";

  return (
    <div className="flex flex-col gap-1">
      <select
        ref={selectRef}
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
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={handleCancel}
        title="役割を変更しますか？"
        message={confirmMessage}
        confirmLabel="変更する"
        onConfirm={handleConfirm}
        isPending={isPending}
      />
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const name = displayName ?? "このメンバー";

  function handleConfirm() {
    setConfirmOpen(false);
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
        onClick={() => setConfirmOpen(true)}
        disabled={isPending}
        className="text-xs text-destructive hover:underline disabled:opacity-50"
      >
        {isPending ? "削除中..." : "削除"}
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="メンバーを削除しますか？"
        message={`${name}を削除しますか？`}
        confirmLabel="削除する"
        variant="destructive"
        onConfirm={handleConfirm}
        isPending={isPending}
      />
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
