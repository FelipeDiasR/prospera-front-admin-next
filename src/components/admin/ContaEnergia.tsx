"use client";

import { useEffect, useRef, useState } from "react";

interface Endereco {
  rua: string | null;
  numero: string | null;
  bairro: string | null;
  complemento: string | null;
  cep: string | null;
  cidade: string | null;
  estado: string | null;
}

interface ContaEnergiaData {
  distribuidora: string | null;
  nomeTitular: string | null;
  cpfCnpj: string | null;
  numeroUC: string | null;
  numeroCliente: string | null;
  endereco: Endereco | null;
  valorMedio: number | null;
  valorFaturaAtual: number | null;
  mesReferencia: string | null;
  consumoKwh: number | null;
  provider: string;
}

export default function ContaEnergia() {
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [data, setData] = useState<ContaEnergiaData | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState({ show: false, message: "", type: "success" as "success" | "error" });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-hide snackbar
  useEffect(() => {
    if (!snackbar.show) return;
    const timer = setTimeout(() => setSnackbar((s) => ({ ...s, show: false })), 4000);
    return () => clearTimeout(timer);
  }, [snackbar.show]);

  const handleExtract = async (file: File) => {
    // Preview
    if (file.type.startsWith("image/")) {
      setImagePreview(URL.createObjectURL(file));
    } else {
      setImagePreview(null);
    }

    setExtractError(null);
    setData(null);
    setExtracting(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/conta-energia/extract", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();

      if (!res.ok) throw new Error(result.error || "Erro na extração");

      setData(result);
      setSnackbar({ show: true, message: `Dados extraídos via ${result.provider}!`, type: "success" });
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
    if (file) handleExtract(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && (file.type.startsWith("image/") || file.type === "application/pdf")) {
      handleExtract(file);
    }
  };

  // Paste from clipboard
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) handleExtract(file);
          return;
        }
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, []);

  const handleReset = () => {
    setData(null);
    setImagePreview(null);
    setExtractError(null);
  };

  const formatEndereco = (end: Endereco | null): string => {
    if (!end) return "—";
    const parts = [
      end.rua,
      end.numero,
      end.complemento,
      end.bairro,
      end.cidade,
      end.estado,
      end.cep ? `CEP: ${end.cep.replace(/(\d{5})(\d{3})/, "$1-$2")}` : null,
    ].filter(Boolean);
    return parts.join(", ") || "—";
  };

  return (
    <div className="space-y-6">
      {/* Snackbar */}
      {snackbar.show && (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg text-sm font-medium z-50 ${snackbar.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"}`}>
          {snackbar.message}
          <button onClick={() => setSnackbar((s) => ({ ...s, show: false }))} className="ml-3 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Conta de Energia — PoC</h2>
          <p className="text-sm text-gray-500">Upload de conta de energia (PDF ou foto) para extração de dados via IA</p>
        </div>
        {data && (
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
          >
            Nova análise
          </button>
        )}
      </div>

      {/* Upload area */}
      {!data && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-yellow-400 rounded-xl p-8 text-center cursor-pointer hover:bg-yellow-50 transition min-h-[200px] flex flex-col items-center justify-center gap-3"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={handleFileInput}
          />
          {extracting ? (
            <>
              <div className="animate-spin h-8 w-8 border-4 border-yellow-500 border-t-transparent rounded-full" />
              <span className="text-sm text-gray-600">Extraindo dados da conta de energia via IA...</span>
            </>
          ) : imagePreview ? (
            <>
              <img src={imagePreview} alt="Preview" className="max-h-32 rounded shadow" />
              <span className="text-xs text-gray-400">Processando...</span>
            </>
          ) : (
            <>
              <span className="text-4xl">⚡</span>
              <span className="text-base font-medium text-gray-700">Arraste, cole (Ctrl+V) ou clique para enviar a conta de energia</span>
              <span className="text-sm text-gray-400">PNG, JPG, WebP ou PDF — Contas do Ceará (Enel/Coelce)</span>
            </>
          )}
        </div>
      )}

      {extractError && !data && (
        <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{extractError}</p>
      )}

      {/* Results */}
      {data && (
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          {/* Provider badge */}
          <div className="bg-gradient-to-r from-yellow-400 via-yellow-500 to-orange-400 px-6 py-3 flex items-center justify-between">
            <span className="text-white font-bold text-sm">Dados Extraídos</span>
            <span className="bg-white/20 text-white text-xs px-3 py-1 rounded-full font-medium">
              via {data.provider}
            </span>
          </div>

          <div className="p-6 space-y-4">
            {/* Grid de dados */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <DataField label="Distribuidora" value={data.distribuidora} />
              <DataField label="Nome do Titular" value={data.nomeTitular} />
              <DataField label="CPF/CNPJ" value={data.cpfCnpj} />
              <DataField label="Número da UC" value={data.numeroUC} highlight />
              <DataField label="Número do Cliente" value={data.numeroCliente} />
              <DataField label="Mês de Referência" value={data.mesReferencia} />
              <DataField
                label="Valor da Fatura Atual"
                value={data.valorFaturaAtual != null ? `R$ ${data.valorFaturaAtual.toFixed(2)}` : null}
              />
              <DataField
                label="Valor Médio"
                value={data.valorMedio != null ? `R$ ${data.valorMedio.toFixed(2)}` : null}
                highlight
              />
              <DataField
                label="Consumo (kWh)"
                value={data.consumoKwh != null ? `${data.consumoKwh} kWh` : null}
              />
            </div>

            {/* Endereço */}
            <div className="border-t pt-4">
              <DataField label="Endereço Completo" value={formatEndereco(data.endereco)} fullWidth />
            </div>

            {/* JSON raw */}
            <details className="border-t pt-4">
              <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700 font-medium">
                Ver JSON bruto
              </summary>
              <pre className="mt-2 bg-gray-50 p-4 rounded-lg text-xs overflow-auto max-h-[300px] text-gray-700">
                {JSON.stringify(data, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}

function DataField({
  label,
  value,
  highlight,
  fullWidth,
}: {
  label: string;
  value: string | null | undefined;
  highlight?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <div className={`${fullWidth ? "col-span-full" : ""}`}>
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</dt>
      <dd className={`mt-1 text-sm ${highlight ? "font-bold text-yellow-700" : "text-gray-900"} ${!value ? "text-gray-400 italic" : ""}`}>
        {value || "Não identificado"}
      </dd>
    </div>
  );
}
