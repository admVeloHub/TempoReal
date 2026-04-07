/**
 * Painel Reclamações Tempo Real - Config
 * VERSION: v1.2.0
 *
 * Desenvolvimento (npm start): por defeito a API é o backend local (server.js porta 5050).
 * REACT_APP_API_URL sozinha não redireciona o painel para Cloud Run — evita /api/stats antigo sem querer.
 * Para usar a API de produção no browser local: REACT_APP_USE_PRODUCTION_API=1 e REACT_APP_API_URL=<base Cloud Run>.
 *
 * Produção (npm run build): REACT_APP_API_URL ou '' (same-origin).
 */

function trimBase(u) {
  if (u == null || String(u).trim() === '') return '';
  return String(u).replace(/\/$/, '');
}

const isProd = process.env.NODE_ENV === 'production';
const useRemoteInDev =
  !isProd && process.env.REACT_APP_USE_PRODUCTION_API === '1';

export const API_BASE_URL = isProd
  ? trimBase(process.env.REACT_APP_API_URL) || ''
  : useRemoteInDev
    ? trimBase(process.env.REACT_APP_API_URL) || 'http://localhost:5050'
    : trimBase(process.env.REACT_APP_API_URL_LOCAL) || 'http://localhost:5050';
