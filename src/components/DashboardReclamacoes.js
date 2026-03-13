/**
 * Painel Reclamações Tempo Real - DashboardReclamacoes
 * VERSION: v1.0.16
 *
 * Filtro de data: Bacen=dataEntrada, N2=dataEntradaN2, RA=dataReclam, Procon=dataProcon (não createdAt)
 */

import React from 'react';

const BARRAS_PIX_TEMPO_REAL = ['Total', 'Reclame Aqui', 'Bacen', 'Procon', 'N2'];

const DashboardReclamacoes = ({ stats, loading, activeTab = 'pix-tempo-real', filtrosHome }) => {
  const statsData = stats?.data || stats || {};
  const porTipo = statsData.porTipo || {};
  if (Object.keys(porTipo).length > 0) {
    console.log('[DASHBOARD_DISPLAY]', { filtrosHome, porTipo });
  }

  const CORES = {
    N2: '#1694FF',
    'Reclame Aqui': '#15A237',
    Bacen: '#1634FF',
    Procon: '#FCC200',
    Total: '#006AB9',
    Operacao: '#006AB9',
  };

  const hexToRgba = (hex, alpha = 0.15) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const CardMetric = ({ label, value, suffix = '' }) => (
    <div
      className="bg-gray-50 dark:bg-gray-700 rounded-xl text-center border hover:-translate-y-0.5 transition-transform"
      style={{ borderColor: '#000058', padding: '10.26px' }}
    >
      <div className="text-xs text-black">{label}</div>
      <div className="text-2xl font-semibold text-gray-800 dark:text-gray-200">
        {value ?? 0}{suffix}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-600 dark:text-gray-400">Carregando estatísticas...</div>
      </div>
    );
  }

  if (activeTab !== 'pix-tempo-real') {
    return null;
  }

  const temFiltros = filtrosHome?.produtos?.length || filtrosHome?.motivos?.length;
  const semDados = Object.keys(porTipo).length === 0 || porTipo.Total?.ocorrencias === 0;

  const renderConteudo = () => {
    if (semDados && temFiltros) {
      return (
        <div className="text-center py-8 text-gray-600 dark:text-gray-400 text-sm">
          Nenhum dado encontrado com os filtros aplicados.
          <p className="mt-2">Use o botão de configurações (engrenagem) para limpar ou ajustar os filtros.</p>
        </div>
      );
    }
    if (Object.keys(porTipo).length === 0) {
      return (
        <div className="text-center py-8 text-gray-600 dark:text-gray-400 text-sm">
          Nenhum dado disponível.
          {temFiltros && (
            <p className="mt-2">Tente usar o botão de configurações (engrenagem) para limpar ou ajustar os filtros.</p>
          )}
        </div>
      );
    }
    return (
        <div className="flex">
          <div className="flex-1 min-w-0 space-y-4 max-w-[85%]" style={{ paddingRight: '12px' }}>
          {BARRAS_PIX_TEMPO_REAL.map((tipo) => {
            const label = tipo === 'N2' ? 'N2' : tipo === 'Reclame Aqui' ? 'RA' : tipo;
            return (
            <div
              key={tipo}
              className="flex rounded-xl overflow-hidden"
              style={{ backgroundColor: hexToRgba(CORES[tipo] || '#000058') }}
            >
              <div
                className="flex items-center justify-center shrink-0 pl-2 pr-0"
                style={{ width: '2.5rem', minHeight: '5.13rem', paddingTop: '13.68px', paddingBottom: '13.68px' }}
              >
                <span
                  className="text-base font-semibold"
                  style={{ color: '#000058', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                >
                  {label}
                </span>
              </div>
              <div className="flex-1 pl-0.5 pr-4" style={{ paddingTop: '13.68px', paddingBottom: '13.68px' }}>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
                  <CardMetric label="Ocorrências" value={porTipo[tipo]?.ocorrencias} />
                  <CardMetric label="Em Aberto" value={porTipo[tipo]?.emAberto} />
                  <CardMetric label="Resolvido" value={porTipo[tipo]?.resolvido} />
                  <CardMetric label="N1 Acionado" value={porTipo[tipo]?.caEProtocolos} />
                  <CardMetric label="Sol. Liberação" value={porTipo[tipo]?.solLiberacao} />
                  <CardMetric label="Pix Liberado" value={porTipo[tipo]?.pixLiberado} />
                  <CardMetric label="Pix Retido" value={porTipo[tipo]?.pixRetido} />
                  <CardMetric label="% Retenção" value={porTipo[tipo]?.percRetencao} suffix="%" />
                </div>
              </div>
            </div>
          );
          })}
          </div>

          <div
            className="shrink-0 w-40 flex flex-col rounded-l-xl overflow-hidden self-stretch ml-auto"
            style={{ backgroundColor: hexToRgba(CORES.Operacao), paddingLeft: '6px' }}
          >
            <div className="flex justify-center py-3 border-b border-[#000058]/20 shrink-0">
              <span className="text-base font-semibold" style={{ color: '#000058' }}>
                Operação
              </span>
            </div>
            <div className="flex flex-col gap-2 flex-1 min-h-0" style={{ padding: '10.26px' }}>
              <CardMetric
                label="Taxa de Resolução"
                value={porTipo.Total?.taxaResolucao}
                suffix="%"
              />
            </div>
          </div>
        </div>
    );
  };

  return (
    <div className="w-full max-w-full py-4">
      {renderConteudo()}
    </div>
  );
};

export default DashboardReclamacoes;
