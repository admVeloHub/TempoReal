/**
 * Painel Reclamações Tempo Real - API Service
 * VERSION: v1.2.0
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
  const response = await fetch(url, { headers: getAuthHeaders() });
  if (!response.ok) {
    throw new Error(`Erro ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Erro ao buscar estatísticas');
  }
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
