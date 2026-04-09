/**
 * Painel Reclamações Tempo Real - DashboardReclamacoes
 * VERSION: v2.6.0
 *
 * Cards por canal: valores diretos de porTipo (N1, RA, Bacen, Procon, N2).
 * N1: Ocorrências = todos os docs da collection N1 no período (API ignora produto/motivo da UI). % Retenção = pixRetido/ocorrencias. Escalado N2 (pixLiberado) = escalar_chamado Ouvidoria | Devolutiva | -; Retidos / Em Aberto como stats.
 * Bacen, RA, Procon e N2 (stats v1.21.0): Liberados, Retidos, Sem resposta, Op. cancelada e Em aberto são classes excludentes por documento (soma ≤ ocorrências; “Liberado” só com caso resolvido).
 * Painel executivo (adm): Ocorrências, Liberados, Retidos, % Retenção e Taxa de Resolução = Total menos N1 (mesma base em todos os mostradores daquele bloco).
 * % Retenção em cada card (incl. N1): retidos ÷ ocorrências (solLiberacao) só com dados daquele canal. Painel adm: agregado sem N1. Paleta LAYOUT_GUIDELINES.
 */

import React from 'react';

/* ========== CONSTANTES (LAYOUT_GUIDELINES) ========== */
const CORES = {
  blueDark: '#000058',
  blueMedium: '#1634FF',
  blueLight: '#1694FF',
  blueOpaque: '#006AB9',
  yellow: '#FCC200',
  green: '#15A237',
  corFundo: '#f0f4f8',
  corCard: '#F3F7FC',
  corCardDark: '#323a42',
  corFundoDark: '#272A30',
};

const BASE_ICONS = process.env.PUBLIC_URL || '';
const CANAIS = [
  { key: 'N1', label: 'N1', iconSrc: `${BASE_ICONS}/icon N1.png`, cor: CORES.blueLight },
  { key: 'Reclame Aqui', label: 'RA', iconSrc: `${BASE_ICONS}/icon RA.png`, cor: CORES.green },
  { key: 'Bacen', label: 'Bacen', iconSrc: `${BASE_ICONS}/icon bacen.png`, cor: CORES.blueOpaque },
  { key: 'Procon', label: 'Procon', iconSrc: `${BASE_ICONS}/icon procon.png`, cor: CORES.yellow },
  { key: 'N2', label: 'N2', iconSrc: `${BASE_ICONS}/icon n2.png`, cor: CORES.blueMedium },
];

/** % Retenção: retidos ÷ base (solLiberacao ou ocorrencias conforme o card), 1 decimal. */
function percRetencaoSobreOcorrencias(retidos, ocorrenciasSolLiberacao) {
  const o = Number(ocorrenciasSolLiberacao) || 0;
  const r = Number(retidos) || 0;
  if (o <= 0) return 0;
  return Math.round((r / o) * 1000) / 10;
}

/** Alinhado a stats.js: resolvido / ocorrencias × 100 (1 decimal). */
function taxaResolucaoLiteral(resolvido, ocorrencias) {
  const o = Number(ocorrencias) || 0;
  const r = Number(resolvido) || 0;
  if (o <= 0) return 0;
  return Math.round((r / o) * 1000) / 10;
}

/* ========== GAUGE CIRCULAR (VELOCÍMETRO) ========== */
function GaugeCircular({ valor, max = 100, cor = CORES.blueMedium, size = 64 }) {
  const pct = Math.min(Math.max(Number(valor) || 0, 0), max);
  const strokeDasharray = 2 * Math.PI * 22;
  const strokeDashoffset = strokeDasharray - (strokeDasharray * pct) / max;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 64 64" className="transform -rotate-[130deg]">
        <circle
          cx="32"
          cy="32"
          r="22"
          fill="none"
          stroke="rgba(0,0,0,0.08)"
          strokeWidth="6"
          className="dark:stroke-white/10"
        />
        <circle
          cx="32"
          cy="32"
          r="22"
          fill="none"
          stroke={cor}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: 'stroke-dashoffset 0.6s ease-out' }}
        />
      </svg>
      <span
        className={`absolute font-semibold text-center ${size >= 90 ? 'text-sm' : 'text-xs'}`}
        style={{ color: CORES.blueDark }}
      >
        {typeof valor === 'number' ? valor.toFixed(1) : valor ?? '0'}%
      </span>
    </div>
  );
}

const DashboardReclamacoes = ({ stats, loading, activeTab = 'pix-tempo-real', filtrosHome }) => {
  const statsData = stats?.data || stats || {};
  const porTipo = statsData.porTipo || {};

  if (activeTab !== 'pix-tempo-real') {
    return null;
  }

  const temFiltros = filtrosHome?.produtos?.length || filtrosHome?.motivos?.length;
  const semDados = Object.keys(porTipo).length === 0 || porTipo.Total?.ocorrencias === 0;

  const getDados = (key) => porTipo[key] || {};

  const total = porTipo.Total || {};
  const n1 = getDados('N1');
  const n1Sol = Number(n1.solLiberacao) || 0;
  const n1PixL = Number(n1.pixLiberado) || 0;
  const n1PixR = Number(n1.pixRetido) || 0;
  const n1Res = Number(n1.resolvido) || 0;
  const n1Occ = Number(n1.ocorrencias) || 0;

  const ocorrenciasPainelExecutivo = Math.max(0, (Number(total.solLiberacao) || 0) - n1Sol);
  const liberadosPainelExecutivo = Math.max(0, (Number(total.pixLiberado) || 0) - n1PixL);
  const retidosPainelExecutivo = Math.max(0, (Number(total.pixRetido) || 0) - n1PixR);
  const percTotalRetencao = percRetencaoSobreOcorrencias(retidosPainelExecutivo, ocorrenciasPainelExecutivo);

  const ocorrenciasDocsExecutivo = Math.max(0, (Number(total.ocorrencias) || 0) - n1Occ);
  const resolvidoExecutivo = Math.max(0, (Number(total.resolvido) || 0) - n1Res);
  const taxaResolucaoExecutivo = taxaResolucaoLiteral(resolvidoExecutivo, ocorrenciasDocsExecutivo);
  const hexToRgba = (hex, alpha = 0.20) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-600 dark:text-gray-400 font-[Poppins]">Carregando estatísticas...</div>
      </div>
    );
  }

  if (semDados && temFiltros) {
    return (
      <div className="text-center py-8 text-gray-600 dark:text-gray-400 text-sm font-[Poppins]">
        Nenhum dado encontrado com os filtros aplicados.
        <p className="mt-2">Use o botão de configurações (engrenagem) para limpar ou ajustar os filtros.</p>
      </div>
    );
  }

  if (Object.keys(porTipo).length === 0) {
    return (
      <div className="text-center py-8 text-gray-600 dark:text-gray-400 text-sm font-[Poppins]">
        Nenhum dado disponível.
        {temFiltros && (
          <p className="mt-2">Tente usar o botão de configurações (engrenagem) para limpar ou ajustar os filtros.</p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-full flex-1 min-h-0 flex flex-col py-4 font-[Poppins]">
      {/* ========== VISÃO GERAL (PAINEL EXECUTIVO) - ícone à esquerda + painel ========== */}
      <div className="relative flex items-center shrink-0 overflow-visible" style={{ margin: '0 auto', width: '75%', marginLeft: 'calc(12.5% - 40px)' }}>
        <div className="relative z-10 shrink-0 flex items-center justify-center overflow-visible" style={{ width: 220, height: 220 }}>
          <img src={`${BASE_ICONS}/icon adm.png`} alt="" className="object-contain" style={{ width: 286, height: 286 }} />
        </div>
        <section className="relative z-0 flex-1 min-w-0 rounded-xl p-4 transition-all duration-300 ease-out -ml-11"
          style={{
            background: `linear-gradient(to bottom, ${CORES.blueOpaque}, ${CORES.corCard})`,
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
            border: `2px solid ${CORES.blueDark}`,
          }}
        >
        <div className="flex flex-col gap-2">
          {/* Linha 1: 3 mostradores numéricos */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div className="rounded-lg py-3 px-4 flex flex-col border bg-white min-h-[88px]" style={{ borderColor: CORES.blueMedium }}>
              <div className="text-sm font-medium text-gray-600 dark:text-gray-400 shrink-0 text-center">Ocorrências</div>
              <div className="flex items-center justify-center py-1">
                <span className="text-3xl font-bold" style={{ color: CORES.blueDark }}>{ocorrenciasPainelExecutivo}</span>
              </div>
            </div>
            <div className="rounded-lg py-3 px-4 flex flex-col border bg-white min-h-[88px]" style={{ borderColor: CORES.blueMedium }}>
              <div className="text-sm font-medium text-gray-600 dark:text-gray-400 shrink-0 text-center">Liberados</div>
              <div className="flex items-center justify-center py-1">
                <span className="text-3xl font-bold" style={{ color: '#c0392b' }}>{liberadosPainelExecutivo}</span>
              </div>
            </div>
            <div className="rounded-lg py-3 px-4 flex flex-col border bg-white min-h-[88px] col-span-2 md:col-span-1" style={{ borderColor: CORES.blueMedium }}>
              <div className="text-sm font-medium text-gray-600 dark:text-gray-400 shrink-0 text-center">Retidos</div>
              <div className="flex items-center justify-center py-1">
                <span className="text-3xl font-bold" style={{ color: CORES.green }}>{retidosPainelExecutivo}</span>
              </div>
            </div>
          </div>
          {/* Linha 2: 2 mostradores com termômetro (rótulo à esquerda, gauge à direita) */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg py-2 px-3 flex items-center justify-between gap-2 border bg-white min-h-0 w-full" style={{ borderColor: CORES.blueMedium }}>
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400 shrink-0 leading-tight text-left">% Retenção</span>
              <GaugeCircular valor={percTotalRetencao} cor={percTotalRetencao > 5 ? CORES.yellow : CORES.blueMedium} size={82} />
            </div>
            <div className="rounded-lg py-2 px-3 flex items-center justify-between gap-2 border bg-white min-h-0 w-full" style={{ borderColor: CORES.blueMedium }}>
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400 shrink-0 leading-tight text-left">Taxa de Resolução</span>
              <GaugeCircular valor={taxaResolucaoExecutivo} cor={taxaResolucaoExecutivo >= 90 ? CORES.green : CORES.blueMedium} size={82} />
            </div>
          </div>
        </div>
      </section>
      </div>

      {/* Espaçador flexível: empurra os cards para o rodapé */}
      <div className="flex-1 min-h-0" aria-hidden="true" />

      {/* ========== CARDS POR CANAL ========== */}
      <section className="shrink-0 grid grid-cols-5 gap-3 min-w-0 overflow-x-auto mt-4">
        {CANAIS.map((canal, idx) => {
          const dados = getDados(canal.key);
          const baseRetencao = canal.key === 'N1' ? dados.ocorrencias : dados.solLiberacao;
          const percRetCard = percRetencaoSobreOcorrencias(dados.pixRetido, baseRetencao);
          const bgRgba = hexToRgba(canal.cor);
          return (
            <div
              key={canal.key}
              className="rounded-xl overflow-hidden transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg flex flex-col min-w-0"
              style={{
                backgroundColor: 'var(--cor-card, #F3F7FC)',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
                border: '1px solid rgba(22, 52, 255, 0.1)',
                animation: `fadeIn 0.4s ease-out ${idx * 0.05}s both`,
              }}
            >
              <div className="flex items-center gap-3 px-3 border-b shrink-0 h-16 overflow-visible" style={{ borderColor: 'rgba(22, 52, 255, 0.1)', backgroundColor: bgRgba }}>
                <img src={canal.iconSrc} alt="" className="shrink-0 object-contain" style={{ width: 64, height: 64 }} />
                <span className="font-[Anton] text-lg truncate" style={{ color: CORES.blueMedium }}>{canal.label}</span>
              </div>
              <div className="py-3 px-3 flex flex-col gap-2">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center gap-2 min-h-0">
                    <span className="text-xs text-gray-600 dark:text-gray-400">Ocorrências</span>
                    <span className="text-lg font-bold" style={{ color: CORES.blueDark }}>{dados.ocorrencias ?? 0}</span>
                  </div>
                  <div className="flex justify-between items-center gap-2 min-h-0">
                    <span className="text-xs text-gray-600 dark:text-gray-400">{canal.key === 'N1' ? 'Escalado N2' : 'Liberados'}</span>
                    <span className="text-base font-semibold" style={{ color: '#c0392b' }}>{dados.pixLiberado ?? 0}</span>
                  </div>
                  <div className="flex justify-between items-center gap-2 min-h-0">
                    <span className="text-xs text-gray-600 dark:text-gray-400">Retidos</span>
                    <span className="text-base font-semibold" style={{ color: CORES.green }}>{dados.pixRetido ?? 0}</span>
                  </div>
                  {canal.key === 'N1' && (
                    <div className="flex justify-between items-center gap-2 min-h-0">
                      <span className="text-xs text-gray-600 dark:text-gray-400">Em Aberto</span>
                      <span className="text-base font-semibold" style={{ color: CORES.blueDark }}>{dados.emAberto ?? 0}</span>
                    </div>
                  )}
                  {canal.key !== 'N1' && (
                    <>
                      <div className="flex justify-between items-center gap-2 min-h-0">
                        <span className="text-xs text-gray-600 dark:text-gray-400">Sem Resposta</span>
                        <span className="text-base font-semibold" style={{ color: CORES.blueDark }}>{dados.semResposta ?? 0}</span>
                      </div>
                      <div className="flex justify-between items-center gap-2 min-h-0">
                        <span className="text-xs text-gray-600 dark:text-gray-400">Op. Cancelada</span>
                        <span className="text-base font-semibold" style={{ color: CORES.blueDark }}>{dados.opCancelada ?? 0}</span>
                      </div>
                      <div className="flex justify-between items-center gap-2 min-h-0">
                        <span className="text-xs text-gray-600 dark:text-gray-400">Em Aberto</span>
                        <span className="text-base font-semibold" style={{ color: CORES.blueDark }}>{dados.emAberto ?? 0}</span>
                      </div>
                    </>
                  )}
                </div>
                <div
                  className="flex items-center justify-between gap-2 w-full min-w-0 pt-1 border-t shrink-0"
                  style={{ borderColor: 'rgba(22, 52, 255, 0.1)' }}
                >
                  <span className="text-xs text-gray-600 dark:text-gray-400 leading-tight text-left shrink-0">% Retenção</span>
                  <div className="shrink-0 flex items-center">
                    <GaugeCircular valor={percRetCard} cor={percRetCard > 5 ? CORES.yellow : canal.cor} size={68} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
};

export default DashboardReclamacoes;
