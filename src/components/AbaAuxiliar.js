/**
 * Painel Reclamações Tempo Real - AbaAuxiliar
 * VERSION: v1.0.5
 *
 * Aba auxiliar (Bacen, Procon, N2, Judicial) com seção de filtros.
 * Mesmas tabelas e gráficos que AbaRA.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { fetchStatsAuxiliar } from '../services/api';
import FiltrosAuxiliar from './FiltrosAuxiliar';
import ConteudoAuxiliar from './ConteudoAuxiliar';

function AbaAuxiliar({ tipo, refreshTrigger = 0 }) {
  const [dataInicio, setDataInicio] = useState('2026-01-01');
  const [dataFim, setDataFim] = useState('');
  const [produtos, setProdutos] = useState([]);
  const [motivos, setMotivos] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (dataInicio) params.dataInicio = dataInicio;
      if (dataFim) params.dataFim = dataFim;
      if (produtos.length > 0) params.produtos = produtos;
      if (motivos.length > 0) params.motivos = motivos;
      const res = await fetchStatsAuxiliar(tipo, params);
      setStats(res.data);
    } catch (err) {
      setError(err.message);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [dataInicio, dataFim, produtos, motivos, tipo]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  return (
    <div className="w-full max-w-full py-4">
      <FiltrosAuxiliar
        dataInicio={dataInicio}
        setDataInicio={setDataInicio}
        dataFim={dataFim}
        setDataFim={setDataFim}
        produtos={produtos}
        setProdutos={setProdutos}
        motivos={motivos}
        setMotivos={setMotivos}
        onAtualizar={loadData}
        loading={loading}
      />
      {error && (
        <div className="mb-4 p-4 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-sm">
          {error}
        </div>
      )}
      {loading && (
        <div className="py-8 text-center text-gray-600 dark:text-gray-400 text-sm">
          Carregando...
        </div>
      )}
      {!loading && stats && <ConteudoAuxiliar stats={stats} apenasTotal={tipo === 'bacen' || tipo === 'n2'} tipo={tipo} />}
    </div>
  );
}

export default AbaAuxiliar;
