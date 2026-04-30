export type Property = {
  id: string;
  propertyName: string;
  contractNo: string | null;
  workSummary: string | null;
  amounts: {
    sales: number;
    shaho: number;
    seisanka: number;
    material: number;
    grossProfit: number;
  };
  grossProfitRate: number;
  staff: StaffMember | null;
  reportMonth: string;
  paymentDate: string | null;
};

export type PropertyLine = {
  id: string;
  workType: string;
  amountExclTax: number;
  consumptionTax: number;
  amountInclTax: number;
  note: string;
  category: "sales" | "shaho" | "seisanka" | "material";
  isManuallyOverridden: boolean;
};

export type StaffMember = {
  id: string;
  name: string;
  isActive: boolean;
};

export type PaymentNotice = {
  id: string;
  organizationId: string;
  fileName: string;
  reportMonth: string;
  paymentDate: string | null;
  transferAmount: number | null;
  parseStatus: "pending" | "parsing" | "completed" | "failed";
  uploadedAt: string;
  finalizedAt: string | null;
};

export type UserRole = "owner" | "admin" | "member";
