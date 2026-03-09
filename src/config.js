/**
 * Painel Reclamações Tempo Real - Config
 * VERSION: v1.1.0
 */

export const API_BASE_URL = process.env.REACT_APP_API_URL ?? (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5050');
