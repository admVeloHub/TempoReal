/**
 * Painel Reclamações Tempo Real - AbaTabelaLiberacao
 * VERSION: v1.2.1
 *
 * v1.2.1: Container da tabela sem max-height — altura total visível com cards expandidos (scroll na página, não no quadro).
 * v1.2.0: Exportar tabela imediatamente acima da tabela (filtros só pela engrenagem); divisor após a tabela; período + Exportar Base agrupados abaixo.
 * v1.1.0: Coluna Total; export Excel; aba «Conciliação».
 *
 * Tabela: GET /api/stats/tabela-liberacao (mesmos filtros globais que a home — engrenagem).
 * Export tabela: GET /tabela-liberacao/export (paridade com a tela).
 * Export base: GET /relatorio-ouvidoria-base (período do bloco inferior + produto/motivo globais).
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  fetchStatsTabelaLiberacao,
  downloadConciliacaoTabelaExcel,
  downloadRelatorioOuvidoriaBaseExcel,
} from '../services/api';
import { expandProdutosFiltroParaApi } from './FiltrosAuxiliar';

const POLL_MS = 60000;

/** LAYOUT_GUIDELINES / theme — azul opaco da marca */
const AZUL_OPACO = '#006AB9';

/** Sem max-height vertical: evita cortar a última linha com todos os cards expandidos; overflow-x só se a tabela for larga. */
const PIVOT_TABLE_WRAP =
  'w-full overflow-x-auto rounded border border-gray-300 dark:border-gray-600';
const PIVOT_TABLE = 'min-w-full text-xs border-separate border-spacing-0';

const PIVOT_TH_CORNER =
  'sticky left-0 top-0 z-[6] px-2 py-1.5 text-left border-b border-r border-gray-300 dark:border-gray-600 font-medium bg-gray-100 dark:bg-gray-700 shadow-[2px_2px_4px_-2px_rgba(0,0,0,0.1)] min-w-[11rem] max-w-[11rem] w-[11rem]';

const PIVOT_TH_TOTAL =
  'sticky top-0 z-[5] px-2 py-1.5 text-center border-b border-r border-gray-300 dark:border-gray-600 font-medium whitespace-nowrap bg-gray-100 dark:bg-gray-700 min-w-[4.5rem]';

const PIVOT_TH_DATA =
  'sticky top-0 z-[2] px-2 py-1.5 text-center border-b border-r border-gray-300 dark:border-gray-600 font-medium whitespace-nowrap bg-gray-100 dark:bg-gray-700';

const PIVOT_BG_ZEBRA_A = 'bg-white dark:bg-gray-950';
const PIVOT_BG_ZEBRA_B = 'bg-slate-200 dark:bg-gray-800';
const PIVOT_TD_BORDER =
  'border-b border-r border-slate-400 dark:border-gray-500';

function pivotTdFirst(bgClass, extra = '') {
  return `sticky left-0 z-[4] px-2 py-1.5 min-w-[11rem] max-w-[11rem] w-[11rem] ${PIVOT_TD_BORDER} shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] ${bgClass} ${extra}`.trim();
}

function pivotTdTotal(bgClass) {
  return `sticky z-[3] px-2 py-1.5 text-center min-w-[4.5rem] ${PIVOT_TD_BORDER} shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)] ${bgClass}`;
}

function pivotTdData(bgClass) {
  return `px-2 py-1.5 text-center ${PIVOT_TD_BORDER} ${bgClass}`;
}

function formatarDiaLabel(yyyyMmDd) {
  if (!yyyyMmDd) return '';
  const [y, m, d] = String(yyyyMmDd).split('-');
  return d && m ? `${d}/${m}` : yyyyMmDd;
}

function totaisLinha(row, dias) {
  if (row.totais) return row.totais;
  let o = 0;
  let l = 0;
  const pd = row.porDia || {};
  dias.forEach((d) => {
    o += pd[d]?.ocorrencias ?? 0;
    l += pd[d]?.liberados ?? 0;
  });
  return { ocorrencias: o, liberados: l };
}

/** Query da tabela na tela = filtros globais (engrenagem). */
function paramsDesdeFiltrosHome(f) {
  const produtosApi = f?.produtos?.length ? expandProdutosFiltroParaApi(f.produtos) : [];
  return {
    dataInicio: f?.dataInicio || undefined,
    dataFim: f?.dataFim || undefined,
    produtos: produtosApi.length ? produtosApi : undefined,
    motivos: f?.motivos?.length ? f.motivos : undefined,
  };
}

/** Query da exportação da base: período do bloco inferior + produto/motivo globais. */
function paramsExportacaoBase(filtrosHome, periodoBase) {
  const produtosApi = filtrosHome?.produtos?.length ? expandProdutosFiltroParaApi(filtrosHome.produtos) : [];
  const di = periodoBase?.dataInicio != null && String(periodoBase.dataInicio).trim() !== ''
    ? String(periodoBase.dataInicio).trim()
    : undefined;
  const df = periodoBase?.dataFim != null && String(periodoBase.dataFim).trim() !== ''
    ? String(periodoBase.dataFim).trim()
    : undefined;
  return {
    dataInicio: di,
    dataFim: df,
    produtos: produtosApi.length ? produtosApi : undefined,
    motivos: filtrosHome?.motivos?.length ? filtrosHome.motivos : undefined,
  };
}

export default function AbaTabelaLiberacao({ filtrosHome, refreshTrigger = 0, activeTab }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [exporting, setExporting] = useState(false);
  /** Período exclusivo para GET relatorio-ouvidoria-base (sincronizado com filtros globais ao mudarem). */
  const [periodoBase, setPeriodoBase] = useState({ dataInicio: '', dataFim: '' });

  const paramsMemo = useMemo(() => paramsDesdeFiltrosHome(filtrosHome), [filtrosHome]);

  const paramsBase = useMemo(
    () => paramsExportacaoBase(filtrosHome, periodoBase),
    [filtrosHome, periodoBase]
  );

  useEffect(() => {
    const di = filtrosHome?.dataInicio || '';
    const df =
      filtrosHome?.dataFim != null && String(filtrosHome.dataFim).trim() !== ''
        ? String(filtrosHome.dataFim).trim()
        : '';
    setPeriodoBase({ dataInicio: di, dataFim: df });
  }, [filtrosHome?.dataInicio, filtrosHome?.dataFim]);

  const load = useCallback(async () => {
    if (activeTab !== 'tabela-liberacao') return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchStatsTabelaLiberacao(paramsMemo);
      setData(res.data);
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [paramsMemo, activeTab, refreshTrigger]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (activeTab !== 'tabela-liberacao') return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [activeTab, load]);

  const dias = data?.dias || [];
  const linhas = data?.linhas || [];

  const handleExportTabela = async () => {
    setExporting(true);
    setError(null);
    try {
      await downloadConciliacaoTabelaExcel(paramsMemo);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleExportBase = async () => {
    setExporting(true);
    setError(null);
    try {
      await downloadRelatorioOuvidoriaBaseExcel(paramsBase);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const totalStickyLeft = { left: '11rem' };

  return (
    <div className="w-full max-w-full py-4 font-[Poppins] space-y-4">
      <h2 className="text-lg sm:text-xl font-semibold px-1" style={{ color: AZUL_OPACO }}>
        Concliliação de casos chave Pix
      </h2>

      {error && (
        <div className="p-3 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-600 dark:text-gray-400 text-sm">Carregando…</div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-start gap-2 px-1">
            <button
              type="button"
              disabled={exporting}
              onClick={handleExportTabela}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: AZUL_OPACO }}
            >
              Exportar tabela (Excel)
            </button>
          </div>

          {dias.length === 0 && !error ? (
            <div className="text-center py-8 text-gray-600 dark:text-gray-400 text-sm">
              Nenhum dia com dados no período / filtros atuais.
            </div>
          ) : (
            <div className={PIVOT_TABLE_WRAP}>
              <table className={PIVOT_TABLE}>
                <thead>
                  <tr>
                    <th className={PIVOT_TH_CORNER}>Card</th>
                    <th className={PIVOT_TH_TOTAL} style={totalStickyLeft}>
                      Total
                    </th>
                    {dias.map((dia) => (
                      <th key={dia} className={PIVOT_TH_DATA}>
                        {formatarDiaLabel(dia)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((row, idxCard) => {
                    const isOpen = expanded.has(row.key);
                    const bgP = idxCard % 2 === 0 ? PIVOT_BG_ZEBRA_A : PIVOT_BG_ZEBRA_B;
                    const pd = row.porDia || {};
                    const tot = totaisLinha(row, dias);
                    const sumO = tot.ocorrencias;
                    const sumL = tot.liberados;
                    return (
                      <React.Fragment key={row.key}>
                        <tr>
                          <td className={pivotTdFirst(bgP, 'font-medium')}>
                            <button
                              type="button"
                              className="flex items-center gap-1.5 text-left w-full min-w-0 text-gray-900 dark:text-gray-100"
                              onClick={() => {
                                setExpanded((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(row.key)) next.delete(row.key);
                                  else next.add(row.key);
                                  return next;
                                });
                              }}
                              aria-expanded={isOpen}
                            >
                              <span className="shrink-0 w-4 text-center text-gray-500" aria-hidden>
                                {isOpen ? '▼' : '▶'}
                              </span>
                              <span className="truncate">{row.label}</span>
                            </button>
                          </td>
                          <td className={pivotTdTotal(bgP)} style={totalStickyLeft}>
                            {isOpen ? '—' : (
                              <span className="tabular-nums" title="Ocorrências / Liberados (período)">
                                {sumO} / {sumL}
                              </span>
                            )}
                          </td>
                          {dias.map((dia) => {
                            const o = pd[dia]?.ocorrencias ?? 0;
                            const l = pd[dia]?.liberados ?? 0;
                            return (
                              <td key={dia} className={pivotTdData(bgP)}>
                                {isOpen ? '—' : (
                                  <span className="tabular-nums" title="Ocorrências / Liberados">
                                    {o} / {l}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                        {isOpen && (
                          <>
                            <tr>
                              <td className={pivotTdFirst(bgP)}>
                                <span className="block pl-7 text-gray-700 dark:text-gray-300">Ocorrências</span>
                              </td>
                              <td className={pivotTdTotal(bgP)} style={totalStickyLeft}>
                                <span className="tabular-nums">{sumO}</span>
                              </td>
                              {dias.map((dia) => (
                                <td key={dia} className={pivotTdData(bgP)}>
                                  {pd[dia]?.ocorrencias ?? 0}
                                </td>
                              ))}
                            </tr>
                            <tr>
                              <td className={pivotTdFirst(bgP)}>
                                <span className="block pl-7 text-gray-700 dark:text-gray-300">Liberados</span>
                              </td>
                              <td className={pivotTdTotal(bgP)} style={totalStickyLeft}>
                                <span className="tabular-nums">{sumL}</span>
                              </td>
                              {dias.map((dia) => (
                                <td key={dia} className={pivotTdData(bgP)}>
                                  {pd[dia]?.liberados ?? 0}
                                </td>
                              ))}
                            </tr>
                          </>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-t border-gray-300 dark:border-gray-600 pt-4 mt-4" role="separator" />

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center px-1">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400 shrink-0">
              Período para exportação da base
            </span>
            <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
              <span className="text-gray-500">Início</span>
              <input
                type="date"
                value={periodoBase.dataInicio || ''}
                onChange={(e) => setPeriodoBase((p) => ({ ...p, dataInicio: e.target.value }))}
                className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-xs"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
              <span className="text-gray-500">Fim</span>
              <input
                type="date"
                value={periodoBase.dataFim || ''}
                onChange={(e) => setPeriodoBase((p) => ({ ...p, dataFim: e.target.value }))}
                className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-xs"
              />
            </label>
            <button
              type="button"
              disabled={exporting}
              onClick={handleExportBase}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800 disabled:opacity-50 sm:ml-1"
            >
              Exportar Base
            </button>
          </div>
        </>
      )}
    </div>
  );
}
