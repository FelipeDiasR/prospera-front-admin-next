"use client";

interface NfcePaginationProps {
  page: number;
  totalPages: number;
  totalRecords: number;
  pageSize: number;
  loading?: boolean;
  onChange: (page: number) => void;
}

/**
 * Controles de navegação da lista de NFC-e pendentes.
 *
 * A ordenação é crescente (mais antigas primeiro): a página 1 mostra os
 * registros mais antigos e a última página os mais recentes.
 */
export default function NfcePagination({
  page,
  totalPages,
  totalRecords,
  pageSize,
  loading = false,
  onChange,
}: NfcePaginationProps) {
  const canPrev = page > 1 && !loading;
  const canNext = page < totalPages && !loading;

  const firstOnPage = (page - 1) * pageSize + 1;
  const lastOnPage = Math.min(page * pageSize, totalRecords);

  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-sm text-gray-600">
      <span>
        {firstOnPage}–{lastOnPage} de {totalRecords} (mais antigas primeiro)
      </span>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(1)}
          disabled={!canPrev}
          className="px-2 py-1 rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Primeira página (mais antigas)"
        >
          «
        </button>
        <button
          onClick={() => onChange(page - 1)}
          disabled={!canPrev}
          className="px-3 py-1 rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Anterior
        </button>

        <span className="px-3 py-1 font-medium text-gray-700">
          Página {page} de {totalPages}
        </span>

        <button
          onClick={() => onChange(page + 1)}
          disabled={!canNext}
          className="px-3 py-1 rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Próxima
        </button>
        <button
          onClick={() => onChange(totalPages)}
          disabled={!canNext}
          className="px-2 py-1 rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Última página (mais recentes)"
        >
          »
        </button>
      </div>
    </div>
  );
}
