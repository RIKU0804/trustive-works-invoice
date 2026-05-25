"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireOrgAdmin, type CallerRole } from "@/lib/auth/membership";
import { logAction } from "@/lib/audit";
import { userFacingError } from "@/lib/api-errors";

// HIGH H4: CallerRole を一元化し、ローカル別名の MemberRole を排除。
type MemberRole = CallerRole;
type InvitableRole = Exclude<MemberRole, "owner">;

const VALID_MEMBER_ROLES: readonly MemberRole[] = ["owner", "admin", "member"];
function isMemberRole(s: string): s is MemberRole {
  return (VALID_MEMBER_ROLES as readonly string[]).includes(s);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getTargetMembership(
  supabase: ReturnType<typeof createClient>,
  membershipId: string,
  orgId: string
) {
  const { data: target, error } = await supabase
    .from("memberships")
    .select("id, user_id, role")
    .eq("id", membershipId)
    .eq("organization_id", orgId)
    .single();

  if (error || !target) throw new Error("対象のメンバーが見つかりません");
  return target;
}

export async function updateMemberRole(
  membershipId: string,
  role: MemberRole
): Promise<void> {
  const { supabase, user, membership } = await requireOrgAdmin();
  const target = await getTargetMembership(supabase, membershipId, membership.organization_id);

  if (target.user_id === user.id) throw new Error("自分自身の役割は変更できません");
  if (role === "owner" && membership.role !== "owner") {
    throw new Error("ownerへの変更は現在のownerのみが行えます");
  }

  // HIGH H4: 文字列を unsafe cast せず型ガードで検証する。
  if (!isMemberRole(target.role)) {
    throw new Error(`invalid role in DB: ${target.role}`);
  }
  const previousRole: MemberRole = target.role;

  const { error } = await supabase
    .from("memberships")
    .update({ role })
    .eq("id", membershipId)
    .eq("organization_id", membership.organization_id);

  if (error) {
    throw userFacingError(
      `[updateMemberRole] ${error.message}`,
      "役割の更新に失敗しました"
    );
  }

  await logAction(
    supabase,
    membership.organization_id,
    user.id,
    "member.role_update",
    { type: "membership", id: membershipId },
    {
      target_user_id: target.user_id,
      before: { role: previousRole },
      after: { role },
    }
  );

  revalidatePath("/settings/users");
}

export async function removeMember(membershipId: string): Promise<void> {
  const { supabase, user, membership } = await requireOrgAdmin();
  const target = await getTargetMembership(supabase, membershipId, membership.organization_id);

  if (target.user_id === user.id) throw new Error("自分自身は削除できません");
  if (target.role === "owner") throw new Error("ownerは削除できません");

  const { error } = await supabase
    .from("memberships")
    .delete()
    .eq("id", membershipId)
    .eq("organization_id", membership.organization_id);

  if (error) {
    throw userFacingError(
      `[removeMember] ${error.message}`,
      "メンバーの削除に失敗しました"
    );
  }

  await logAction(
    supabase,
    membership.organization_id,
    user.id,
    "member.remove",
    { type: "membership", id: membershipId },
    {
      target_user_id: target.user_id,
      removed_role: target.role,
    }
  );

  revalidatePath("/settings/users");
}

export async function inviteMember(
  email: string,
  role: InvitableRole
): Promise<void> {
  const trimmedEmail = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(trimmedEmail)) {
    throw new Error("有効なメールアドレスを入力してください");
  }
  if (role !== "admin" && role !== "member") {
    throw new Error("招待時に付与できる役割は admin か member のみです");
  }

  const { supabase, user, membership } = await requireOrgAdmin();
  const orgId = membership.organization_id;

  const serviceClient = createServiceClient();

  // 既存ユーザー（public.users に存在）を検索
  const { data: existingUser, error: existingUserError } = await serviceClient
    .from("users")
    .select("id, email")
    .eq("email", trimmedEmail)
    .maybeSingle();

  if (existingUserError) {
    throw userFacingError(
      `[inviteMember] user lookup failed: ${existingUserError.message}`,
      "招待処理中にエラーが発生しました"
    );
  }

  let invitedUserId: string;
  let isNewUser: boolean;

  if (existingUser) {
    // 既存ユーザーが既にこの組織のメンバーかチェック
    const { data: existingMembership, error: existingMembershipError } = await serviceClient
      .from("memberships")
      .select("id")
      .eq("user_id", existingUser.id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (existingMembershipError) {
      throw userFacingError(
        `[inviteMember] membership check failed: ${existingMembershipError.message}`,
        "招待処理中にエラーが発生しました"
      );
    }
    if (existingMembership) {
      throw new Error("このユーザーは既にこの組織のメンバーです");
    }

    invitedUserId = existingUser.id;
    isNewUser = false;
  } else {
    // 新規ユーザーを招待
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? "";
    const redirectTo = siteUrl
      ? `${siteUrl.replace(/\/$/, "")}/callback`
      : undefined;

    const { data: inviteData, error: inviteError } =
      await serviceClient.auth.admin.inviteUserByEmail(
        trimmedEmail,
        redirectTo ? { redirectTo } : {}
      );

    if (inviteError || !inviteData?.user) {
      throw userFacingError(
        `[inviteMember] auth invite failed: ${inviteError?.message ?? "no user returned"}`,
        "招待に失敗しました。しばらく待ってから再度お試しください。"
      );
    }

    invitedUserId = inviteData.user.id;
    isNewUser = true;
  }

  // memberships に挿入（既存ユーザーの場合と新規ユーザーの場合の両方をカバー）
  // 新規ユーザーの場合、auth.users への INSERT トリガで public.users と
  // memberships が auto-insert される可能性があるので upsert する。
  const { error: membershipInsertError } = await serviceClient
    .from("memberships")
    .upsert(
      {
        user_id: invitedUserId,
        organization_id: orgId,
        role,
        invited_by: user.id,
      },
      { onConflict: "user_id,organization_id", ignoreDuplicates: false }
    );

  if (membershipInsertError) {
    throw userFacingError(
      `[inviteMember] membership insert failed: ${membershipInsertError.message}`,
      "招待処理中にエラーが発生しました"
    );
  }

  await logAction(
    serviceClient,
    orgId,
    user.id,
    "member.invite",
    { type: "user", id: invitedUserId },
    {
      email: trimmedEmail,
      role,
      is_new_user: isNewUser,
    }
  );

  revalidatePath("/settings/users");
}
