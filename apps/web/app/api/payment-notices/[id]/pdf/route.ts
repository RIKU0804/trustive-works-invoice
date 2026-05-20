import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveCaller } from "@/lib/auth/membership";

const STORAGE_BUCKET = "payment-notices";
const SIGNED_URL_TTL_SECONDS = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(): NextResponse {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "PDFが見つかりません" } },
    { status: 404 },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id } = params;

  if (!id || !UUID_RE.test(id)) {
    return notFound();
  }

  const caller = await resolveCaller();

  if (caller.kind === "unauthenticated") {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "認証が必要です" } },
      { status: 401 },
    );
  }
  if (caller.kind === "no-membership") {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "組織が見つかりません" } },
      { status: 403 },
    );
  }
  if (caller.kind === "error") {
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "メンバーシップの取得に失敗しました" } },
      { status: 500 },
    );
  }

  const { membership } = caller.ctx;
  const serviceClient = createServiceClient();

  const { data: notice, error: noticeError } = await serviceClient
    .from("payment_notices")
    .select("storage_path, file_name, organization_id")
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();

  if (noticeError || !notice) {
    // Hide existence: return 404 for any non-matching id (incl. cross-org)
    return notFound();
  }

  const { data: signed, error: signError } = await serviceClient.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(notice.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: notice.file_name,
    });

  if (signError || !signed?.signedUrl) {
    return NextResponse.json(
      {
        error: {
          code: "STORAGE_ERROR",
          message: "PDFのダウンロードURL生成に失敗しました",
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.redirect(signed.signedUrl, { status: 302 });
}
