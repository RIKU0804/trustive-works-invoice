"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { getCallerContext } from "@/lib/auth/membership";
import { logAction } from "@/lib/audit";
import type { Database } from "@/lib/supabase/types";

type PropertyUpdate = Database["public"]["Tables"]["properties"]["Update"];

/**
 * 進化版要件1 (260510): 「dataを読み込んだ後、修正できるようにしたい」
 *
 * 抽出後の物件データを手動で修正するための server action。
 * - 数値フィールド（売上/社保/生産課/材料費の税抜・消費税、立替金）を編集可能
 * - 工事概要、班長は別途編集可能
 *
 * セキュリティ:
 *  - 認証必須
 *  - クロスオーグ修正をブロック
 *  - 監査ログを残す
 */

const updatePropertySchema = z.object({
  propertyId: z.string().uuid(),
  property_name: z.string().min(1).max(200).optional(),
  contract_no: z.string().max(64).nullable().optional(),
  work_summary: z.string().max(200).nullable().optional(),
  amount_sales: z.number().int().optional(),
  amount_shaho: z.number().int().min(0).optional(),
  amount_seisanka: z.number().int().min(0).optional(),
  amount_material: z.number().int().min(0).optional(),
  amount_sales_tax: z.number().int().min(0).optional(),
  amount_shaho_tax: z.number().int().min(0).optional(),
  amount_seisanka_tax: z.number().int().min(0).optional(),
  amount_material_tax: z.number().int().min(0).optional(),
  amount_tatekae: z.number().int().optional(),
  staff_member_id: z.string().uuid().nullable().optional(),
});

export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;

export async function updateProperty(input: UpdatePropertyInput): Promise<void> {
  const parsed = updatePropertySchema.parse(input);
  const { propertyId, ...updates } = parsed;

  const { user, membership } = await getCallerContext();
  const serviceClient = createServiceClient();

  // 対象物件の組織所属確認（クロスオーグ修正の防止）
  const { data: existing, error: fetchError } = await serviceClient
    .from("properties")
    .select("id, organization_id, payment_notice_id, property_name")
    .eq("id", propertyId)
    .single();

  if (fetchError || !existing) {
    throw new Error("対象物件が見つかりません");
  }

  if (existing.organization_id !== membership.organization_id) {
    throw new Error("この物件を編集する権限がありません");
  }

  // undefined のフィールドは送信しない（null は明示クリアとして許容）
  // PropertyUpdate 型に絞り込んで Supabase クライアントの型推論と整合させる。
  const patch: PropertyUpdate = {
    updated_at: new Date().toISOString(),
  };
  if (updates.property_name !== undefined) patch.property_name = updates.property_name;
  if (updates.contract_no !== undefined) patch.contract_no = updates.contract_no;
  if (updates.work_summary !== undefined) patch.work_summary = updates.work_summary;
  if (updates.amount_sales !== undefined) patch.amount_sales = updates.amount_sales;
  if (updates.amount_shaho !== undefined) patch.amount_shaho = updates.amount_shaho;
  if (updates.amount_seisanka !== undefined) patch.amount_seisanka = updates.amount_seisanka;
  if (updates.amount_material !== undefined) patch.amount_material = updates.amount_material;
  if (updates.amount_sales_tax !== undefined) patch.amount_sales_tax = updates.amount_sales_tax;
  if (updates.amount_shaho_tax !== undefined) patch.amount_shaho_tax = updates.amount_shaho_tax;
  if (updates.amount_seisanka_tax !== undefined) patch.amount_seisanka_tax = updates.amount_seisanka_tax;
  if (updates.amount_material_tax !== undefined) patch.amount_material_tax = updates.amount_material_tax;
  if (updates.amount_tatekae !== undefined) patch.amount_tatekae = updates.amount_tatekae;
  if (updates.staff_member_id !== undefined) patch.staff_member_id = updates.staff_member_id;

  const changedFields = Object.keys(patch).filter((k) => k !== "updated_at");

  const { error: updateError } = await serviceClient
    .from("properties")
    .update(patch)
    .eq("id", propertyId);

  if (updateError) {
    throw new Error(`更新に失敗しました: ${updateError.message}`);
  }

  await logAction(
    serviceClient,
    membership.organization_id,
    user.id,
    "property.update",
    { type: "property", id: propertyId },
    {
      property_name: existing.property_name,
      changed_fields: changedFields,
    }
  );

  // プレビュー画面と関連ページを再検証
  revalidatePath(`/preview/${existing.payment_notice_id}`);
  revalidatePath("/properties");
  revalidatePath("/dashboard");
}
