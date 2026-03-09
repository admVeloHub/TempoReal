/**
 * Config Google OAuth - Painel Tempo Real
 * VERSION: v1.0.0
 */

export const GOOGLE_CONFIG = {
  CLIENT_ID: process.env.REACT_APP_GOOGLE_CLIENT_ID || '278491073220-eb4ogvn3aifu0ut9mq3rvu5r9r9l3137.apps.googleusercontent.com',
  AUTHORIZED_DOMAIN: process.env.REACT_APP_AUTHORIZED_DOMAIN || 'velotax.com.br',
  SESSION_DURATION: 4 * 60 * 60 * 1000,
  SESSION_KEY: 'painel_tempo_real_session',
};

export function getClientId() {
  return GOOGLE_CONFIG.CLIENT_ID;
}
