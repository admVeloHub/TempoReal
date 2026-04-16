/**
 * Painel Reclamações Tempo Real - API Service
 * VERSION: v1.4.15
 *
 * v1.4.15: downloadConciliacaoTabelaExcel, downloadRelatorioOuvidoriaBaseExcel (GET export + relatorio base).
 * v1.4.14: tabela-liberacao — porDia.liberados (pixLiberado), não retirados.
 * v1.4.13: fetchStatsTabelaLiberacao — GET /api/stats/tabela-liberacao (mesmos query params que fetchStats).
 * v1.4.10: fetchStats aceita options.signal (AbortController) para cancelar GET obsoleto.
 * v1.4.11: GET /api/stats com cache: 'no-store' (evita resposta HTTP em cache entre mudanças de filtro).
 * v1.4.12: documentação alinhada ao backend v1.21.4 (filtro de data por dia ISO literal em UTC).
 *
 * Filtro de data: query YYYY-MM-DD; backend interpreta início/fim do dia ISO literal em UTC (horário local ignorado).
 * Campos por coleção (LISTA_SCHEMAS.rb): Bacen dataEntrada | N2 dataEntradaN2 | RA dataReclam | Procon dataProcon | porTipo.N1 (Time Portabilidade) dataEntrada
 * produto/motivo: query params para Bacen/RA/N2/Procon e Time Portabilidade (mesma semântica das ouvidorias).
 */

import { API_BASE_URL } from '../config';
import { getSessionId } from './auth';

function getAuthHeaders() {
  const sessionId = getSessionId();
  const headers = {};
  if (sessionId) headers['x-session-id'] = sessionId;
  return headers;
}

export async function fetchStats(params = {}, options = {}) {
  const qs = new URLSearchParams();
  if (params.dataInicio) qs.set('dataInicio', params.dataInicio);
  if (params.dataFim) qs.set('dataFim', params.dataFim);
  if (params.produtos?.length) qs.set('produto', params.produtos.join(','));
  if (params.motivos?.length) qs.set('motivo', params.motivos.join(','));
  const url = `${API_BASE_URL}/api/stats${qs.toString() ? '?' + qs.toString() : ''}`;
  console.log('[STATS_REQUEST]', {
    params,
    url,
    camposDataBackend: {
      Bacen: 'dataEntrada',
      N2: 'dataEntradaN2',
      ReclameAqui: 'dataReclam',
      Procon: 'dataProcon',
      TimePortabilidade_porTipoN1: 'dataEntrada',
      motivoTodos: 'motivoReduzido',
    },
  });
  const fetchOpts = { headers: getAuthHeaders(), cache: 'no-store' };
  if (options.signal) fetchOpts.signal = options.signal;
  const response = await fetch(url, fetchOpts);
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

export async function fetchStatsTabelaLiberacao(params = {}, options = {}) {
  const qs = new URLSearchParams();
  if (params.dataInicio) qs.set('dataInicio', params.dataInicio);
  if (params.dataFim) qs.set('dataFim', params.dataFim);
  if (params.produtos?.length) qs.set('produto', params.produtos.join(','));
  if (params.motivos?.length) qs.set('motivo', params.motivos.join(','));
  const url = `${API_BASE_URL}/api/stats/tabela-liberacao${qs.toString() ? '?' + qs.toString() : ''}`;
  const fetchOpts = { headers: getAuthHeaders(), cache: 'no-store' };
  if (options.signal) fetchOpts.signal = options.signal;
  const response = await fetch(url, fetchOpts);
  if (!response.ok) {
    throw new Error(`Erro ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Erro ao buscar tabela de liberação');
  }
  return data;
}

function buildStatsQueryString(params) {
  const qs = new URLSearchParams();
  if (params.dataInicio) qs.set('dataInicio', params.dataInicio);
  if (params.dataFim) qs.set('dataFim', params.dataFim);
  if (params.produtos?.length) qs.set('produto', params.produtos.join(','));
  if (params.motivos?.length) qs.set('motivo', params.motivos.join(','));
  return qs.toString();
}

async function downloadExcelGet(pathWithQuery, defaultFilename) {
  const url = `${API_BASE_URL}${pathWithQuery}`;
  const response = await fetch(url, { headers: getAuthHeaders(), cache: 'no-store' });
  if (!response.ok) {
    const txt = await response.text();
    let msg = `Erro ${response.status}`;
    try {
      const j = JSON.parse(txt);
      if (j.message) msg = j.message;
    } catch (_e) {
      if (txt) msg = txt.slice(0, 240);
    }
    throw new Error(msg);
  }
  const cd = response.headers.get('Content-Disposition');
  let filename = defaultFilename;
  const m = cd && /filename="([^"]+)"/i.exec(cd);
  if (m) filename = m[1].trim();
  const blob = await response.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename || defaultFilename;
  a.click();
  URL.revokeObjectURL(objUrl);
}

/** Excel da tabela de conciliação (mesma query que fetchStats / tabela-liberacao). */
export async function downloadConciliacaoTabelaExcel(params = {}) {
  const qs = buildStatsQueryString(params);
  await downloadExcelGet(`/api/stats/tabela-liberacao/export${qs ? `?${qs}` : ''}`, 'conciliacao_pix.xlsx');
}

/** Base ouvidoria (5 abas + timePortabilidade), paridade com script relatorioOuvidoria4AbasTotaisExcel + Time Port. */
export async function downloadRelatorioOuvidoriaBaseExcel(params = {}) {
  const qs = buildStatsQueryString(params);
  await downloadExcelGet(`/api/stats/relatorio-ouvidoria-base${qs ? `?${qs}` : ''}`, 'relatorio_ouvidoria_base.xlsx');
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
