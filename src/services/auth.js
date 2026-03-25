/**
 * Auth Service - Painel Tempo Real
 * VERSION: v1.0.1
 *
 * Não chamar logout em beforeunload/pagehide: recarregar ou navegar (/observador) perderia sessionId
 * e a revalidação na API poderia falhar, apagando o usuário do localStorage.
 */

import { GOOGLE_CONFIG } from '../config/google-config';
import { API_BASE_URL } from '../config';

const USER_SESSION_KEY = GOOGLE_CONFIG.SESSION_KEY;
const SESSION_ID_KEY = 'painel_tempo_real_session_id';
const SESSION_DURATION = GOOGLE_CONFIG.SESSION_DURATION;

export function saveUserSession(userData, sessionId) {
  const sessionData = {
    user: userData,
    loginTimestamp: Date.now(),
  };
  localStorage.setItem(USER_SESSION_KEY, JSON.stringify(sessionData));
  if (sessionId) {
    localStorage.setItem(SESSION_ID_KEY, sessionId);
  }
}

export function getUserSession() {
  const data = localStorage.getItem(USER_SESSION_KEY);
  return data ? JSON.parse(data) : null;
}

export function getSessionId() {
  return localStorage.getItem(SESSION_ID_KEY);
}

export function isSessionValid() {
  const session = getUserSession();
  if (!session?.loginTimestamp) return false;
  return Date.now() - session.loginTimestamp < SESSION_DURATION;
}

export function decodeJWT(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Erro ao decodificar JWT:', error);
    return null;
  }
}

export async function registerLoginSession(userData, maxRetries = 3) {
  const existing = localStorage.getItem(SESSION_ID_KEY);
  if (existing?.trim()) return existing;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/session/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          colaboradorNome: userData.name,
          userEmail: userData.email,
        }),
      });
      const result = await res.json();
      if (result.success && result.sessionId) {
        localStorage.setItem(SESSION_ID_KEY, result.sessionId);
        startHeartbeat();
        return result.sessionId;
      }
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw new Error('Erro ao registrar sessão');
}

let heartbeatInterval = null;

async function sendHeartbeat() {
  const sessionId = getSessionId();
  if (!sessionId) return;
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/session/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const result = await res.json();
    if (result.expired) {
      stopHeartbeat();
      logout();
    }
  } catch (err) {
    if (!err.message?.includes('Failed to fetch')) console.error('Heartbeat error:', err);
  }
}

function startHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(sendHeartbeat, 30000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

export async function reactivateSession() {
  const session = getUserSession();
  if (!session?.user?.email) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/session/reactivate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail: session.user.email }),
    });
    const result = await res.json();
    if (result.expired) {
      logout();
      return false;
    }
    if (result.success && result.sessionId) {
      localStorage.setItem(SESSION_ID_KEY, result.sessionId);
      return true;
    }
  } catch (err) {
    return false;
  }
  return false;
}

async function registerLogout() {
  const sessionId = getSessionId();
  if (!sessionId) return;
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        `${API_BASE_URL}/api/auth/session/logout`,
        new Blob([JSON.stringify({ sessionId })], { type: 'application/json' })
      );
    } else {
      await fetch(`${API_BASE_URL}/api/auth/session/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    }
  } catch (err) {}
  localStorage.removeItem(SESSION_ID_KEY);
}

export function logout() {
  stopHeartbeat();
  registerLogout();
  localStorage.removeItem(USER_SESSION_KEY);
  window.location.reload();
}

export async function checkAuthenticationState() {
  if (!isSessionValid()) {
    localStorage.removeItem(USER_SESSION_KEY);
    localStorage.removeItem(SESSION_ID_KEY);
    return false;
  }
  let sessionId = getSessionId();
  if (!sessionId) {
    const session = getUserSession();
    if (session?.user) {
      const reactivated = await reactivateSession();
      if (reactivated) sessionId = getSessionId();
      else {
        const newId = await registerLoginSession(session.user);
        if (newId) sessionId = newId;
      }
    }
  }
  if (!sessionId) {
    localStorage.removeItem(USER_SESSION_KEY);
    localStorage.removeItem(SESSION_ID_KEY);
    return false;
  }
  startHeartbeat();
  return true;
}
