/**
 * Painel Reclamações Tempo Real - ObservadorOctadesk
 * VERSION: v1.2.2
 *
 * Logs do webhook Octadesk + metadados da API para distinguir lista vazia de falha.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { fetchOctadeskIngestLogs } from '../services/api';
import { logout } from '../services/auth';

const POLL_MS = 20000;

function ObservadorOctadesk({ userName, userPicture }) {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetchAt, setLastFetchAt] = useState(null);

  const load = useCallback(async (showLoadingOverlay = false) => {
    if (showLoadingOverlay) setLoading(true);
    try {
      const res = await fetchOctadeskIngestLogs(150);
      setItems(res?.data?.items || []);
      setMeta(res?.data?.meta || null);
      setError(null);
      setLastFetchAt(new Date());
    } catch (e) {
      if (e.message?.includes('401') || e.message?.includes('Sessão')) {
        logout();
        return;
      }
      setError(e.message || 'Erro ao carregar logs');
    } finally {
      if (showLoadingOverlay) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
    const t = setInterval(() => load(false), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const fmtDate = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('pt-BR');
    } catch {
      return String(iso);
    }
  };

  const apiOk = !error && meta != null;

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-gray-100 dark:bg-gray-900 flex flex-col font-[Poppins]">
      <header className="w-full bg-white dark:bg-gray-800 shadow py-2 px-4 shrink-0 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <a
            href="/"
            className="text-sm font-medium shrink-0 px-3 py-1.5 rounded-md transition-colors hover:opacity-90"
            style={{ backgroundColor: '#1634FF', color: '#fff' }}
          >
            Voltar ao painel
          </a>
          <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100 truncate">
            Observador — logs Octadesk
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-xs text-gray-600 dark:text-gray-400">
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading}
            className="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Atualizar
          </button>
          {userPicture ? (
            <img src={userPicture} alt="" className="w-7 h-7 rounded-full object-cover border border-gray-300" />
          ) : null}
          <span className="max-w-[140px] truncate hidden sm:inline">{userName}</span>
        </div>
      </header>

      <main className="flex-1 p-4 overflow-auto" style={{ paddingLeft: '24px', paddingRight: '24px' }}>
        {apiOk && (
          <div className="mb-3 text-xs text-gray-600 dark:text-gray-400 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span>
              <span className="font-medium text-gray-800 dark:text-gray-200">Conexão API:</span>{' '}
              <span className="text-green-700 dark:text-green-400">OK</span>
            </span>
            <span>
              Registros na página: <strong>{meta.countReturned}</strong>
            </span>
            {meta.approximateTotalInCollection != null && (
              <span>
                total de logs: <strong>{meta.approximateTotalInCollection}</strong>
              </span>
            )}
            <span>
              Última consulta ao servidor:{' '}
              <strong>{lastFetchAt ? fmtDate(lastFetchAt.toISOString()) : '—'}</strong>
            </span>
          </div>
        )}

        {loading && items.length === 0 && !error && (
          <p className="text-gray-600 dark:text-gray-400 mb-3">Carregando logs…</p>
        )}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">
            <strong>Falha ao buscar logs</strong> — {error}. Isso indica problema de rede, CORS, URL da API ou sessão; não
            prova se o webhook da Octadesk chegou ou não.
          </div>
        )}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/50">
                <th className="p-2 font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">Recebido</th>
                <th className="p-2 font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">Ticket #</th>
                <th className="p-2 font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">Resultado</th>
                <th className="p-2 font-medium text-gray-700 dark:text-gray-300">Mensagem</th>
                <th className="p-2 font-medium text-gray-700 dark:text-gray-300 min-w-[180px]">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-gray-100 dark:border-gray-700/80 hover:bg-gray-50/80 dark:hover:bg-gray-700/30"
                >
                  <td className="p-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{fmtDate(row.receivedAt)}</td>
                  <td className="p-2 font-mono text-gray-800 dark:text-gray-200">{row.octadeskNumber ?? '—'}</td>
                  <td className="p-2">
                    <span
                      className="inline-block px-2 py-0.5 rounded text-xs font-medium"
                      style={{
                        backgroundColor:
                          row.outcome === 'upsert'
                            ? 'rgba(21, 162, 55, 0.15)'
                            : row.outcome === 'skipped'
                              ? 'rgba(252, 194, 0, 0.2)'
                              : row.outcome === 'error'
                                ? 'rgba(192, 57, 43, 0.15)'
                                : row.outcome === 'unauthorized'
                                  ? 'rgba(128, 90, 213, 0.2)'
                                  : 'rgba(22, 52, 255, 0.1)',
                        color: '#000058',
                      }}
                    >
                      {row.outcome}
                    </span>
                  </td>
                  <td className="p-2 text-gray-700 dark:text-gray-300 max-w-md break-words">{row.message || '—'}</td>
                  <td className="p-2 text-gray-600 dark:text-gray-400 text-xs max-w-xs break-all">{row.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && items.length === 0 && !error && apiOk && (
            <div className="p-6 text-sm text-gray-600 dark:text-gray-400 space-y-3 border-t border-gray-100 dark:border-gray-700">
              <p className="font-medium text-gray-800 dark:text-gray-200">Nenhuma linha na tabela — mas a API respondeu OK.</p>
              <p>Interpretação:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  Se <strong>nunca</strong> houve POST válido no webhook, a coleção <code className="text-xs">octadesk_ingest_log</code> está
                  vazia (normal).
                </li>
                <li>
                  Dispare um teste na Octadesk ou com <code className="text-xs">curl</code>: cada POST processado gera linha{' '}
                  <strong>upsert</strong>, <strong>skipped</strong> ou <strong>error</strong>.
                </li>
                <li>
                  Linhas antigas com <strong>unauthorized</strong> referem-se a tentativas quando ainda havia checagem de segredo.
                </li>
                <li>
                  Confira também os logs do Cloud Run (mensagens <code className="text-xs">[WEBHOOK OCTADESK]</code>).
                </li>
              </ul>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default ObservadorOctadesk;
