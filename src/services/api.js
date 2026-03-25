/**
 * Painel Reclamações Tempo Real - API Service
 * VERSION: v1.3.2
 *
 * Filtro de data: backend usa por coleção (LISTA_SCHEMAS.rb)
 * Bacen: dataEntrada | N2: dataEntradaN2 | Reclame Aqui: dataReclam | Procon: dataProcon | N1: dataEntradaN1
 */

import { API_BASE_URL } from '../config';
import { getSessionId } from './auth';

function getAuthHeaders() {
  const sessionId = getSessionId();
  const headers = {};
  if (sessionId) headers['x-session-id'] = sessionId;
  return headers;
}

export async function fetchStats(params = {}) {
  const qs = new URLSearchParams();
  if (params.dataInicio) qs.set('dataInicio', params.dataInicio);
  if (params.dataFim) qs.set('dataFim', params.dataFim);
  if (params.produtos?.length) qs.set('produto', params.produtos.join(','));
  if (params.motivos?.length) qs.set('motivo', params.motivos.join(','));
  const url = `${API_BASE_URL}/api/stats${qs.toString() ? '?' + qs.toString() : ''}`;
  console.log('[STATS_REQUEST]', {
    params,
    url,
    camposDataBackend: { Bacen: 'dataEntrada', N2: 'dataEntradaN2', ReclameAqui: 'dataReclam', Procon: 'dataProcon', N1: 'dataEntradaN1' },
  });
  const response = await fetch(url, { headers: getAuthHeaders() });
  if (!response.ok) {
    throw new Error(`Erro ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Erro ao buscar estatísticas');
  }
  console.log('[STATS_RESPONSE]', { porTipo: data?.data?.porTipo });
  return data;
}

export async function fetchStatsRA(params = {}) {
  const qs = new URLSearchParams();
  if (params.dataInicio) qs.set('dataInicio', params.dataInicio);
  if (params.dataFim) qs.set('dataFim', params.dataFim);
  if (params.produtos && params.produtos.length > 0) {
    params.produtos.forEach((p) => qs.append('produto', p));
  }
  if (params.motivos && params.motivos.length > 0) {
    params.motivos.forEach((m) => qs.append('motivo', m));
  }
  const url = `${API_BASE_URL}/api/stats/ra${qs.toString() ? '?' + qs.toString() : ''}`;
  const response = await fetch(url, { headers: getAuthHeaders() });
  if (!response.ok) {
    throw new Error(`Erro ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Erro ao buscar estatísticas RA');
  }
  return data;
}

export async function fetchStatsAuxiliar(tipo, params = {}) {
  const qs = new URLSearchParams();
  if (params.dataInicio) qs.set('dataInicio', params.dataInicio);
  if (params.dataFim) qs.set('dataFim', params.dataFim);
  if (params.produtos && params.produtos.length > 0) {
    params.produtos.forEach((p) => qs.append('produto', p));
  }
  if (params.motivos && params.motivos.length > 0) {
    params.motivos.forEach((m) => qs.append('motivo', m));
  }
  const url = `${API_BASE_URL}/api/stats/${tipo}${qs.toString() ? '?' + qs.toString() : ''}`;
  const response = await fetch(url, { headers: getAuthHeaders() });
  if (!response.ok) {
    throw new Error(`Erro ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || `Erro ao buscar estatísticas ${tipo}`);
  }
  return data;
}

export async function fetchOctadeskIngestLogs(limit = 100, { includePayload = false } = {}) {
  const qs = new URLSearchParams();
  qs.set('limit', String(limit));
  if (includePayload) qs.set('includePayload', '1');
  const url = `${API_BASE_URL}/api/integrations/octadesk/logs?${qs.toString()}`;
  const response = await fetch(url, {
    headers: getAuthHeaders(),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Erro ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Erro ao buscar logs Octadesk');
  }
  return data;
}
