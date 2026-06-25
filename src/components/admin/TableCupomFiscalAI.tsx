"use client";

import { apiGet, apiPut } from "@/lib/api";
import { formatDate, localMidnightToIso, toApiTime, toDateInputValue, toNumber, toTimeInputValue } from "@/lib/formatters";
import { ApproveItem, createEmptyApproveItem, extractErrorMessage, mapItemToRow, NfceRow } from "@/lib/mappers";
import { useCallback, useEffect, useRef, useState } from "react";

export default function TableCupomFiscalAI() {
  const [rows, setRows] = useState<NfceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Approve modal
  const [approveOpen, setApproveOpen] = useState(false);
  const [selected, setSelected] = useState<NfceRow | null>(null);
  const [approveCnpj, setApproveCnpj] = useState("");
  const [approveEstablishment, setApproveEstablishment] = useState("");
  const [approveIssuedDate, setApproveIssuedDate] = useState("");
  const [approveIssuedTime, setApproveIssuedTime] = useState("");
  const [approveItems, setApproveItems] = useState<ApproveItem[]>([createEmptyApproveItem()]);
  const [extractedTotalAmount, setExtractedTotalAmount] = useState<number | null>(null);
  const [totalAmountInput, setTotalAmountInput] = useState("");

  // Reject modal
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReasonCode, setRejectReasonCode] = useState("");

  // AI extraction
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractProvider, setExtractProvider] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState({ show: false, message: "", type: "success" as "success" | "error" });

  const approveItemsScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiGet<{ items: Record<string, unknown>[] }>(
        "/adm/nfce/pending-human-review",
        { page: 1, pageSize: 50 }
      );
      setRows((data.items ?? []).map(mapItemToRow));
    } catch (e) {
      setLoadError(extractErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const copyUserUuid = useCallback(async (row: NfceRow) => {
    if (!row.userUuid) return;
    try {
      await navigator.clipboard.writeText(row.userUuid);
      setSnackbar({ show: true, message: "ID copiado!", type: "success" });
    } catch {
      setSnackbar({ show: true, message: "Não foi possível copiar.", type: "error" });
    }
  }, []);

  // Approve handlers
  const openApproveModal = (row: NfceRow) => {
    setSelected(row);
    setApproveCnpj(row.cnpj || "");
    setApproveEstablishment(row.establishmentName || "");
    setApproveIssuedDate(toDateInputValue(row.issuedDate) || toDateInputValue(row.createdAt) || "");
    setApproveIssuedTime(toTimeInputValue(row.itemsJson?.issuedTime) || "");
    setApproveItems([createEmptyApproveItem()]);
    setActionError(null);
    setExtractError(null);
    setExtractProvider(null);
    setImagePreview(null);
    setExtractedTotalAmount(null);
    setTotalAmountInput("");
    setApproveOpen(true);
  };

  const closeApproveModal = () => { setApproveOpen(false); setSelected(null); setActionError(null); setImagePreview(null); };

  const openRejectModal = (row: NfceRow) => {
    setSelected(row);
    setRejectReasonCode("");
    setActionError(null);
    setRejectOpen(true);
  };

  const closeRejectModal = () => { setRejectOpen(false); setSelected(null); setActionError(null); };

  // AI extraction via API route (keys are server-side!)
  const handleImageSelect = async (file: File) => {
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    setExtractError(null);
    setExtractProvider(null);
    setExtracting(true);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/nfce/extract", {
        method: "POST",
        body: formData,
      });
      const result = await res.json();

      if (!res.ok) throw new Error(result.error || "Erro na extração");

      setExtractProvider(result.provider);
      if (result.cnpj) setApproveCnpj(result.cnpj);
      if (result.establishmentName) setApproveEstablishment(result.establishmentName);
      if (result.issuedDate) setApproveIssuedDate(result.issuedDate);
      if (result.issuedTime) setApproveIssuedTime(toTimeInputValue(result.issuedTime));
      if (result.totalAmount != null) {
        setExtractedTotalAmount(result.totalAmount);
        setTotalAmountInput(String(result.totalAmount));
      } else if (result.items?.length > 0) {
        // IA não retornou totalAmount — calcula a soma dos itens
        const sum = result.items.reduce((acc: number, item: { totalItemValue?: string }) => acc + (parseFloat(item.totalItemValue || "0") || 0), 0);
        if (sum > 0) {
          setExtractedTotalAmount(sum);
          setTotalAmountInput(sum.toFixed(2));
        }
      }
      if (result.items?.length > 0) setApproveItems(result.items);

      setSnackbar({ show: true, message: `${result.items.length} itens extraídos via ${result.provider}!`, type: "success" });
    } catch (err) {
      const msg = (err as Error).message;
      setExtractError(msg);
      setSnackbar({ show: true, message: `Erro: ${msg}`, type: "error" });
    } finally {
      setExtracting(false);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImageSelect(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && (file.type.startsWith("image/") || file.type === "application/pdf")) {
      handleImageSelect(file);
    }
  };

  // Paste image from clipboard
  useEffect(() => {
    if (!approveOpen) return;
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) handleImageSelect(file);
          return;
        }
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [approveOpen]);

  // Confirm approve
  const handleConfirmApprove = async () => {
    if (!selected) return;
    const cnpj = approveCnpj.replace(/\D/g, "");
    if (!cnpj) { setActionError("Informe o CNPJ."); return; }
    const establishmentName = approveEstablishment.trim();
    if (!establishmentName) { setActionError("Informe o nome do estabelecimento."); return; }
    const issuedIso = localMidnightToIso(approveIssuedDate);
    if (!issuedIso) { setActionError("Data de emissão inválida."); return; }

    const normalizedItems = approveItems
      .map((item) => ({
        description: item.description.trim(),
        quantity: toNumber(item.quantity),
        unitValue: toNumber(item.unitValue),
        totalItemValue: toNumber(item.totalItemValue),
      }))
      .filter((item) => item.description || item.quantity != null || item.unitValue != null || item.totalItemValue != null);

    if (normalizedItems.length === 0) { setActionError("Adicione ao menos um item."); return; }

    const hasInvalid = normalizedItems.some((i) => !i.description || i.quantity == null || i.unitValue == null || i.totalItemValue == null);
    if (hasInvalid) { setActionError("Preencha todos os campos de cada item."); return; }

    const itemsSum = normalizedItems.reduce((acc, i) => acc + (i.totalItemValue ?? 0), 0);
    const totalAmountReais = extractedTotalAmount && extractedTotalAmount > 0 ? extractedTotalAmount : itemsSum;
    const totalAmount = Math.round(totalAmountReais * 100);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) { setActionError("Total inválido."); return; }

    const issuedTime = toApiTime(approveIssuedTime);

    const payload = {
      status: "SUCCESS",
      cnpj,
      establishmentName,
      totalAmount,
      issuedDate: issuedIso,
      ...(issuedTime ? { issuedTime } : {}),
      itemsJson: {
        cnpj: approveCnpj.trim(),
        items: normalizedItems,
        issuedDate: approveIssuedDate,
        totalAmount: totalAmountReais,
        ...(issuedTime ? { issuedTime } : {}),
      },
    };

    setSubmitting(true);
    setActionError(null);
    try {
      await apiPut(`/adm/nfce/pending-human-review/${selected.id}`, payload);
      setRows((prev) => prev.filter((r) => r.id !== selected.id));
      closeApproveModal();
    } catch (e) {
      setActionError(extractErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmReject = async () => {
    if (!selected || !rejectReasonCode) { setActionError("Selecione um motivo."); return; }
    setSubmitting(true);
    setActionError(null);
    try {
      await apiPut(`/adm/nfce/pending-human-review/${selected.id}`, {
        status: "FAILED",
        rejectionReasonCode: rejectReasonCode,
      });
      setRows((prev) => prev.filter((r) => r.id !== selected.id));
      closeRejectModal();
    } catch (e) {
      setActionError(extractErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const updateApproveItem = (index: number, field: keyof ApproveItem, value: string) => {
    setApproveItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  const addApproveItem = () => {
    setApproveItems((prev) => [...prev, createEmptyApproveItem()]);
    setTimeout(() => { approveItemsScrollRef.current?.scrollTo({ top: approveItemsScrollRef.current.scrollHeight, behavior: "smooth" }); }, 0);
  };

  const removeApproveItem = (index: number) => {
    setApproveItems((prev) => prev.length === 1 ? [createEmptyApproveItem()] : prev.filter((_, i) => i !== index));
  };

  const approveItemsTotal = approveItems.reduce((acc, item) => acc + (toNumber(item.totalItemValue) ?? 0), 0);

  return (
    <div>
      {/* Snackbar */}
      {snackbar.show && (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg text-sm font-medium z-50 ${snackbar.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"}`}>
          {snackbar.message}
          <button onClick={() => setSnackbar((s) => ({ ...s, show: false }))} className="ml-3 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-8">
          <div className="animate-spin h-8 w-8 border-4 border-purple-600 border-t-transparent rounded-full" />
        </div>
      )}

      {!loading && loadError && <p className="text-red-600 text-sm">{loadError}</p>}

      {!loading && !loadError && rows.length === 0 && (
        <div className="flex items-center justify-center min-h-[200px]">
          <p className="text-gray-500">Nenhum cupom fiscal pendente de revisão.</p>
        </div>
      )}

      {!loading && !loadError && rows.length > 0 && (
        <div className="overflow-auto max-h-[500px] bg-white rounded-lg shadow">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-600">Nome do usuário</th>
                <th className="px-4 py-3 font-medium text-gray-600">Data de criação</th>
                <th className="px-4 py-3 font-medium text-gray-600">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    <button onClick={() => copyUserUuid(row)} disabled={!row.userUuid} className="text-purple-600 underline hover:text-purple-800 disabled:text-gray-400 disabled:no-underline">
                      {row.userName}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{formatDate(row.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => row.url && window.open(row.url, "_blank", "noopener,noreferrer")} disabled={!row.url} className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40" title="Abrir URL">🔗</button>
                      <button onClick={() => openApproveModal(row)} disabled={submitting} className="px-2 py-1 text-xs rounded bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-40" title="Aprovar com IA">🤖 Aprovar IA</button>
                      <button onClick={() => openRejectModal(row)} disabled={submitting} className="px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-40" title="Reprovar">✕ Reprovar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Approve Modal with AI */}
      {approveOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col p-6 gap-4">
            <h2 className="text-lg font-bold text-gray-900">Aprovar cupom fiscal (IA)</h2>

            {actionError && <p className="text-sm text-red-600">{actionError}</p>}

            <div className="space-y-3 overflow-y-auto flex-1">
              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-purple-400 rounded-xl p-4 text-center cursor-pointer hover:bg-purple-50 transition min-h-[100px] flex flex-col items-center justify-center gap-2"
              >
                <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileInput} />
                {extracting ? (
                  <>
                    <div className="animate-spin h-6 w-6 border-3 border-purple-600 border-t-transparent rounded-full" />
                    <span className="text-sm text-gray-500">Extraindo dados via IA...</span>
                  </>
                ) : imagePreview ? (
                  <>
                    <img src={imagePreview} alt="Preview" className="max-h-20 rounded" />
                    <span className="text-xs text-gray-400">{extractProvider && `via ${extractProvider}`} — Clique para trocar</span>
                  </>
                ) : (
                  <>
                    <span className="text-2xl">📤</span>
                    <span className="text-sm text-gray-500">Arraste, cole (Ctrl+V) ou clique para enviar NFC-e</span>
                    <span className="text-xs text-gray-400">PNG, JPG, WebP ou PDF</span>
                  </>
                )}
              </div>

              {extractError && <p className="text-xs text-red-500">{extractError}</p>}

              {/* Form fields */}
              <input value={approveCnpj} onChange={(e) => setApproveCnpj(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="CNPJ (somente números)" />
              <input value={approveEstablishment} onChange={(e) => setApproveEstablishment(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Nome do estabelecimento" />
              <div className="flex gap-2">
                <input type="date" value={approveIssuedDate} onChange={(e) => setApproveIssuedDate(e.target.value)} className="flex-[2] px-3 py-2 border rounded-lg text-sm" />
                <input type="time" value={approveIssuedTime} onChange={(e) => setApproveIssuedTime(e.target.value)} className="flex-1 px-3 py-2 border rounded-lg text-sm" placeholder="Hora" />
              </div>

              <div className="flex justify-between items-center">
                <strong className="text-sm">Produtos ({approveItems.length})</strong>
                <button onClick={addApproveItem} disabled={submitting} className="text-xs text-purple-600 font-bold hover:underline">+ Adicionar item</button>
              </div>

              <div ref={approveItemsScrollRef} className="max-h-[25vh] overflow-y-auto space-y-2">
                {approveItems.map((item, idx) => (
                  <div key={idx} className="border rounded-lg p-3 space-y-2">
                    <input value={item.description} onChange={(e) => updateApproveItem(idx, "description", e.target.value)} className="w-full px-2 py-1 border rounded text-sm" placeholder="Descrição" />
                    <div className="grid grid-cols-3 gap-2">
                      <input value={item.quantity} onChange={(e) => updateApproveItem(idx, "quantity", e.target.value)} className="px-2 py-1 border rounded text-sm" placeholder="Qtd" />
                      <input value={item.unitValue} onChange={(e) => updateApproveItem(idx, "unitValue", e.target.value)} className="px-2 py-1 border rounded text-sm" placeholder="Vlr Unit" />
                      <input value={item.totalItemValue} onChange={(e) => updateApproveItem(idx, "totalItemValue", e.target.value)} className="px-2 py-1 border rounded text-sm" placeholder="Total" />
                    </div>
                    <button onClick={() => removeApproveItem(idx)} className="text-xs text-red-500 hover:underline">Remover</button>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="number"
                  step="0.01"
                  value={totalAmountInput}
                  onChange={(e) => { setTotalAmountInput(e.target.value); setExtractedTotalAmount(e.target.value ? parseFloat(e.target.value) : null); }}
                  className="w-40 px-3 py-2 border rounded-lg text-sm"
                  placeholder="Total NF (R$)"
                />
                {extractedTotalAmount != null && Math.abs(extractedTotalAmount - approveItemsTotal) > 0.01 && (
                  <span className="text-xs text-gray-400">soma itens: R$ {approveItemsTotal.toFixed(2)}</span>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t">
              <button onClick={closeApproveModal} disabled={submitting} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
              <button onClick={handleConfirmApprove} disabled={submitting} className="px-4 py-2 text-sm bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-500 text-white rounded-full font-bold hover:opacity-90 disabled:opacity-50">
                {submitting ? "Enviando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Reprovar cupom fiscal</h2>
            {actionError && <p className="text-sm text-red-600">{actionError}</p>}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={rejectReasonCode === "INVALID_URL"} onChange={() => setRejectReasonCode((p) => p === "INVALID_URL" ? "" : "INVALID_URL")} className="w-4 h-4" />
                URL inválida
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={rejectReasonCode === "SITE_UNREADABLE"} onChange={() => setRejectReasonCode((p) => p === "SITE_UNREADABLE" ? "" : "SITE_UNREADABLE")} className="w-4 h-4" />
                Site não disponível
              </label>
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t">
              <button onClick={closeRejectModal} disabled={submitting} className="px-4 py-2 text-sm text-gray-600">Cancelar</button>
              <button onClick={handleConfirmReject} disabled={submitting} className="px-4 py-2 text-sm bg-red-600 text-white rounded-full font-bold hover:bg-red-700 disabled:opacity-50">
                {submitting ? "Enviando…" : "Confirmar reprovação"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
