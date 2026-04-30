# 08. 開発ロードマップ・タスク分解

## 全体スケジュール感

各フェーズは依頼者のレビューを経て次へ進む。**勝手に次フェーズに進まない**こと。

| フェーズ | 内容 | 目安 |
|---|---|---|
| P0 | Python APIサーバー構築＋既存invoice-toolロジック移植 | 1週 |
| P1 | プロジェクト基盤（Next.js + Supabase + 認証） | 1週 |
| P2 | PDFアップロード→Python API連携→プレビュー→DB保存 | 1〜2週 |
| P3 | 担当者マスタ＋割り当てUI | 1週 |
| P4 | ダッシュボード＋邸一覧＋検索 | 1〜2週 |
| **P5** | **AI分類機能（並列バリデーション）** | **1週** |
| P6 | Excel出力（両フォーマット） | 1週 |
| P7 | 月次メモ・邸詳細・仕上げ | 1週 |
| P8 | 社内テスト・本番移行 | 1週 |
| --- | --- | --- |
| P9（将来） | AIルール提案機能（蓄積データから） | 後日 |

---

## P0: Python APIサーバー構築

**ゴール**: PDFを送ると、JSONで邸ごとの集計値が返るREST API。既存invoice-toolと同等の精度。

### タスク

- [ ] FastAPI プロジェクト初期化（`apps/api/`）
- [ ] 既存invoice-toolの主要コードをコピー＆Pydantic化
  - [ ] `pdf_parser.py`（plumber_extractor.pyベース）
  - [ ] `classifier.py`（excel_writer.py の `classify_and_aggregate` ベース）
- [ ] `POST /pdf/parse` エンドポイント実装
- [ ] X-API-Keyによる簡易認証
- [ ] 単体テスト
  - [ ] `test_classifier.py`（必須ケースを `03-business-logic.md` 参照）
  - [ ] `test_parser.py`
- [ ] 結合テスト: `reference/sample-data.md` の期待値と完全一致
- [ ] Railway/Render にデプロイ
- [ ] curl/Postmanで動作確認

### 完了条件

```bash
$ curl -X POST https://api.example.com/pdf/parse \
    -H "X-API-Key: ..." \
    -H "X-Organization-Id: org-uuid" \
    -F "file=@2025年1月支払通知書.pdf"

{
  "payment_date": "2025-01-20",
  "transfer_amount": 10933813,
  "properties": [
    {"property_name": "西尾 友成", "amount_sales": 161028, ...},
    ...
  ]
}
```

サンプルデータの全邸が完全一致したらレビュー。

---

## P1: Next.js基盤

**ゴール**: ログインできる空のNext.jsアプリ。

### タスク

- [ ] Next.js 14（App Router）+ TypeScript プロジェクト作成（`apps/web/`）
- [ ] Tailwind CSS + shadcn/ui セットアップ
- [ ] Supabase プロジェクト作成（Free tier）
- [ ] DB マイグレーション
  - [ ] `02-data-model.md` のスキーマで初回マイグレーション
  - [ ] RLSポリシー設定
  - [ ] シードデータ（山本さん組織＋班長3名）
- [ ] Supabase Auth セットアップ
  - [ ] Google OAuth プロバイダ設定
  - [ ] ログインページ・コールバックルート
  - [ ] middleware.ts で認証ガード
- [ ] レイアウト（サイドバー・ヘッダー）
- [ ] Supabase 型定義の自動生成
- [ ] Vercel初回デプロイ

### 完了条件

- ローカルとVercelで「Googleでログイン → 空のダッシュボードが表示される」が動く
- 別ユーザーでログインしても他組織のデータが見えない（RLSの動作確認）

---

## P2: PDFアップロード〜DB保存

**ゴール**: アップロードしたPDFが集計されてDBに保存される。

### タスク

- [ ] Python APIクライアント実装（`lib/python-api/`）
- [ ] Supabase Storage バケット作成（`payment-notices`）
- [ ] `app/api/pdf/parse/route.ts` 実装
  - [ ] ファイル受信→Storage保存→Python API呼び出し→結果を返す
- [ ] `S04 アップロード画面` 実装
- [ ] `S05 プレビュー画面` 実装
  - [ ] 邸ごとのカード表示（accordion）
  - [ ] カテゴリ別の色分け
  - [ ] 個別行のオーバーライド機能
  - [ ] 確定ボタン
- [ ] `finalizePaymentNotice` Server Action 実装
- [ ] エラーハンドリング・トースト通知

### 完了条件

- PDFをアップロード → 邸ごとの抽出結果が画面に表示される
- 「確定」を押すとDBに保存される
- 個別行のカテゴリ変更が反映される

---

## P3: 担当者マスタ＋割り当て

**ゴール**: 担当者を管理し、邸に一括割り当てできる。

### タスク

- [ ] `S08 担当者マスタ画面`（管理者のみ）
- [ ] `S06 担当者割り当て画面`
  - [ ] 担当者選択 → 邸チェック → 一括割当のフロー
- [ ] `assignStaffToProperties` Server Action
- [ ] `S09 ユーザー管理画面`（管理者のみ）

---

## P4: ダッシュボード＋邸一覧

**ゴール**: 業務用に使えるダッシュボードと一覧画面。

### タスク

- [ ] `S02 ダッシュボード`
- [ ] `S03 邸一覧`
- [ ] `S07 邸詳細`

---

## P5: AI分類機能（並列バリデーション）

**ゴール**: ルールベースとAIの並列バリデーションで、新しい備考表現にも自動適応。

### タスク

詳細は [`09-ai-classification.md`](./09-ai-classification.md) 参照。

- [ ] DBテーブル追加
  - [ ] `classification_corrections`
  - [ ] `classification_logs`
- [ ] Python API側
  - [ ] Anthropic SDK セットアップ
  - [ ] `calculate_rule_confidence` 実装
  - [ ] `classify_by_claude` 実装
  - [ ] `fetch_similar_corrections` 実装
  - [ ] 並列バリデーションロジック
- [ ] フロント側
  - [ ] S05 プレビュー画面に信頼度アイコン追加
  - [ ] needs_review の行をデフォルト展開
  - [ ] AI判定理由の表示
  - [ ] 修正履歴の自動記録
- [ ] コスト監視
  - [ ] `classification_logs` に料金記録
  - [ ] 月次レポート機能（簡易）
- [ ] テスト
  - [ ] 既知パターン → AIに送られない
  - [ ] 未知パターン → AIに送られて正しく分類
  - [ ] AI失敗時のフォールバック

### 完了条件

- 「中口応援補填」など見慣れない表現を含むPDFを処理して、AIが正しく③に分類する
- ルールとAIが一致する行は自動で確定、不一致の行はUIで強調表示
- 修正履歴がDBに溜まり、次回以降のAI判定でFew-shot使用される

---

## P6: Excel出力

**ゴール**: 既存フォーマット・シンプル両方のExcelがダウンロードできる。

### タスク

- [ ] ExcelJS導入
- [ ] `lib/excel/exporter.ts` 実装
  - [ ] `exportLegacy()` ：既存フォーマット再現
  - [ ] `exportSimple()` ：シンプル一覧
- [ ] `app/api/excel/export/route.ts`
- [ ] `S11 Excel出力画面`

---

## P7: 仕上げ

**ゴール**: MVP完成、社内テスト準備完了。

### タスク

- [ ] `S10 月次メモ`
- [ ] `audit_logs` の記録開始
- [ ] エラー画面・404・ローディング状態
- [ ] レスポンシブ対応（タブレット）
- [ ] パフォーマンスチェック
- [ ] セキュリティチェック（RLS全テーブル確認）

---

## P8: 社内テスト・本番移行

**ゴール**: 山本さんの会社で実運用開始。

### タスク

- [ ] 社内ユーザー招待
- [ ] 過去データ取り込み
- [ ] フィードバック収集
- [ ] 緊急修正
- [ ] 運用開始

---

## P9: AIルール提案機能（フェーズ2）

実データが3ヶ月以上溜まってから着手：

- [ ] `classification_rules` テーブル
- [ ] パターンクラスタリング処理
- [ ] S12 ルール提案画面
- [ ] 統合判定エンジン（既存ルール + 追加ルール）

---

## やらないこと（明示）

以下はMVPに含めない。フェーズ2以降で検討：

- 請求書（自社発行）との照合
- スキャンPDFのOCR
- 賞与計算の自動シミュレーション
- 社外公開
- スマホ最適化
- 多言語対応
- 課金実装（Stripe等）
- 外注小林・南の入力フォーム
- 別の発行元（旭化成以外）のPDFフォーマット対応
- AIによる担当者推定（邸名から自動で班長を割り当てる）
