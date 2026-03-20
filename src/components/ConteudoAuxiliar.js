/**
 * Painel Reclamações Tempo Real - ConteudoAuxiliar
 * VERSION: v1.2.6
 *
 * Gráfico e tabelas (Reclamações por Dia/Mês, Jornada do Reclamante).
 * Tabela Reclamações: coluna Produtos expansível quando a API envia totaisPorProdutoPorDia / motivosPorProdutoPorDia (RA, Bacen, Procon, N2).
 * Compartilhado por AbaRA e AbaAuxiliar (Bacen, Procon, N2, Judicial).
 * apenasTotal: quando true, gráfico exibe só Total (ex.: Bacen).
 * Labels de data: DD/MM.
 */

import React, { useState, useMemo, useEffect } from 'react';

function formatarDataLabel(str, exibirPor) {
  if (!str) return str;
  if (exibirPor === 'mes') {
    const [y, m] = str.split('-');
    return m && y ? `${m}/${y}` : str;
  }
  const [y, m, d] = str.split('-');
  return d && m ? `${d}/${m}` : str;
}

/** Coluna Produtos (todas as abas): Antecipação sem ano → "Antecipação - Outros Anos"; "Antecipação 2026" inalterado. */
function rotuloProdutoPivot(produtoChave) {
  const s = produtoChave == null ? '' : String(produtoChave).trim();
  if (!s) return s;
  const lower = s.toLowerCase();
  if (lower === 'antecipação 2026') return 'Antecipação 2026';
  const semDiac = s.normalize('NFD').replace(/\p{M}/gu, '');
  if (/^antecipacao\s+2026$/i.test(semDiac.trim())) return 'Antecipação 2026';
  if (!/\d/.test(s)) {
    const canon = semDiac.toLowerCase().replace(/\s+/g, '');
    if (canon === 'antecipacao') return 'Antecipação - Outros Anos';
  }
  return s;
}

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

function agregarPorMes(reclamacoesPorDia, motivosPorDia, jornadaPorDia) {
  if (!reclamacoesPorDia?.length) return { reclamacoes: [], motivos: {}, jornada: {}, periodos: [] };
  const mesMap = {};
  reclamacoesPorDia.forEach((d) => {
    const mes = d.dia?.slice(0, 7) || '';
    if (!mes) return;
    if (!mesMap[mes]) mesMap[mes] = { periodo: mes, total: 0, solicitadoAvaliacao: 0, avaliado: 0 };
    mesMap[mes].total += d.total ?? 0;
    mesMap[mes].solicitadoAvaliacao += d.solicitadoAvaliacao ?? 0;
    mesMap[mes].avaliado += d.avaliado ?? 0;
    if (d.encaminhadoJuridico !== undefined) mesMap[mes].encaminhadoJuridico = (mesMap[mes].encaminhadoJuridico ?? 0) + (d.encaminhadoJuridico ?? 0);
  });
  const motivosMes = {};
  Object.entries(motivosPorDia || {}).forEach(([motivo, counts]) => {
    motivosMes[motivo] = {};
    Object.entries(counts).forEach(([dia, n]) => {
      const mes = dia?.slice(0, 7) || '';
      if (!mes) return;
      motivosMes[motivo][mes] = (motivosMes[motivo][mes] || 0) + n;
    });
  });
  const jornadaMes = {};
  Object.entries(jornadaPorDia || {}).forEach(([dia, vals]) => {
    const mes = dia?.slice(0, 7) || '';
    if (!mes) return;
    if (!jornadaMes[mes]) jornadaMes[mes] = { total: 0, reclameAqui: 0, bacen: 0, acionouCentral: 0, n2SegundoNivel: 0, procon: 0 };
    jornadaMes[mes].total += vals.total ?? 0;
    jornadaMes[mes].reclameAqui += vals.reclameAqui ?? 0;
    jornadaMes[mes].bacen += vals.bacen ?? 0;
    jornadaMes[mes].acionouCentral += vals.acionouCentral ?? 0;
    jornadaMes[mes].n2SegundoNivel += vals.n2SegundoNivel ?? 0;
    jornadaMes[mes].procon += vals.procon ?? 0;
  });
  const periodos = Object.keys(mesMap).sort();
  const reclamacoes = periodos.map((p) => ({ ...mesMap[p], dia: p }));
  return { reclamacoes, motivos: motivosMes, jornada: jornadaMes, periodos };
}

function agregarPorMesPorProduto(totaisPorProdutoPorDia, motivosPorProdutoPorDia) {
  const totaisPorProdutoPorMes = {};
  Object.entries(totaisPorProdutoPorDia || {}).forEach(([prod, countsDia]) => {
    totaisPorProdutoPorMes[prod] = {};
    Object.entries(countsDia || {}).forEach(([dia, n]) => {
      const mes = dia?.slice(0, 7) || '';
      if (!mes) return;
      totaisPorProdutoPorMes[prod][mes] = (totaisPorProdutoPorMes[prod][mes] || 0) + n;
    });
  });
  const motivosPorProdutoPorMes = {};
  Object.entries(motivosPorProdutoPorDia || {}).forEach(([prod, motivos]) => {
    motivosPorProdutoPorMes[prod] = {};
    Object.entries(motivos || {}).forEach(([motivo, countsDia]) => {
      motivosPorProdutoPorMes[prod][motivo] = {};
      Object.entries(countsDia || {}).forEach(([dia, n]) => {
        const mes = dia?.slice(0, 7) || '';
        if (!mes) return;
        motivosPorProdutoPorMes[prod][motivo][mes] = (motivosPorProdutoPorMes[prod][motivo][mes] || 0) + n;
      });
    });
  });
  return { totaisPorProdutoPorMes, motivosPorProdutoPorMes };
}

const JORNADA_LINHAS = [
  { key: 'total', label: 'Total' },
  { key: 'reclameAqui', label: 'RA' },
  { key: 'bacen', label: 'Bacen' },
  { key: 'acionouCentral', label: 'N1' },
  { key: 'n2SegundoNivel', label: 'N2' },
  { key: 'procon', label: 'Procon' },
];

function getJornadaLinhas(tipo) {
  const excluir = { ra: 'reclameAqui', bacen: 'bacen', n2: 'n2SegundoNivel', procon: 'procon' }[tipo];
  if (!excluir) return JORNADA_LINHAS;
  return JORNADA_LINHAS.filter((l) => l.key !== excluir);
}

/* ========== Tabelas pivot: scroll + sticky + zebrado (compartilhado) ========== */
const PIVOT_SCROLL_WRAP =
  'max-h-[min(70vh,520px)] overflow-auto rounded border border-gray-300 dark:border-gray-600';
const PIVOT_TABLE = 'min-w-full text-xs border-separate border-spacing-0';
const PIVOT_TH_CORNER =
  'sticky left-0 top-0 z-[3] px-2 py-1.5 text-left border-b border-r border-gray-300 dark:border-gray-600 font-medium bg-gray-100 dark:bg-gray-700 shadow-[2px_2px_4px_-2px_rgba(0,0,0,0.1)]';
const PIVOT_TH_DATA =
  'sticky top-0 z-[2] px-2 py-1.5 text-center border-b border-r border-gray-300 dark:border-gray-600 font-medium whitespace-nowrap bg-gray-100 dark:bg-gray-700';
const PIVOT_BG_TOTAL = 'bg-slate-200 dark:bg-gray-700';
const PIVOT_BG_ZEBRA_A = 'bg-white dark:bg-gray-950';
const PIVOT_BG_ZEBRA_B = 'bg-slate-200 dark:bg-gray-800';

/** Bordas do corpo: contraste em faixas claras (slate-200) e escuras (gray-800/950). */
const PIVOT_TD_BORDER =
  'border-b border-r border-slate-400 dark:border-gray-500';

function pivotTdFirst(bgClass, extra = '') {
  return `sticky left-0 z-[1] px-2 py-1.5 ${PIVOT_TD_BORDER} shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] ${bgClass} ${extra}`.trim();
}

function pivotTdData(bgClass) {
  return `px-2 py-1.5 text-center ${PIVOT_TD_BORDER} ${bgClass}`;
}

function PivotScrollTable({ cornerHeader, periodos, exibirPor, children }) {
  return (
    <div className={PIVOT_SCROLL_WRAP}>
      <table className={PIVOT_TABLE}>
        <thead>
          <tr>
            <th className={PIVOT_TH_CORNER}>{cornerHeader}</th>
            {periodos.map((p) => (
              <th key={p} className={PIVOT_TH_DATA}>
                {formatarDataLabel(p, exibirPor)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const tabelaPivotVazia = {
  chartData: [],
  tablePeriodos: [],
  tableMotivos: {},
  tableTotais: {},
  tableJornada: {},
  tableTotaisPorProduto: {},
  tableMotivosPorProduto: {},
  produtosOrdenados: [],
  useProdutoPivot: false,
};

export default function ConteudoAuxiliar({ stats, apenasTotal = false, tipo = '' }) {
  const [exibirPor, setExibirPor] = useState('dia');
  const [tabelaReclamacoesAberta, setTabelaReclamacoesAberta] = useState(true);
  const [tabelaJornadaAberta, setTabelaJornadaAberta] = useState(true);
  const [expandedProdutos, setExpandedProdutos] = useState(() => new Set());

  const {
    chartData,
    tablePeriodos,
    tableMotivos,
    tableTotais,
    tableJornada,
    tableTotaisPorProduto,
    tableMotivosPorProduto,
    produtosOrdenados,
    useProdutoPivot,
  } = useMemo(() => {
    if (!stats) return { ...tabelaPivotVazia };
    const useProdutoPivot =
      stats.motivosPorProdutoPorDia !== undefined &&
      stats.totaisPorProdutoPorDia !== undefined;

    if (exibirPor === 'mes') {
      const { reclamacoes, motivos: m, jornada: j, periodos } = agregarPorMes(
        stats.reclamacoesPorDia,
        stats.motivosPorDia,
        stats.jornadaDoReclamante
      );
      const totais = {};
      reclamacoes.forEach((r) => { totais[r.dia] = r.total; });

      let tProd = {};
      let mProd = {};
      if (useProdutoPivot) {
        const agg = agregarPorMesPorProduto(stats.totaisPorProdutoPorDia, stats.motivosPorProdutoPorDia);
        tProd = agg.totaisPorProdutoPorMes;
        mProd = agg.motivosPorProdutoPorMes;
      }
      const prodKeys = new Set([...Object.keys(tProd), ...Object.keys(mProd)]);
      const produtosOrdenados = Array.from(prodKeys).sort((a, b) => a.localeCompare(b, 'pt-BR'));

      return {
        chartData: reclamacoes,
        tablePeriodos: periodos,
        tableMotivos: m,
        tableTotais: totais,
        tableJornada: j,
        tableTotaisPorProduto: tProd,
        tableMotivosPorProduto: mProd,
        produtosOrdenados,
        useProdutoPivot,
      };
    }

    const totais = {};
    (stats.reclamacoesPorDia || []).forEach((r) => { totais[r.dia] = r.total; });
    const tProd = useProdutoPivot ? stats.totaisPorProdutoPorDia || {} : {};
    const mProd = useProdutoPivot ? stats.motivosPorProdutoPorDia || {} : {};
    const prodKeys = new Set([...Object.keys(tProd), ...Object.keys(mProd)]);
    const produtosOrdenados = Array.from(prodKeys).sort((a, b) => a.localeCompare(b, 'pt-BR'));

    return {
      chartData: stats.reclamacoesPorDia || [],
      tablePeriodos: stats.dias || [],
      tableMotivos: stats.motivosPorDia || {},
      tableTotais: totais,
      tableJornada: stats.jornadaDoReclamante || {},
      tableTotaisPorProduto: tProd,
      tableMotivosPorProduto: mProd,
      produtosOrdenados,
      useProdutoPivot,
    };
  }, [stats, exibirPor]);

  useEffect(() => {
    setExpandedProdutos(new Set());
  }, [stats, exibirPor]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-sm text-gray-600 dark:text-gray-400">Exibir por:</span>
        <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
          <button
            type="button"
            onClick={() => setExibirPor('dia')}
            className="px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              backgroundColor: exibirPor === 'dia' ? '#1634FF' : 'transparent',
              color: exibirPor === 'dia' ? '#fff' : '#1634FF',
            }}
          >
            Dia
          </button>
          <button
            type="button"
            onClick={() => setExibirPor('mes')}
            className="px-3 py-1.5 text-sm font-medium transition-colors border-l border-gray-300 dark:border-gray-600"
            style={{
              backgroundColor: exibirPor === 'mes' ? '#1634FF' : 'transparent',
              color: exibirPor === 'mes' ? '#fff' : '#1634FF',
            }}
          >
            Mês
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
          Reclamações por {exibirPor === 'dia' ? 'Dia' : 'Mês'}
        </h3>
        {chartData.length > 0 ? (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="dia" tick={{ fontSize: 11 }} tickFormatter={(v) => formatarDataLabel(v, exibirPor)} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip labelFormatter={(v) => formatarDataLabel(v, exibirPor)} />
                <Legend />
                <Line type="monotone" dataKey="total" name="Total" stroke="#1634FF" strokeWidth={2} dot={{ r: 3 }} />
                {!apenasTotal && (
                  <>
                    <Line type="monotone" dataKey="solicitadoAvaliacao" name={tipo === 'procon' ? 'Cliente Desistiu' : 'Solicitado Avaliação'} stroke="#15A237" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="avaliado" name={tipo === 'procon' ? 'Processo Encerrado' : 'Avaliado'} stroke="#FCC200" strokeWidth={2} dot={{ r: 3 }} />
                    {tipo === 'procon' && (
                      <Line type="monotone" dataKey="encaminhadoJuridico" name="Processo Encaminhado" stroke="#9333EA" strokeWidth={2} dot={{ r: 3 }} />
                    )}
                  </>
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-32 flex items-center justify-center text-gray-500 dark:text-gray-400 text-sm">
            Nenhum dado no período.
          </div>
        )}
      </div>

      <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setTabelaReclamacoesAberta((a) => !a)}
          className="w-full px-3 py-2 text-left text-sm font-semibold text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 flex items-center justify-between"
        >
          Reclamações por {exibirPor === 'dia' ? 'Dia' : 'Mês'}
          <span className="text-gray-500">{tabelaReclamacoesAberta ? '▼' : '▶'}</span>
        </button>
        {tabelaReclamacoesAberta && (
          <div className="p-2">
            {tablePeriodos.length > 0 &&
            (Object.keys(tableTotais).length > 0 ||
              (useProdutoPivot && produtosOrdenados.length > 0) ||
              (!useProdutoPivot && Object.keys(tableMotivos).length > 0)) ? (
              <PivotScrollTable
                cornerHeader={useProdutoPivot ? 'Produtos' : 'Motivo'}
                periodos={tablePeriodos}
                exibirPor={exibirPor}
              >
                {Object.keys(tableTotais).length > 0 && (
                  <tr className="font-medium">
                    <td className={pivotTdFirst(PIVOT_BG_TOTAL)}>Total</td>
                    {tablePeriodos.map((p) => (
                      <td key={p} className={pivotTdData(PIVOT_BG_TOTAL)}>
                        {tableTotais[p] ?? 0}
                      </td>
                    ))}
                  </tr>
                )}
                {useProdutoPivot
                  ? (() => {
                      let zebraIdx = 0;
                      const rows = [];
                      produtosOrdenados.forEach((prod) => {
                        const expanded = expandedProdutos.has(prod);
                        const bgP = zebraIdx % 2 === 0 ? PIVOT_BG_ZEBRA_A : PIVOT_BG_ZEBRA_B;
                        zebraIdx += 1;
                        const totaisProd = tableTotaisPorProduto[prod] || {};
                        rows.push(
                          <tr key={`prod-${prod}`}>
                            <td className={pivotTdFirst(bgP, 'font-medium')}>
                              <button
                                type="button"
                                className="flex items-center gap-1.5 text-left w-full min-w-0 text-gray-900 dark:text-gray-100"
                                onClick={() => {
                                  setExpandedProdutos((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(prod)) next.delete(prod);
                                    else next.add(prod);
                                    return next;
                                  });
                                }}
                                aria-expanded={expanded}
                              >
                                <span className="shrink-0 w-4 text-center text-gray-500" aria-hidden="true">
                                  {expanded ? '▼' : '▶'}
                                </span>
                                <span className="truncate">{rotuloProdutoPivot(prod)}</span>
                              </button>
                            </td>
                            {tablePeriodos.map((p) => (
                              <td key={p} className={pivotTdData(bgP)}>
                                {totaisProd[p] ?? 0}
                              </td>
                            ))}
                          </tr>
                        );
                        if (expanded) {
                          const motivosDoProd = tableMotivosPorProduto[prod] || {};
                          Object.entries(motivosDoProd).forEach(([motivo, counts]) => {
                            const bgM = zebraIdx % 2 === 0 ? PIVOT_BG_ZEBRA_A : PIVOT_BG_ZEBRA_B;
                            zebraIdx += 1;
                            rows.push(
                              <tr key={`prod-${prod}-mot-${motivo}`}>
                                <td className={pivotTdFirst(bgM)}>
                                  <span className="block pl-7 text-gray-700 dark:text-gray-300">{motivo}</span>
                                </td>
                                {tablePeriodos.map((p) => (
                                  <td key={p} className={pivotTdData(bgM)}>
                                    {counts[p] ?? 0}
                                  </td>
                                ))}
                              </tr>
                            );
                          });
                        }
                      });
                      return rows;
                    })()
                  : Object.entries(tableMotivos).map(([motivo, counts], i) => {
                      const bg = i % 2 === 0 ? PIVOT_BG_ZEBRA_A : PIVOT_BG_ZEBRA_B;
                      return (
                        <tr key={motivo}>
                          <td className={pivotTdFirst(bg)}>{motivo}</td>
                          {tablePeriodos.map((p) => (
                            <td key={p} className={pivotTdData(bg)}>
                              {counts[p] ?? 0}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
              </PivotScrollTable>
            ) : (
              <div className="h-24 flex items-center justify-center text-gray-500 dark:text-gray-400 text-sm">
                Nenhum dado no período.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setTabelaJornadaAberta((a) => !a)}
          className="w-full px-3 py-2 text-left text-sm font-semibold text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 flex items-center justify-between"
        >
          Jornada do Reclamante
          <span className="text-gray-500">{tabelaJornadaAberta ? '▼' : '▶'}</span>
        </button>
        {tabelaJornadaAberta && (
          <div className="p-2">
            {tablePeriodos.length > 0 && Object.keys(tableJornada).length > 0 ? (
              <PivotScrollTable cornerHeader="Jornada" periodos={tablePeriodos} exibirPor={exibirPor}>
                {getJornadaLinhas(tipo).map(({ key, label }, idx) => {
                  const isTotal = key === 'total';
                  const bg = isTotal
                    ? PIVOT_BG_TOTAL
                    : (idx - 1) % 2 === 0
                      ? PIVOT_BG_ZEBRA_A
                      : PIVOT_BG_ZEBRA_B;
                  return (
                    <tr
                      key={key}
                      className={isTotal ? 'font-medium' : ''}
                    >
                      <td className={pivotTdFirst(bg)}>{label}</td>
                      {tablePeriodos.map((p) => (
                        <td key={p} className={pivotTdData(bg)}>
                          {tableJornada[p]?.[key] ?? 0}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </PivotScrollTable>
            ) : (
              <div className="h-24 flex items-center justify-center text-gray-500 dark:text-gray-400 text-sm">
                Nenhum dado no período.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
