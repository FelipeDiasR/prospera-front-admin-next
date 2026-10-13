"use client";

import { apiGet } from "@/lib/api";
import { extractErrorMessage, mapItemToRow, NfceRow } from "@/lib/mappers";
import { useCallback, useEffect, useState } from "react";

const PAGE_SIZE = 50;

interface PendingListResponse {
  items?: Record<string, unknown>[];
  page?: number;
  pageSize?: number;
  totalPages?: number;
  totalRecords?: number;
}

/**
 * Hook para a lista de NFC-e pendentes de revisão humana.
 *
 * Contrato do backend (confirmado em /adm/nfce/pending-human-review):
 * - Resposta: { items, page, pageSize, totalPages, totalRecords }
 * - A API SEMPRE ordena do mais recente para o mais antigo e IGNORA qualquer
 *   parâmetro de ordenação (sort/order/direction/etc. não têm efeito).
 *
 * Como o produto pede "mais antigas primeiro", a ordenação crescente é feita
 * aqui no front invertendo a paginação: a página 1 da UI corresponde à última
 * página do backend (registros mais antigos), e os itens de cada página são
 * invertidos para ficarem do mais antigo para o mais recente.
 */
export function useNfcePendingList() {
  const [rows, setRows] = useState<NfceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Página exibida ao usuário (1 = mais antigas). totalPages vem do backend.
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);

  const loadPage = useCallback(async (uiPage: number) => {
    setLoading(true);
    setLoadError(null);
    try {
      // 1ª requisição descobre o total de páginas do backend.
      const first = await apiGet<PendingListResponse>(
        "/adm/nfce/pending-human-review",
        { page: 1, pageSize: PAGE_SIZE }
      );

      const backendTotalPages = Math.max(1, first.totalPages ?? 1);
      const records = first.totalRecords ?? (first.items?.length ?? 0);

      // Clampa a página pedida ao intervalo válido.
      const safeUiPage = Math.min(Math.max(1, uiPage), backendTotalPages);

      // UI crescente (antigas primeiro) => inverte a paginação do backend
      // (que é decrescente). Página 1 da UI = última página do backend.
      const backendPage = backendTotalPages - (safeUiPage - 1);

      const data =
        backendPage === 1
          ? first
          : await apiGet<PendingListResponse>("/adm/nfce/pending-human-review", {
              page: backendPage,
              pageSize: PAGE_SIZE,
            });

      // Dentro da página, inverte para ficar do mais antigo ao mais recente.
      const mapped = (data.items ?? []).map(mapItemToRow).reverse();

      setRows(mapped);
      setTotalPages(backendTotalPages);
      setTotalRecords(records);
      setPage(safeUiPage);
    } catch (e) {
      setLoadError(extractErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Carregamento inicial dos dados. loadPage atualiza estado após o fetch
    // assíncrono; o aviso de "setState síncrono no effect" não se aplica aqui.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPage(1);
  }, [loadPage]);

  const goToPage = useCallback(
    (uiPage: number) => {
      loadPage(uiPage);
    },
    [loadPage]
  );

  const reload = useCallback(() => {
    loadPage(page);
  }, [loadPage, page]);

  // Após aprovar/reprovar, remove a linha localmente para feedback imediato
  // e recarrega a página para manter contagem/ordenação corretas.
  const removeRowAndReload = useCallback(
    (id: string) => {
      setRows((prev) => prev.filter((r) => r.id !== id));
      loadPage(page);
    },
    [loadPage, page]
  );

  return {
    rows,
    loading,
    loadError,
    page,
    totalPages,
    totalRecords,
    pageSize: PAGE_SIZE,
    goToPage,
    reload,
    removeRowAndReload,
  };
}
