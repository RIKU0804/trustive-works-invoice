export type ClassificationCategory = "sales" | "shaho" | "seisanka" | "material";
export type ClassificationMethod = "rule" | "ai" | "manual";

export type AggregatedProperty = {
  property_name: string;
  contract_no: string;
  koji_label: string;
  amount_sales: number;
  amount_shaho: number;
  amount_seisanka: number;
  amount_materials: number;
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
  properties: AggregatedProperty[];
  lines: ClassifiedLine[];
  ai_classifications: AIClassificationRecord[];
  raw_row_count: number;
};
