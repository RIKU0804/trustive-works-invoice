export type ClassificationCategory = "sales" | "shaho" | "seisanka" | "material" | "tatekae";
export type ClassificationMethod = "rule" | "ai" | "manual";

export type AggregatedProperty = {
  property_name: string;
  contract_no: string;
  koji_label: string;
  amount_sales: number;
  amount_shaho: number;
  amount_seisanka: number;
  amount_materials: number;
  /**
   * 立替金 (非課税・税抜=税込)。
   * amount_sales には含まれているが、振込金額照合の税抜逆算で
   * 1.1 で割らない補正に使うため別途追跡する。
   */
  amount_tatekae: number;
  amount_other: number;
  gross_profit: number;
};

export type ClassifiedLine = {
  property_name: string;
  contract_no: string;
  work_type: string;
  note: string;
  amount_excl_tax: number;
  consumption_tax: number;
  amount_incl_tax: number;
  category: ClassificationCategory;
  classification_confidence: number;
  classification_method: ClassificationMethod;
  ai_reasoning: string | null;
};

export type AIClassificationRecord = {
  line_index: number;
  prompt_input: Record<string, unknown>;
  ai_response: Record<string, unknown> | null;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  error: string | null;
};

export type ParseResponse = {
  payment_date: string | null;
  transfer_amount: number | null;
  offset_amount: number | null;
  /** PDF 記載の工事代計（税抜）。振込金額照合のクロスチェック用。 */
  pdf_koujidai_zeinuki: number | null;
  /** PDF 記載の工事代計（税込）。振込金額照合のクロスチェック用。 */
  pdf_koujidai_zeikomi: number | null;
  properties: AggregatedProperty[];
  lines: ClassifiedLine[];
  ai_classifications: AIClassificationRecord[];
  raw_row_count: number;
};
