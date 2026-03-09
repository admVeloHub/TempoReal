/**
 * Painel Reclamações Tempo Real - ConteudoAuxiliar
 * VERSION: v1.0.8
 *
 * Gráfico e tabelas (Reclamações por Dia/Mês, Jornada do Reclamante).
 * Compartilhado por AbaRA e AbaAuxiliar (Bacen, Procon, N2).
 * apenasTotal: quando true, gráfico exibe só Total (ex.: Bacen).
 * Labels de data: DD/MM.
 */

import React, { useState, useMemo } from 'react';

function formatarDataLabel(str, exibirPor) {
  if (!str) return str;
  if (exibirPor === 'mes') {
    const [y, m] = str.split('-');
    return m && y ? `${m}/${y}` : str;
  }
  const [y, m, d] = str.split('-');
  return d && m ? `${d}/${m}` : str;
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

export default function ConteudoAuxiliar({ stats, apenasTotal = false, tipo = '' }) {
  const [exibirPor, setExibirPor] = useState('dia');
  const [tabelaReclamacoesAberta, setTabelaReclamacoesAberta] = useState(true);
  const [tabelaJornadaAberta, setTabelaJornadaAberta] = useState(true);

  const { chartData, tablePeriodos, tableMotivos, tableTotais, tableJornada } = useMemo(() => {
    if (!stats) return { chartData: [], tablePeriodos: [], tableMotivos: {}, tableTotais: {}, tableJornada: {} };
    if (exibirPor === 'mes') {
      const { reclamacoes, motivos: m, jornada: j, periodos } = agregarPorMes(
        stats.reclamacoesPorDia,
        stats.motivosPorDia,
        stats.jornadaDoReclamante
      );
      const totais = {};
      reclamacoes.forEach((r) => { totais[r.dia] = r.total; });
      return { chartData: reclamacoes, tablePeriodos: periodos, tableMotivos: m, tableTotais: totais, tableJornada: j };
    }
    const totais = {};
    (stats.reclamacoesPorDia || []).forEach((r) => { totais[r.dia] = r.total; });
    return {
      chartData: stats.reclamacoesPorDia || [],
      tablePeriodos: stats.dias || [],
      tableMotivos: stats.motivosPorDia || {},
      tableTotais: totais,
      tableJornada: stats.jornadaDoReclamante || {},
    };
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
            {tablePeriodos.length > 0 && (Object.keys(tableMotivos).length > 0 || Object.keys(tableTotais).length > 0) ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border border-gray-300 dark:border-gray-600">
                  <thead>
                    <tr className="bg-gray-100 dark:bg-gray-700">
                      <th className="px-2 py-1.5 text-left border-b border-r border-gray-300 dark:border-gray-600 font-medium">Motivo</th>
                      {tablePeriodos.map((p) => (
                        <th key={p} className="px-2 py-1.5 text-center border-b border-r border-gray-300 dark:border-gray-600 font-medium whitespace-nowrap">
                          {formatarDataLabel(p, exibirPor)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(tableTotais).length > 0 && (
                      <tr className="border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 font-medium">
                        <td className="px-2 py-1.5 border-r border-gray-200 dark:border-gray-600">Total</td>
                        {tablePeriodos.map((p) => (
                          <td key={p} className="px-2 py-1.5 text-center border-r border-gray-200 dark:border-gray-600">
                            {tableTotais[p] ?? 0}
                          </td>
                        ))}
                      </tr>
                    )}
                    {Object.entries(tableMotivos).map(([motivo, counts]) => (
                      <tr key={motivo} className="border-b border-gray-200 dark:border-gray-600">
                        <td className="px-2 py-1.5 border-r border-gray-200 dark:border-gray-600">{motivo}</td>
                        {tablePeriodos.map((p) => (
                          <td key={p} className="px-2 py-1.5 text-center border-r border-gray-200 dark:border-gray-600">
                            {counts[p] ?? 0}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border border-gray-300 dark:border-gray-600">
                  <thead>
                    <tr className="bg-gray-100 dark:bg-gray-700">
                      <th className="px-2 py-1.5 text-left border-b border-r border-gray-300 dark:border-gray-600 font-medium">Jornada</th>
                      {tablePeriodos.map((p) => (
                        <th key={p} className="px-2 py-1.5 text-center border-b border-r border-gray-300 dark:border-gray-600 font-medium whitespace-nowrap">
                          {formatarDataLabel(p, exibirPor)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {getJornadaLinhas(tipo).map(({ key, label }) => (
                      <tr
                        key={key}
                        className={`border-b border-gray-200 dark:border-gray-600 ${key === 'total' ? 'bg-gray-50 dark:bg-gray-800/50 font-medium' : ''}`}
                      >
                        <td className="px-2 py-1.5 border-r border-gray-200 dark:border-gray-600">{label}</td>
                        {tablePeriodos.map((p) => (
                          <td key={p} className="px-2 py-1.5 text-center border-r border-gray-200 dark:border-gray-600">
                            {tableJornada[p]?.[key] ?? 0}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
