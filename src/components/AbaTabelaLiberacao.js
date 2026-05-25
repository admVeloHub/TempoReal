/**
 * Painel Reclamações Tempo Real - AbaTabelaLiberacao
 * VERSION: v1.3.8
 *
 * v1.3.8: Casos sem Fechamento — table-fixed; Data 9rem; Total 3rem; colunas tipo com largura igual.
 * v1.3.7: Cabeçalho expandido — label + Ocorr/Liber na mesma célula (sem 2ª linha thead); border-collapse.
 * v1.3.6: Coluna Total mais estreita (3rem, padding reduzido).
 * v1.3.5: Subtítulo Casos sem Fechamento na mesma linha do título.
 * v1.3.3: Texto descritivo Casos sem Fechamento — chave Pix sinalizada como Liberado (não pixLiberado=true).
 * v1.3.1: Scroll vertical (máx. 12 linhas de dados + cabeçalho fixo); só colunas expandíveis; colunas Data/Total fixas no scroll horizontal.
 * v1.3.0: Pivot transposta — linhas = datas (DD/MM Semana), colunas = tipos com expansão simétrica; tabela Casos sem Fechamento.
 *
 * Tabela: GET /api/stats/tabela-liberacao (mesmos filtros globais que a home — engrenagem).
 * Export tabela: GET /tabela-liberacao/export (2 abas Excel).
 * Export base: GET /relatorio-ouvidoria-base (período do bloco inferior + produto/motivo globais).
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  fetchStatsTabelaLiberacao,
  downloadConciliacaoTabelaExcel,
  downloadRelatorioOuvidoriaBaseExcel,
} from '../services/api';
import {
  buildQueryParamsStatsFromFiltrosHome,
  assinaturaFiltrosHomeParaStatsQuery,
} from './FiltrosAuxiliar';

const POLL_MS = 60000;

/** LAYOUT_GUIDELINES / theme — azul opaco da marca */
const AZUL_OPACO = '#006AB9';

const DIAS_SEMANA_PT = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Máximo de linhas de dados visíveis antes do scroll vertical (cabeçalho e rodapé Total não contam). */
const MAX_LINHAS_VISIVEIS = 12;
const ALTURA_LINHA_PX = 36;
const COL_DATA_WIDTH = '9rem';

const COL_TOTAL_CLASS =
  `min-w-[3rem] max-w-[3rem] w-[3rem] px-1 py-1.5 text-center`;

const PIVOT_TABLE = 'min-w-full text-xs border-collapse';

const TH_SPLIT_BORDER = 'border-gray-300 dark:border-gray-600';

const PIVOT_BG_ZEBRA_A = 'bg-white dark:bg-gray-950';
const PIVOT_BG_ZEBRA_B = 'bg-slate-200 dark:bg-gray-800';
const PIVOT_TD_BORDER =
  'border-b border-r border-slate-400 dark:border-gray-500';

const TH_BASE =
  'px-2 py-1.5 border-b border-r border-gray-300 dark:border-gray-600 font-medium bg-gray-100 dark:bg-gray-700 whitespace-nowrap';

const TF_BASE =
  'px-2 py-1.5 border-b border-r border-gray-300 dark:border-gray-600 font-medium bg-gray-100 dark:bg-gray-700 whitespace-nowrap';

function pivotScrollMaxHeightPx(headerRowCount) {
  return headerRowCount * ALTURA_LINHA_PX + MAX_LINHAS_VISIVEIS * ALTURA_LINHA_PX + ALTURA_LINHA_PX;
}

function stickyTopStyle(topPx, extra = {}) {
  return { position: 'sticky', top: topPx, zIndex: 20, ...extra };
}

function stickyLeftStyle(left, extra = {}) {
  return { position: 'sticky', left, ...extra };
}

function stickyBottomStyle(extra = {}) {
  return { position: 'sticky', bottom: 0, zIndex: 15, ...extra };
}

function pivotTdFirst(bgClass, extra = '') {
  return `sticky left-0 z-[10] px-2 py-1.5 min-w-[9rem] max-w-[9rem] w-[9rem] ${PIVOT_TD_BORDER} shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] ${bgClass} ${extra}`.trim();
}

function pivotTdTotal(bgClass) {
  return `sticky z-[9] ${COL_TOTAL_CLASS} ${PIVOT_TD_BORDER} shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)] ${bgClass}`;
}

function pivotTdData(bgClass) {
  return `px-2 py-1.5 text-center min-w-[3.5rem] ${PIVOT_TD_BORDER} ${bgClass}`;
}

/** Célula tipo — Casos sem Fechamento (largura igual via table-fixed + colgroup). */
function pivotTdTipoSemFechamento(bgClass) {
  return `px-1 py-1.5 text-center ${PIVOT_TD_BORDER} ${bgClass}`;
}

function pivotThTipoSemFechamento() {
  return `${TH_BASE} text-center px-1 whitespace-normal leading-tight`;
}

/** DD/MM Semana — dia ISO UTC (paridade backend fmtDiaComSemanaUtc). */
function formatarDiaComSemana(yyyyMmDd) {
  if (!yyyyMmDd) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(yyyyMmDd).trim());
  if (!m) return yyyyMmDd;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(dt.getTime())) return yyyyMmDd;
  const dd = String(m[3]).padStart(2, '0');
  const mm = String(m[2]).padStart(2, '0');
  const wd = DIAS_SEMANA_PT[dt.getUTCDay()];
  return `${dd}/${mm} ${wd}`;
}

function toggleSet(setter, key) {
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}

/** Query da exportação da base: período do bloco inferior + produto/motivo globais. */
function paramsExportacaoBase(filtrosHome, periodoBase) {
  const shared = buildQueryParamsStatsFromFiltrosHome(filtrosHome);
  const di = periodoBase?.dataInicio != null && String(periodoBase.dataInicio).trim() !== ''
    ? String(periodoBase.dataInicio).trim()
    : undefined;
  const df = periodoBase?.dataFim != null && String(periodoBase.dataFim).trim() !== ''
    ? String(periodoBase.dataFim).trim()
    : undefined;
  return {
    dataInicio: di,
    dataFim: df,
    produtos: shared.produtos,
    motivos: shared.motivos,
  };
}

function PivotScrollWrap({ headerRowCount, children }) {
  return (
    <div
      className="w-full overflow-auto rounded border border-gray-300 dark:border-gray-600"
      style={{ maxHeight: `${pivotScrollMaxHeightPx(headerRowCount)}px` }}
    >
      {children}
    </div>
  );
}

function CelulasTipo({ dia, card, cardOpen, matriz, bgClass }) {
  const cell = matriz?.[dia]?.[card.key] || { ocorrencias: 0, liberados: 0 };
  const o = cell.ocorrencias ?? 0;
  const l = cell.liberados ?? 0;

  if (cardOpen) {
    return (
      <>
        <td className={pivotTdData(bgClass)}><span className="tabular-nums">{o}</span></td>
        <td className={pivotTdData(bgClass)}><span className="tabular-nums">{l}</span></td>
      </>
    );
  }
  return (
    <td className={pivotTdData(bgClass)}>
      <span className="tabular-nums" title="Ocorrências / Liberados">{o} / {l}</span>
    </td>
  );
}

function CabecalhoConciliacao({ cards, expandedCards, onToggleCard }) {
  const anyCardOpen = cards.some((c) => expandedCards.has(c.key));
  const headerSpan = anyCardOpen ? 2 : 1;
  const headerMinH = anyCardOpen ? ALTURA_LINHA_PX * 2 : undefined;
  const cornerStyle = { ...stickyTopStyle(0, { zIndex: 30 }), ...stickyLeftStyle(0) };
  const totalStyle = { ...stickyTopStyle(0, { zIndex: 28 }), ...stickyLeftStyle(COL_DATA_WIDTH) };
  const thStickyCard = stickyTopStyle(0, { zIndex: 25 });

  return (
    <thead>
      <tr style={headerMinH ? { height: `${headerMinH}px` } : undefined}>
        <th
          className={`${TH_BASE} text-left min-w-[9rem] max-w-[9rem] w-[9rem] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] align-middle`}
          rowSpan={headerSpan}
          style={cornerStyle}
        >
          Data
        </th>
        <th
          className={`${TH_BASE} ${COL_TOTAL_CLASS} shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)] align-middle`}
          rowSpan={headerSpan}
          style={totalStyle}
        >
          Total
        </th>
        {cards.map((card) => {
          const open = expandedCards.has(card.key);
          if (open) {
            return (
              <th
                key={card.key}
                colSpan={2}
                rowSpan={headerSpan}
                className={`p-0 border-b border-r ${TH_SPLIT_BORDER} bg-gray-100 dark:bg-gray-700 align-top`}
                style={thStickyCard}
              >
                <div
                  className="flex flex-col h-full"
                  style={{ minHeight: headerMinH ? `${headerMinH}px` : undefined }}
                >
                  <button
                    type="button"
                    className={`flex flex-1 items-center justify-center gap-1 w-full font-medium text-gray-800 dark:text-gray-200 border-b ${TH_SPLIT_BORDER} px-1`}
                    style={{ minHeight: `${ALTURA_LINHA_PX}px` }}
                    onClick={() => onToggleCard(card.key)}
                    aria-expanded
                  >
                    <span className="text-gray-500 text-[10px]" aria-hidden>▼</span>
                    {card.label}
                  </button>
                  <div
                    className="grid grid-cols-2 flex-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
                    style={{ minHeight: `${ALTURA_LINHA_PX}px` }}
                  >
                    <span className={`flex items-center justify-center border-r ${TH_SPLIT_BORDER}`}>
                      Ocorr.
                    </span>
                    <span className="flex items-center justify-center">Liber.</span>
                  </div>
                </div>
              </th>
            );
          }
          return (
            <th
              key={card.key}
              className={`${TH_BASE} text-center min-w-[3.5rem] align-middle`}
              rowSpan={headerSpan}
              style={thStickyCard}
            >
              <button
                type="button"
                className="w-full flex items-center justify-center gap-1 font-medium text-gray-800 dark:text-gray-200"
                onClick={() => onToggleCard(card.key)}
                aria-expanded={false}
              >
                <span className="text-gray-500 text-[10px]" aria-hidden>▶</span>
                {card.label}
              </button>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}


function TabelaConciliacao({
  dias,
  cards,
  matriz,
  totaisPorDia,
  totaisPorCard,
  expandedCards,
  onToggleCard,
}) {
  const anyCardOpen = cards.some((c) => expandedCards.has(c.key));
  const headerRowCount = anyCardOpen ? 2 : 1;
  const totalStickyLeft = { left: COL_DATA_WIDTH };
  const grandO = cards.reduce((s, c) => s + (totaisPorCard[c.key]?.ocorrencias ?? 0), 0);
  const grandL = cards.reduce((s, c) => s + (totaisPorCard[c.key]?.liberados ?? 0), 0);
  const footCornerStyle = { ...stickyBottomStyle({ zIndex: 18 }), ...stickyLeftStyle(0) };
  const footTotalStyle = { ...stickyBottomStyle({ zIndex: 17 }), ...stickyLeftStyle(COL_DATA_WIDTH) };
  const footCellStyle = stickyBottomStyle({ zIndex: 16 });

  return (
    <PivotScrollWrap headerRowCount={headerRowCount}>
      <table className={PIVOT_TABLE}>
        <CabecalhoConciliacao
          cards={cards}
          expandedCards={expandedCards}
          onToggleCard={onToggleCard}
        />
        <tbody>
          {dias.map((dia, idx) => {
            const bgP = idx % 2 === 0 ? PIVOT_BG_ZEBRA_A : PIVOT_BG_ZEBRA_B;
            const tdDay = totaisPorDia[dia] || { ocorrencias: 0, liberados: 0 };
            return (
              <tr key={dia}>
                <td className={pivotTdFirst(bgP, 'font-medium whitespace-nowrap')}>
                  {formatarDiaComSemana(dia)}
                </td>
                <td className={pivotTdTotal(bgP)} style={totalStickyLeft}>
                  <span className="tabular-nums" title="Ocorrências / Liberados">
                    {tdDay.ocorrencias} / {tdDay.liberados}
                  </span>
                </td>
                {cards.map((card) => (
                  <CelulasTipo
                    key={card.key}
                    dia={dia}
                    card={card}
                    cardOpen={expandedCards.has(card.key)}
                    matriz={matriz}
                    bgClass={bgP}
                  />
                ))}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-medium">
            <td className={`${TF_BASE} ${pivotTdFirst(PIVOT_BG_ZEBRA_A)}`} style={footCornerStyle}>
              Total
            </td>
            <td className={`${TF_BASE} ${pivotTdTotal(PIVOT_BG_ZEBRA_A)}`} style={{ ...footTotalStyle, ...totalStickyLeft }}>
              <span className="tabular-nums">{grandO} / {grandL}</span>
            </td>
            {cards.map((card) => {
              const t = totaisPorCard[card.key] || { ocorrencias: 0, liberados: 0 };
              if (expandedCards.has(card.key)) {
                return (
                  <React.Fragment key={card.key}>
                    <td className={`${TF_BASE} ${pivotTdData(PIVOT_BG_ZEBRA_A)}`} style={footCellStyle}>
                      <span className="tabular-nums">{t.ocorrencias}</span>
                    </td>
                    <td className={`${TF_BASE} ${pivotTdData(PIVOT_BG_ZEBRA_A)}`} style={footCellStyle}>
                      <span className="tabular-nums">{t.liberados}</span>
                    </td>
                  </React.Fragment>
                );
              }
              return (
                <td key={card.key} className={`${TF_BASE} ${pivotTdData(PIVOT_BG_ZEBRA_A)}`} style={footCellStyle}>
                  <span className="tabular-nums">{t.ocorrencias} / {t.liberados}</span>
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </PivotScrollWrap>
  );
}

function TabelaSemFechamento({ dias, cards, casosSemFechamento }) {
  const sf = casosSemFechamento || { matriz: {}, totaisPorDia: {}, totaisPorCard: {} };
  const grand = Object.values(sf.totaisPorDia || {}).reduce((a, b) => a + b, 0);
  const totalStickyLeft = { left: COL_DATA_WIDTH };
  const footCornerStyle = { ...stickyBottomStyle({ zIndex: 18 }), ...stickyLeftStyle(0) };
  const footTotalStyle = { ...stickyBottomStyle({ zIndex: 17 }), ...stickyLeftStyle(COL_DATA_WIDTH) };
  const footCellStyle = stickyBottomStyle({ zIndex: 16 });
  const headCornerStyle = { ...stickyTopStyle(0, { zIndex: 30 }), ...stickyLeftStyle(0) };
  const headTotalStyle = { ...stickyTopStyle(0, { zIndex: 28 }), ...stickyLeftStyle(COL_DATA_WIDTH) };

  return (
    <PivotScrollWrap headerRowCount={1}>
      <table className={`${PIVOT_TABLE} table-fixed w-full`}>
        <colgroup>
          <col style={{ width: COL_DATA_WIDTH }} />
          <col style={{ width: '3rem' }} />
          {cards.map((c) => (
            <col key={c.key} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th
              className={`${TH_BASE} text-left min-w-[9rem] max-w-[9rem] w-[9rem] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]`}
              style={headCornerStyle}
            >
              Data
            </th>
            <th
              className={`${TH_BASE} ${COL_TOTAL_CLASS} shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]`}
              style={headTotalStyle}
            >
              Total
            </th>
            {cards.map((c) => (
              <th
                key={c.key}
                className={pivotThTipoSemFechamento()}
                style={stickyTopStyle(0, { zIndex: 25 })}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dias.map((dia, idx) => {
            const bgP = idx % 2 === 0 ? PIVOT_BG_ZEBRA_A : PIVOT_BG_ZEBRA_B;
            return (
              <tr key={dia}>
                <td className={pivotTdFirst(bgP, 'font-medium whitespace-nowrap')}>
                  {formatarDiaComSemana(dia)}
                </td>
                <td className={pivotTdTotal(bgP)} style={totalStickyLeft}>
                  <span className="tabular-nums">{sf.totaisPorDia[dia] ?? 0}</span>
                </td>
                {cards.map((c) => (
                  <td key={c.key} className={pivotTdTipoSemFechamento(bgP)}>
                    <span className="tabular-nums">{sf.matriz[dia]?.[c.key] ?? 0}</span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-medium">
            <td className={`${TF_BASE} ${pivotTdFirst(PIVOT_BG_ZEBRA_A)}`} style={footCornerStyle}>
              Total
            </td>
            <td className={`${TF_BASE} ${pivotTdTotal(PIVOT_BG_ZEBRA_A)}`} style={{ ...footTotalStyle, ...totalStickyLeft }}>
              <span className="tabular-nums">{grand}</span>
            </td>
            {cards.map((c) => (
              <td key={c.key} className={`${TF_BASE} ${pivotTdTipoSemFechamento(PIVOT_BG_ZEBRA_A)}`} style={footCellStyle}>
                <span className="tabular-nums">{sf.totaisPorCard[c.key] ?? 0}</span>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </PivotScrollWrap>
  );
}

export default function AbaTabelaLiberacao({ filtrosHome, refreshTrigger = 0, activeTab }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedCards, setExpandedCards] = useState(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [periodoBase, setPeriodoBase] = useState({ dataInicio: '', dataFim: '' });

  const assinaturaFiltrosGlobais = useMemo(
    () => assinaturaFiltrosHomeParaStatsQuery(filtrosHome),
    [
      filtrosHome?.dataInicio,
      filtrosHome?.dataFim,
      filtrosHome?.produtos,
      filtrosHome?.motivos,
    ]
  );

  const paramsMemo = useMemo(() => buildQueryParamsStatsFromFiltrosHome(filtrosHome), [
    assinaturaFiltrosGlobais,
    filtrosHome,
  ]);

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

  const abortFetchRef = useRef(null);
  const fetchSeqRef = useRef(0);

  useEffect(() => () => {
    abortFetchRef.current?.abort();
  }, []);

  const load = useCallback(async () => {
    if (activeTab !== 'tabela-liberacao') return;
    abortFetchRef.current?.abort();
    const ac = new AbortController();
    abortFetchRef.current = ac;
    const mySeq = ++fetchSeqRef.current;

    setLoading(true);
    setError(null);
    try {
      const res = await fetchStatsTabelaLiberacao(paramsMemo, { signal: ac.signal });
      if (mySeq !== fetchSeqRef.current) return;
      setData(res.data);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      if (mySeq !== fetchSeqRef.current) return;
      setError(err.message || String(err));
      setData(null);
    } finally {
      if (mySeq === fetchSeqRef.current) setLoading(false);
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
  const cards = data?.cards || [];
  const matriz = data?.matriz || {};
  const totaisPorDia = data?.totaisPorDia || {};
  const totaisPorCard = data?.totaisPorCard || {};
  const casosSemFechamento = data?.casosSemFechamento;

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
              Nenhum dia no período / filtros atuais.
            </div>
          ) : (
            <TabelaConciliacao
              dias={dias}
              cards={cards}
              matriz={matriz}
              totaisPorDia={totaisPorDia}
              totaisPorCard={totaisPorCard}
              expandedCards={expandedCards}
              onToggleCard={(k) => toggleSet(setExpandedCards, k)}
            />
          )}

          <div className="border-t border-gray-300 dark:border-gray-600 pt-4 mt-4" role="separator" />

          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1 mb-2">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 shrink-0">
              Casos sem Fechamento
            </h3>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Casos não resolvidos, com chave pix com a liberação já sinalizada
            </span>
          </div>

          {dias.length === 0 && !error ? (
            <div className="text-center py-6 text-gray-600 dark:text-gray-400 text-sm">
              Nenhum dia no período / filtros atuais.
            </div>
          ) : (
            <TabelaSemFechamento
              dias={dias}
              cards={cards}
              casosSemFechamento={casosSemFechamento}
            />
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
