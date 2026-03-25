/**
 * Painel Reclamações Tempo Real - HookWebhookOctadesk
 * VERSION: v1.3.0
 *
 * Rota oculta /hook: cada POST; expandir = JSON retornado em payload (corpo Octadesk ou aviso legado).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchOctadeskIngestLogs } from '../services/api';
import { logout } from '../services/auth';

/** Intervalo com a aba visível (quase tempo real). */
const POLL_VISIBLE_MS = 3000;
/** Com a aba em segundo plano, reduz carga na API. */
const POLL_HIDDEN_MS = 45000;
/** Duração do destaque nas linhas novas após um poll. */
const FLASH_MS = 6000;

function HookWebhookOctadesk({ userName, userPicture }) {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetchAt, setLastFetchAt] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [flashIds, setFlashIds] = useState(() => new Set());
  const [tabVisible, setTabVisible] = useState(() =>
    typeof document !== 'undefined' ? !document.hidden : true
  );
  const prevIdOrderRef = useRef([]);

  useEffect(() => {
    const sync = () => setTabVisible(!document.hidden);
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  const load = useCallback(async (showLoadingOverlay = false) => {
    if (showLoadingOverlay) setLoading(true);
    try {
      const res = await fetchOctadeskIngestLogs(150, { includePayload: true });
      const newItems = res?.data?.items || [];
      const prevList = prevIdOrderRef.current;
      if (prevList.length > 0) {
        const oldSet = new Set(prevList);
        const toFlash = [];
        for (const row of newItems) {
          if (!oldSet.has(row.id)) toFlash.push(row.id);
          else break;
        }
        if (toFlash.length > 0) {
          setFlashIds((prev) => {
            const next = new Set(prev);
            toFlash.forEach((id) => next.add(id));
            return next;
          });
          window.setTimeout(() => {
            setFlashIds((prev) => {
              const next = new Set(prev);
              toFlash.forEach((id) => next.delete(id));
              return next;
            });
          }, FLASH_MS);
        }
      }
      prevIdOrderRef.current = newItems.map((r) => r.id);
      setItems(newItems);
      setMeta(res?.data?.meta || null);
      setError(null);
      setLastFetchAt(new Date());
    } catch (e) {
      if (e.message?.includes('401') || e.message?.includes('Sessão')) {
        logout();
        return;
      }
      setError(e.message || 'Erro ao carregar entregas do webhook');
    } finally {
      if (showLoadingOverlay) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
    let intervalId;
    const schedule = () => {
      if (intervalId) clearInterval(intervalId);
      const ms = document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
      intervalId = window.setInterval(() => load(false), ms);
    };
    schedule();
    const onVisibility = () => {
      schedule();
      if (!document.hidden) load(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  const fmtDate = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('pt-BR');
    } catch {
      return String(iso);
    }
  };

  const toggleRow = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const apiOk = !error && meta != null;

  const formatPayload = (payload) => {
    if (payload == null) return null;
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return String(payload);
    }
  };

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
            Webhook Octadesk — payload do POST
          </h1>
          <span
            className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 shrink-0"
            title={`Atualização automática a cada ${POLL_VISIBLE_MS / 1000}s com a aba visível`}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Ao vivo · {POLL_VISIBLE_MS / 1000}s
          </span>
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
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Rota oculta <code className="text-[11px]">/hook</code>. Cada linha é um POST em{' '}
          <code className="text-[11px]">/api/integrations/octadesk/webhook</code>. Ao expandir: <strong>JSON do corpo</strong> que a Octadesk enviou (servidor
          v1.3+). Registros antigos sem corpo guardado mostram um JSON de aviso até novos eventos após deploy.
        </p>

        {apiOk && (
          <div className="mb-3 text-xs text-gray-600 dark:text-gray-400 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span>
              <span className="font-medium text-gray-800 dark:text-gray-200">Conexão API:</span>{' '}
              <span className="text-green-700 dark:text-green-400">OK</span>
            </span>
            <span>
              POSTs na lista: <strong>{meta.countReturned}</strong>
            </span>
            {meta.approximateTotalInCollection != null && (
              <span>
                entregas no histórico (aprox.): <strong>{meta.approximateTotalInCollection}</strong>
              </span>
            )}
            <span>
              Última atualização:{' '}
              <strong>{lastFetchAt ? fmtDate(lastFetchAt.toISOString()) : '—'}</strong>
            </span>
            <span className="text-gray-500 dark:text-gray-500">
              {!tabVisible
                ? `pausado (~${POLL_HIDDEN_MS / 1000}s) — aba em segundo plano`
                : `polling ${POLL_VISIBLE_MS / 1000}s`}
            </span>
          </div>
        )}

        {loading && items.length === 0 && !error && (
          <p className="text-gray-600 dark:text-gray-400 mb-3">Carregando…</p>
        )}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">
            <strong>Falha ao buscar dados</strong> — {error}
          </div>
        )}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/50">
                <th className="p-2 w-10 font-medium text-gray-700 dark:text-gray-300" aria-label="Expandir" />
                <th className="p-2 font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">Recebido</th>
                <th className="p-2 font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">Ticket #</th>
                <th className="p-2 font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">Processamento</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const isOpen = expanded.has(row.id);
                const capturado = row.payloadCapturado !== false;
                const isFlashing = flashIds.has(row.id);
                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className={`border-b border-gray-100 dark:border-gray-700/80 hover:bg-gray-50/80 dark:hover:bg-gray-700/30 cursor-pointer transition-colors duration-500 ${
                        isFlashing ? 'bg-emerald-50 dark:bg-emerald-900/25 ring-1 ring-inset ring-emerald-300/60 dark:ring-emerald-600/40' : ''
                      }`}
                      onClick={() => toggleRow(row.id)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          toggleRow(row.id);
                        }
                      }}
                      tabIndex={0}
                      aria-expanded={isOpen}
                    >
                      <td className="p-2 text-gray-600 dark:text-gray-400 align-top">
                        <span className="inline-block w-6 text-center select-none" aria-hidden>
                          {isOpen ? '▼' : '▶'}
                        </span>
                      </td>
                      <td className="p-2 text-gray-700 dark:text-gray-300 whitespace-nowrap align-top">
                        {fmtDate(row.receivedAt)}
                      </td>
                      <td className="p-2 font-mono text-gray-800 dark:text-gray-200 align-top">{row.octadeskNumber ?? '—'}</td>
                      <td className="p-2 align-top">
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
                        {!capturado ? (
                          <span className="ml-2 text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                            sem POST original no banco
                          </span>
                        ) : null}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-gray-200 dark:border-gray-600 bg-slate-50 dark:bg-slate-900/40">
                        <td colSpan={4} className="p-3 align-top">
                          {!capturado ? (
                            <p className="text-xs text-amber-800 dark:text-amber-200/90 mb-2 font-medium">
                              Abaixo não é o POST da Octadesk — é só aviso: este registro foi salvo sem o corpo. Faça deploy do backend v1.3+ e aguarde novos
                              webhooks para ver o JSON real.
                            </p>
                          ) : (
                            <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Corpo do POST (JSON recebido no webhook)
                            </div>
                          )}
                          <pre className="text-[11px] leading-relaxed overflow-x-auto max-h-[min(70vh,32rem)] overflow-y-auto p-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-950 text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                            {formatPayload(
                              row.payload ?? {
                                _erroResposta: 'Campo payload ausente na API; atualize o backend.',
                              }
                            )}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {!loading && items.length === 0 && !error && apiOk && (
            <div className="p-6 text-sm text-gray-600 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700">
              Nenhum POST recebido ainda neste histórico.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default HookWebhookOctadesk;
