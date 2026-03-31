/**
 * LoginPage - Painel Tempo Real
 * VERSION: v1.0.9
 * Tela de login com email/senha e Google OAuth.
 */

import React, { useState, useEffect, useRef } from 'react';
import { saveUserSession, decodeJWT, getSessionId, registerLoginSession } from '../services/auth';
import { getClientId } from '../config/google-config';
import { API_BASE_URL } from '../config';

/** Aumente ao substituir `public/login background.png` para forçar o navegador a baixar o arquivo novo (cache). */
const LOGIN_BACKGROUND_ASSET_REVISION = '202603312';

const GoogleIcon = ({ className = 'h-5 w-5' }) => (
  <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

function loadGsiClientScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    let script = document.querySelector(`script[src="${GSI_SCRIPT_SRC}"]`);
    const onLoad = () => resolve();
    const onErr = () => reject(new Error('Falha ao carregar Google Sign-In'));
    if (!script) {
      script = document.createElement('script');
      script.src = GSI_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onErr, { once: true });
    if (window.google?.accounts?.id) {
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onErr);
      resolve();
    }
  });
}

const LoginPage = ({ onLoginSuccess }) => {
  const [formAberto, setFormAberto] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const credentialHandlerRef = useRef(null);

  useEffect(() => {
    let alive = true;
    loadGsiClientScript()
      .then(() => {
        if (!alive) return;
        const clientId = getClientId();
        if (!clientId || !window.google?.accounts?.id) return;
        if (window.__velohubPainelGsiInited) return;
        window.__velohubPainelGsiInited = true;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            const fn = credentialHandlerRef.current;
            if (fn) fn(response);
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!formAberto) return;
    const clientId = getClientId();
    if (!clientId || !window.google?.accounts?.id) return;

    const renderGoogleButton = () => {
      const btn = document.getElementById('google-signin-button');
      if (btn && window.google.accounts.id) {
        btn.innerHTML = '';
        const width = Math.min(400, Math.max(240, btn.offsetWidth || 320));
        window.google.accounts.id.renderButton(btn, {
          theme: 'outline',
          size: 'large',
          width,
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'center',
        });
        return true;
      }
      return false;
    };

    let retryId = null;
    const id = setTimeout(() => {
      if (!renderGoogleButton()) {
        retryId = setInterval(() => {
          if (renderGoogleButton()) {
            clearInterval(retryId);
            retryId = null;
          }
        }, 100);
      }
    }, 150);
    return () => {
      clearTimeout(id);
      if (retryId) clearInterval(retryId);
    };
  }, [formAberto]);

  const handleCredentialResponse = async (response) => {
    setIsLoading(true);
    setError('');
    try {
      const payload = decodeJWT(response.credential);
      if (!payload?.email) {
        setError('Erro ao processar dados do Google.');
        return;
      }
      const res = await fetch(`${API_BASE_URL}/api/auth/validate-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: payload.email, picture: payload.picture || null }),
      });
      const raw = await res.text();
      let result = {};
      try {
        result = raw ? JSON.parse(raw) : {};
      } catch {
        setError(
          res.status >= 500
            ? 'Erro no servidor ou resposta inválida. Tente novamente ou use login por e-mail e senha.'
            : 'Resposta inválida do servidor.'
        );
        return;
      }
      if (!result.success) {
        setError(result.error || `Erro ao validar acesso (${res.status})`);
        return;
      }
      const userData = {
        name: result.user?.name || payload.name,
        email: result.user?.email || payload.email,
        picture: result.user?.picture || payload.picture || null,
      };
      saveUserSession(userData);
      let sessionId = getSessionId();
      if (!sessionId) sessionId = await registerLoginSession(userData);
      saveUserSession(userData, sessionId);
      onLoginSuccess(userData);
    } catch (err) {
      setError('Erro ao processar login. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  credentialHandlerRef.current = handleCredentialResponse;

  const handleEmailPasswordLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const raw = await res.text();
      let result = {};
      try {
        result = raw ? JSON.parse(raw) : {};
      } catch {
        setError(
          res.status >= 500
            ? 'Erro no servidor ou resposta inválida. Tente novamente ou contate o suporte.'
            : 'Resposta inválida do servidor.'
        );
        return;
      }
      if (!result.success) {
        setError(result.error || 'Email ou senha incorretos');
        return;
      }
      const userData = result.user;
      let sessionId = result.sessionId;
      if (!sessionId) sessionId = await registerLoginSession(userData);
      saveUserSession(userData, sessionId);
      onLoginSuccess(userData);
    } catch (err) {
      setError('Erro ao processar login. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const loginBackgroundStyle = {
    backgroundImage: `url(/login%20background.png?v=${LOGIN_BACKGROUND_ASSET_REVISION})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center center',
    backgroundRepeat: 'no-repeat',
    /* Tom escuro da marca: evita “barras” claras nas laterais se houver qualquer folga. */
    backgroundColor: '#000058',
  };

  return (
    <div className="relative w-full min-h-screen overflow-x-hidden">
      <div
        className="fixed inset-0 z-0"
        style={loginBackgroundStyle}
        aria-hidden
      />
      <div className="relative z-10 flex min-h-screen w-full flex-col items-center justify-end pb-12">
      {!formAberto ? (
        <button
          type="button"
          onClick={() => setFormAberto(true)}
          className="focus:outline-none focus:ring-2 focus:ring-offset-2 rounded-lg transition-transform hover:scale-105 active:scale-95"
          aria-label="Acessar login"
        >
          <img src="/botão.png" alt="Acessar" className="h-auto w-auto max-h-20 md:max-h-24" />
        </button>
      ) : (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 p-4">
          <div className="max-w-md w-full">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 relative">
              <button
                type="button"
                onClick={() => { setFormAberto(false); setError(''); }}
                className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-2xl leading-none"
                aria-label="Fechar"
              >
                ×
              </button>
          <form onSubmit={handleEmailPasswordLogin} className="mb-6">
            <div className="mb-4">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
                autoComplete="email"
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white disabled:opacity-50"
                placeholder="seu.email@velotax.com.br"
              />
            </div>
            <div className="mb-6">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Senha
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isLoading}
                  autoComplete="current-password"
                  className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white disabled:opacity-50"
                  placeholder="Digite sua senha"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isLoading}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.29 3.29m0 0A9.97 9.97 0 015.12 5.12m3.07 3.07L12 12" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div className="flex justify-start">
              <button
                type="submit"
                disabled={isLoading}
                className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                style={{ backgroundColor: '#1634FF' }}
              >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                  Entrando...
                </span>
              ) : (
                'Entrar'
              )}
              </button>
            </div>
          </form>

          {getClientId() ? (
            <>
              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300 dark:border-gray-600" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white dark:bg-gray-800 text-gray-500">ou</span>
                </div>
              </div>
              <div id="google-signin-button" className="w-full flex justify-center min-h-[40px]" />
            </>
          ) : null}

          {error && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-red-600 dark:text-red-400 text-sm text-center">{error}</p>
            </div>
          )}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default LoginPage;
