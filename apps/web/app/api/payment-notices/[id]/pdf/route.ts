import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

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

  const supabase = createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "認証が必要です" } },
      { status: 401 },
    );
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "組織が見つかりません" } },
      { status: 403 },
    );
  }

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
