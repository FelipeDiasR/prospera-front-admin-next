export interface ApproveItem {
  description: string;
  quantity: string;
  unitValue: string;
  totalItemValue: string;
}

export interface NfceRow {
  id: string;
  userUuid: string;
  userName: string;
  createdAt: string;
  url: string;
  chaveAcesso: string;
  cnpj: string;
  establishmentName: string;
  issuedDate: string;
  totalAmount: number | null;
  itemsJson: {
    items?: ApproveItem[];
    issuedTime?: string;
    [key: string]: unknown;
  };
}

export function createEmptyApproveItem(): ApproveItem {
  return {
    description: "",
    quantity: "",
    unitValue: "",
    totalItemValue: "",
  };
}

export function mapItemToRow(item: Record<string, unknown>): NfceRow {
  return {
    id: item.id as string,
    userUuid: (item.userUuid as string) || "",
    userName: (item.userName as string) || (item.userUuid as string) || "—",
    createdAt: item.createdDate as string,
    url: (item.nfceUrl as string) || "",
    chaveAcesso: (item.fingerprintKey as string) || (item.id as string) || "",
    cnpj: (item.cnpj as string) ?? "",
    establishmentName: (item.establishmentName as string) ?? "",
    issuedDate: item.issuedDate as string,
    totalAmount: item.totalAmount as number | null,
    itemsJson: (item.itemsJson as NfceRow["itemsJson"]) || {},
  };
}

export function extractErrorMessage(e: unknown): string {
  if (!e || typeof e !== "object") return "Erro inesperado.";
  const err = e as { response?: { data?: Record<string, unknown> }; message?: string };
  const d = err.response?.data;
  if (d == null) return err.message || "Erro inesperado.";
  if (typeof d.detail === "string") return d.detail;
  if (typeof d.error === "string") return d.error;
  if (Array.isArray(d.errors) && d.errors[0]) return String(d.errors[0]);
  return err.message || "Erro inesperado.";
}
