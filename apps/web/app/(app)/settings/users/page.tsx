import { resolveCaller } from "@/lib/auth/membership";
import { UsersTable } from "./UsersTable";
import { InviteForm } from "./InviteForm";

type MemberRole = "owner" | "admin" | "member";

interface MemberRow {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: MemberRole;
  joinedAt: string;
}

export default async function UsersSettingsPage() {
  const caller = await resolveCaller();

  if (caller.kind === "unauthenticated") {
    return (
      <div className="space-y-6 max-w-3xl">
        <h1 className="text-xl font-semibold">ユーザー管理</h1>
        <p className="text-sm text-destructive">認証が必要です</p>
      </div>
    );
  }

  if (caller.kind === "no-membership") {
    return (
      <div className="space-y-6 max-w-3xl">
        <h1 className="text-xl font-semibold">ユーザー管理</h1>
        <p className="text-sm text-destructive">
          組織のメンバーシップが見つかりません
        </p>
      </div>
    );
  }

  if (caller.kind === "error") {
    return (
      <div className="space-y-6 max-w-3xl">
        <h1 className="text-xl font-semibold">ユーザー管理</h1>
        <p className="text-sm text-destructive">
          メンバーシップの取得に失敗しました
        </p>
      </div>
    );
  }

  const { supabase, user, membership } = caller.ctx;
  const orgId = membership.organization_id;
  const currentUserRole = membership.role;

  const { data: memberships, error: membershipsError } = await supabase
    .from("memberships")
    .select("id, user_id, role, joined_at")
    .eq("organization_id", orgId)
    .order("joined_at");

  if (membershipsError) {
    return (
      <div className="space-y-6 max-w-3xl">
        <h1 className="text-xl font-semibold">ユーザー管理</h1>
        <p className="text-sm text-destructive">
          メンバー情報の取得に失敗しました
        </p>
      </div>
    );
  }

  const userIds = (memberships ?? []).map((m) => m.user_id);

  const { data: usersData, error: usersError } = await supabase
    .from("users")
    .select("id, email, display_name")
    .in("id", userIds.length > 0 ? userIds : [""]);

  if (usersError) {
    return (
      <div className="space-y-6 max-w-3xl">
        <h1 className="text-xl font-semibold">ユーザー管理</h1>
        <p className="text-sm text-destructive">
          ユーザー情報の取得に失敗しました
        </p>
      </div>
    );
  }

  const usersById = new Map(
    (usersData ?? []).map((u) => [u.id, u])
  );

  const members: MemberRow[] = (memberships ?? []).map((m) => {
    const userData = usersById.get(m.user_id);
    return {
      membershipId: m.id,
      userId: m.user_id,
      email: userData?.email ?? "(不明)",
      displayName: userData?.display_name ?? null,
      role: m.role as MemberRole,
      joinedAt: m.joined_at,
    };
  });

  const canInvite =
    currentUserRole === "owner" || currentUserRole === "admin";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold">ユーザー管理</h1>
        <p className="text-sm text-muted-foreground mt-1">
          組織のメンバーと役割を管理します
        </p>
      </div>

      {canInvite && <InviteForm />}

      <UsersTable
        members={members}
        currentUserId={user.id}
        currentUserRole={currentUserRole as MemberRole}
      />
    </div>
  );
}
