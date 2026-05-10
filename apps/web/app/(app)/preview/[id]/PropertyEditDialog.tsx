"use client";

import { useState, useTransition } from "react";
import { Pencil, Loader2 } from "lucide-react";
import { updateProperty } from "@/app/actions/property";

/**
 * 進化版要件1 (260510): 抽出後の物件データを修正できる編集ダイアログ。
 *
 * 数値フィールドは半角数字のみを受け付け、各カテゴリの税抜と消費税を
 * それぞれ編集可能。立替金（非課税・税抜=税込）も編集対象。
 */

interface StaffOption {
  id: string;
  name: string;
}

export interface PropertyEditValues {
  id: string;
  property_name: string;
  contract_no: string | null;
  work_summary: string | null;
  amount_sales: number;
  amount_shaho: number;
  amount_seisanka: number;
  amount_material: number;
  amount_sales_tax: number;
  amount_shaho_tax: number;
  amount_seisanka_tax: number;
  amount_material_tax: number;
  amount_tatekae: number;
  staff_member_id: string | null;
}

interface PropertyEditDialogProps {
  property: PropertyEditValues;
  staffOptions: StaffOption[];
}

type FormValues = {
  property_name: string;
  contract_no: string;
  work_summary: string;
  amount_sales: string;
  amount_shaho: string;
  amount_seisanka: string;
  amount_material: string;
  amount_sales_tax: string;
  amount_shaho_tax: string;
  amount_seisanka_tax: string;
  amount_material_tax: string;
  amount_tatekae: string;
  staff_member_id: string;
};

function toFormValues(p: PropertyEditValues): FormValues {
  return {
    property_name: p.property_name,
    contract_no: p.contract_no ?? "",
    work_summary: p.work_summary ?? "",
    amount_sales: String(p.amount_sales ?? 0),
    amount_shaho: String(p.amount_shaho ?? 0),
    amount_seisanka: String(p.amount_seisanka ?? 0),
    amount_material: String(p.amount_material ?? 0),
    amount_sales_tax: String(p.amount_sales_tax ?? 0),
    amount_shaho_tax: String(p.amount_shaho_tax ?? 0),
    amount_seisanka_tax: String(p.amount_seisanka_tax ?? 0),
    amount_material_tax: String(p.amount_material_tax ?? 0),
    amount_tatekae: String(p.amount_tatekae ?? 0),
    staff_member_id: p.staff_member_id ?? "",
  };
}

function parseInteger(raw: string): number {
  // 全角→半角、カンマ・スペース除去
  const normalized = raw.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  ).replace(/[,\s]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export function PropertyEditDialog({ property, staffOptions }: PropertyEditDialogProps) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<FormValues>(() => toFormValues(property));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openDialog() {
    setValues(toFormValues(property));
    setError(null);
    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
  }

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        await updateProperty({
          propertyId: property.id,
          property_name: values.property_name.trim() || property.property_name,
          contract_no: values.contract_no.trim() || null,
          work_summary: values.work_summary.trim() || null,
          amount_sales: parseInteger(values.amount_sales),
          amount_shaho: Math.max(0, parseInteger(values.amount_shaho)),
          amount_seisanka: Math.max(0, parseInteger(values.amount_seisanka)),
          amount_material: Math.max(0, parseInteger(values.amount_material)),
          amount_sales_tax: Math.max(0, parseInteger(values.amount_sales_tax)),
          amount_shaho_tax: Math.max(0, parseInteger(values.amount_shaho_tax)),
          amount_seisanka_tax: Math.max(0, parseInteger(values.amount_seisanka_tax)),
          amount_material_tax: Math.max(0, parseInteger(values.amount_material_tax)),
          amount_tatekae: parseInteger(values.amount_tatekae),
          staff_member_id: values.staff_member_id || null,
        });
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "更新に失敗しました");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="inline-flex items-center gap-1 rounded border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
        aria-label={`${property.property_name} を編集`}
      >
        <Pencil className="w-3 h-3" />
        編集
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`edit-dialog-title-${property.id}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDialog();
          }}
        >
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-background shadow-lg">
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <h2
                  id={`edit-dialog-title-${property.id}`}
                  className="text-lg font-semibold"
                >
                  物件データを編集
                </h2>
                <button
                  type="button"
                  onClick={closeDialog}
                  className="text-sm text-muted-foreground hover:text-foreground"
                  aria-label="閉じる"
                >
                  ✕
                </button>
              </div>

              {error && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="物件名">
                  <input
                    type="text"
                    value={values.property_name}
                    onChange={(e) => update("property_name", e.target.value)}
                    className={inputClass}
                    required
                  />
                </Field>
                <Field label="契約番号">
                  <input
                    type="text"
                    value={values.contract_no}
                    onChange={(e) => update("contract_no", e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>

              <Field label="工事概要">
                <input
                  type="text"
                  value={values.work_summary}
                  onChange={(e) => update("work_summary", e.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="班長">
                <select
                  value={values.staff_member_id}
                  onChange={(e) => update("staff_member_id", e.target.value)}
                  className={inputClass}
                >
                  <option value="">未割当</option>
                  {staffOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>

              <fieldset className="rounded-md border p-3 space-y-2">
                <legend className="px-1 text-xs font-medium">金額（税抜 / 消費税）</legend>
                <div className="grid grid-cols-2 gap-3">
                  <NumPair
                    label="①一般売上"
                    excl={values.amount_sales}
                    tax={values.amount_sales_tax}
                    onExcl={(v) => update("amount_sales", v)}
                    onTax={(v) => update("amount_sales_tax", v)}
                  />
                  <NumPair
                    label="②社保"
                    excl={values.amount_shaho}
                    tax={values.amount_shaho_tax}
                    onExcl={(v) => update("amount_shaho", v)}
                    onTax={(v) => update("amount_shaho_tax", v)}
                  />
                  <NumPair
                    label="③生産課"
                    excl={values.amount_seisanka}
                    tax={values.amount_seisanka_tax}
                    onExcl={(v) => update("amount_seisanka", v)}
                    onTax={(v) => update("amount_seisanka_tax", v)}
                  />
                  <NumPair
                    label="④材料費"
                    excl={values.amount_material}
                    tax={values.amount_material_tax}
                    onExcl={(v) => update("amount_material", v)}
                    onTax={(v) => update("amount_material_tax", v)}
                  />
                </div>
                <Field label="立替金（非課税・税抜=税込）">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={values.amount_tatekae}
                    onChange={(e) => update("amount_tatekae", e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </fieldset>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={isPending}
                  className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function NumPair({
  label,
  excl,
  tax,
  onExcl,
  onTax,
}: {
  label: string;
  excl: string;
  tax: string;
  onExcl: (value: string) => void;
  onTax: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium">{label}</div>
      <input
        type="text"
        inputMode="numeric"
        value={excl}
        onChange={(e) => onExcl(e.target.value)}
        className={inputClass}
        placeholder="税抜"
        aria-label={`${label} 税抜`}
      />
      <input
        type="text"
        inputMode="numeric"
        value={tax}
        onChange={(e) => onTax(e.target.value)}
        className={`${inputClass} text-muted-foreground`}
        placeholder="消費税"
        aria-label={`${label} 消費税`}
      />
    </div>
  );
}
