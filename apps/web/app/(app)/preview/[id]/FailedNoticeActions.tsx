"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw, Trash2 } from "lucide-react";
import { deletePaymentNotice } from "@/app/actions/notice";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/**
 * failed 状態の通知書に対する 2 つのアクションボタン:
 *  - 再アップロード: /upload に遷移
 *  - 削除: ConfirmDialog 後に server action で削除 → /dashboard へリダイレクト
 */
export function FailedNoticeActions({
  noticeId,
  fileName,
}: {
  noticeId: string;
  fileName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleReupload() {
    router.push("/upload");
  }

  function handleDeleteConfirmed() {
    setConfirmOpen(false);
    startTransition(async () => {
      try {
        await deletePaymentNotice(noticeId);
        // server action 内で redirect("/dashboard") されるため通常はここに来ない。
      } catch (err) {
        // NEXT_REDIRECT は throw として観測されるが、これはエラーではないため握り潰す。
        if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) return;
        toast.error(err instanceof Error ? err.message : "削除に失敗しました");
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleReupload}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          再アップロード
        </button>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-white text-destructive px-3 py-1.5 text-xs font-medium hover:bg-destructive/10 disabled:opacity-50 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          {isPending ? "削除中..." : "削除"}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="削除しますか？"
        message={`「${fileName}」を削除します。この操作は取り消せません。よろしいですか？`}
        confirmLabel="削除する"
        variant="destructive"
        onConfirm={handleDeleteConfirmed}
        isPending={isPending}
      />
    </>
  );
}
