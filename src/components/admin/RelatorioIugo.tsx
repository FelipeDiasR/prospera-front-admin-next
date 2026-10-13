"use client";

import { useCallback, useState } from "react";

type Status = "idle" | "uploading" | "success" | "error";

export default function RelatorioIugo() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback((f: File | null) => {
    if (!f) return;
    const nome = f.name.toLowerCase();
    const formatoValido =
      nome.endsWith(".csv") ||
      nome.endsWith(".txt") ||
      nome.endsWith(".xlsx") ||
      nome.endsWith(".xls");
    if (!formatoValido) {
      setErrorMsg("Formato inválido. Use arquivo .csv, .txt, .xlsx ou .xls");
      setStatus("error");
      return;
    }
    setFile(f);
    setStatus("idle");
    setErrorMsg("");
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const droppedFile = e.dataTransfer.files[0];
      handleFile(droppedFile);
    },
    [handleFile]
  );

  const handleSubmit = async () => {
    if (!file) return;

    setStatus("uploading");
    setErrorMsg("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/relatorio/iugo", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Erro ao gerar relatório");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `relatorio-iugo-${new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro desconhecido");
      setStatus("error");
    }
  };

  const resetForm = () => {
    setFile(null);
    setStatus("idle");
    setErrorMsg("");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          Extrato Bancário - Iugo
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Faça upload do arquivo exportado da Iugo (CSV, TXT ou Excel) para gerar
          o extrato bancário em PDF com os dados da conta Prospera.
        </p>
      </div>

      {/* Upload area */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center transition-colors
          ${dragOver
            ? "border-purple-500 bg-purple-50"
            : file
              ? "border-green-300 bg-green-50"
              : "border-gray-300 hover:border-gray-400"
          }
        `}
      >
        {file ? (
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-green-700">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="font-medium">{file.name}</span>
            </div>
            <p className="text-xs text-gray-500">
              {(file.size / 1024).toFixed(1)} KB
            </p>
            <button
              onClick={resetForm}
              className="text-sm text-red-600 hover:text-red-800 underline"
            >
              Remover arquivo
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <svg
              className="mx-auto w-10 h-10 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <div>
              <label className="cursor-pointer text-purple-600 hover:text-purple-800 font-medium">
                Selecionar arquivo
                <input
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0] || null)}
                />
              </label>
              <span className="text-gray-500"> ou arraste aqui</span>
            </div>
            <p className="text-xs text-gray-400">
              Formatos aceitos: .csv, .txt, .xlsx, .xls
            </p>
          </div>
        )}
      </div>

      {/* Botão de ação */}
      <button
        onClick={handleSubmit}
        disabled={!file || status === "uploading"}
        className={`
          w-full py-3 px-4 rounded-lg font-medium text-white transition-colors
          ${!file || status === "uploading"
            ? "bg-gray-300 cursor-not-allowed"
            : "bg-purple-600 hover:bg-purple-700 active:bg-purple-800"
          }
        `}
      >
        {status === "uploading" ? (
          <span className="inline-flex items-center gap-2">
            <svg
              className="animate-spin w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Gerando extrato...
          </span>
        ) : (
          "Gerar Extrato Bancário PDF"
        )}
      </button>

      {/* Mensagens de status */}
      {status === "success" && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
          <svg
            className="w-5 h-5 text-green-600 mt-0.5 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-green-800">
              Extrato gerado com sucesso!
            </p>
            <p className="text-xs text-green-600 mt-1">
              O download deve iniciar automaticamente. Se não iniciar,{" "}
              <button
                onClick={handleSubmit}
                className="underline hover:text-green-800"
              >
                clique aqui
              </button>.
            </p>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <svg
            className="w-5 h-5 text-red-600 mt-0.5 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-red-800">
              Erro ao gerar extrato
            </p>
            <p className="text-xs text-red-600 mt-1">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* Dicas */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <p className="text-sm font-medium text-gray-700 mb-2">Dicas:</p>
        <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
          <li>Exporte o extrato da Iugo e faça upload direto (mesmo sem quebras de linha)</li>
          <li>O sistema corrige automaticamente problemas de encoding</li>
          <li>O PDF gerado inclui resumo financeiro e extrato detalhado</li>
          <li>Aceita arquivos .csv, .txt, .xlsx e .xls</li>
        </ul>
      </div>
    </div>
  );
}
