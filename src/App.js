/**
 * Painel Reclamações Tempo Real - App
 * VERSION: v1.2.2
 *
 * Login obrigatório (acessos.tempoReal em qualidade_funcionarios).
 * Polling a cada 60 segundos. Filtros da home configuráveis via modal.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { fetchStats } from './services/api';
import { checkAuthenticationState, logout, getUserSession } from './services/auth';
import DashboardReclamacoes from './components/DashboardReclamacoes';
import AbaRA from './components/AbaRA';
import AbaAuxiliar from './components/AbaAuxiliar';
import LoginPage from './components/LoginPage';
import { PRODUTOS, MOTIVOS, MultiSelectDropdown } from './components/FiltrosAuxiliar';

const POLL_INTERVAL_MS = 60000;
const STORAGE_KEY_FILTROS = 'painel-filtros-home';

const DEFAULT_FILTROS = {
  produtos: [],
  motivos: [],
  dataInicio: '2026-01-01',
  dataFim: '',
};

const ICONE_ENGRENAGEM = (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const TABS = [
  { id: 'pix-tempo-real', label: 'Pix: Tempo Real' },
  { id: 'ra', label: 'RA' },
  { id: 'bacen', label: 'Bacen' },
  { id: 'procon', label: 'Procon' },
  { id: 'n2', label: 'N2' },
];

function ModalConfiguracoes({ filtrosHome, onAplicar, onLimpar, onFechar }) {
  const [form, setForm] = React.useState(filtrosHome);
  React.useEffect(() => {
    setForm({ ...filtrosHome });
  }, [filtrosHome]);

  const handleAplicar = () => {
    onAplicar({
      produtos: form.produtos || [],
      motivos: form.motivos || [],
      dataInicio: form.dataInicio || DEFAULT_FILTROS.dataInicio,
      dataFim: form.dataFim || '',
    });
  };

  const handleLimpar = () => {
    onLimpar();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onFechar}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-titulo"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="modal-titulo" className="text-lg font-semibold text-gray-800 dark:text-gray-200">
            Configurações
          </h2>
          <button
            type="button"
            onClick={onFechar}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-2xl leading-none"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Data Início
            </label>
            <input
              type="date"
              value={form.dataInicio || ''}
              onChange={(e) => setForm((f) => ({ ...f, dataInicio: e.target.value }))}
              className="w-full px-2 py-1.5 text-sm border rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Data Fim
            </label>
            <input
              type="date"
              value={form.dataFim || ''}
              onChange={(e) => setForm((f) => ({ ...f, dataFim: e.target.value }))}
              className="w-full px-2 py-1.5 text-sm border rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Produto
            </label>
            <MultiSelectDropdown
              options={PRODUTOS}
              selected={form.produtos || []}
              onChange={(produtos) => setForm((f) => ({ ...f, produtos }))}
              placeholder="Todos"
              getLabel={(v) => PRODUTOS.find((p) => p.value === v)?.label || v}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Motivo
            </label>
            <MultiSelectDropdown
              options={MOTIVOS}
              selected={form.motivos || []}
              onChange={(motivos) => setForm((f) => ({ ...f, motivos }))}
              placeholder="Todos"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            type="button"
            onClick={handleAplicar}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ backgroundColor: '#1634FF' }}
          >
            Aplicar
          </button>
          <button
            type="button"
            onClick={handleLimpar}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600"
          >
            Limpar
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [authChecking, setAuthChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('pix-tempo-real');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [modalAberto, setModalAberto] = useState(false);
  const [userMenuAberto, setUserMenuAberto] = useState(false);
  const [filtrosHome, setFiltrosHome] = useState(DEFAULT_FILTROS);
  const statsRef = useRef(null);
  const userMenuRef = useRef(null);

  const userSession = getUserSession();
  const userName = userSession?.user?.name || 'Usuário';
  const userPicture = userSession?.user?.picture;

  useEffect(() => {
    checkAuthenticationState().then((ok) => {
      setIsAuthenticated(ok);
      setAuthChecking(false);
    });
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_FILTROS);
      if (stored) {
        const parsed = JSON.parse(stored);
        setFiltrosHome((prev) => ({
          ...prev,
          produtos: Array.isArray(parsed.produtos) ? parsed.produtos : DEFAULT_FILTROS.produtos,
          motivos: Array.isArray(parsed.motivos) ? parsed.motivos : DEFAULT_FILTROS.motivos,
          dataInicio: parsed.dataInicio || DEFAULT_FILTROS.dataInicio,
          dataFim: parsed.dataFim ?? DEFAULT_FILTROS.dataFim,
        }));
      }
    } catch (_) {}
  }, []);

  const loadStats = useCallback(async (overrideFiltros) => {
    const f = overrideFiltros ?? filtrosHome;
    const params = {
      dataInicio: f.dataInicio || undefined,
      dataFim: f.dataFim || undefined,
      produtos: f.produtos?.length ? f.produtos : undefined,
      motivos: f.motivos?.length ? f.motivos : undefined,
    };
    const isFirstLoad = statsRef.current === null;
    if (isFirstLoad) setLoading(true);
    try {
      const response = await fetchStats(params);
      const newData = response?.data;
      const newPorTipo = newData?.porTipo || {};

      const currentPorTipo = statsRef.current?.porTipo || {};
      const dataChanged = JSON.stringify(currentPorTipo) !== JSON.stringify(newPorTipo);

      if (dataChanged) {
        setStats({ data: newData });
        statsRef.current = newData;
      }
      setError(null);
    } catch (err) {
      if (err.message?.includes('401') || err.message?.includes('Sessão')) {
        logout();
        return;
      }
      setError(err.message);
    } finally {
      if (isFirstLoad) setLoading(false);
    }
  }, [filtrosHome]);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadStats();
  }, [loadStats, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => loadStats(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadStats, isAuthenticated]);

  useEffect(() => {
    if (!modalAberto) return;
    const h = (e) => { if (e.key === 'Escape') setModalAberto(false); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [modalAberto]);

  useEffect(() => {
    const h = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuAberto(false);
      }
    };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, []);

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="text-gray-600 dark:text-gray-400">Carregando...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage onLoginSuccess={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-gray-100 dark:bg-gray-900 flex flex-col">
      <header className="w-full bg-white dark:bg-gray-800 shadow py-2 px-4 shrink-0">
        <div className="flex gap-0.5 justify-center items-center relative">
          {activeTab === 'pix-tempo-real' && (
            <button
              type="button"
              onClick={() => setModalAberto(true)}
              className="absolute left-3 w-8 h-8 rounded-md flex items-center justify-center transition-colors hover:opacity-90"
              style={{ backgroundColor: '#1634FF', color: '#fff' }}
              aria-label="Configurações"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          )}
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={{
                backgroundColor: activeTab === tab.id ? '#1634FF' : 'transparent',
                color: activeTab === tab.id ? '#fff' : '#1634FF',
              }}
            >
              {tab.label}
            </button>
          ))}
          <div ref={userMenuRef} className="absolute right-3">
            <button
              type="button"
              onClick={() => setUserMenuAberto((o) => !o)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-expanded={userMenuAberto}
              aria-haspopup="true"
            >
              {userPicture ? (
                <img
                  src={userPicture}
                  alt=""
                  className="w-6 h-6 rounded-full object-cover border-2"
                  style={{ borderColor: '#1634FF' }}
                />
              ) : (
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold"
                  style={{ backgroundColor: '#1634FF' }}
                >
                  {userName.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="max-w-[120px] truncate hidden sm:inline">{userName}</span>
              <span className="text-gray-500">{userMenuAberto ? '▲' : '▼'}</span>
            </button>
            {userMenuAberto && (
              <div className="absolute right-0 mt-1 py-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 z-50">
                <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-600">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{userName}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{userSession?.user?.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuAberto(false);
                    logout();
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sair
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col w-full overflow-auto" style={{ paddingLeft: '24px', paddingRight: '24px' }}>
        {error && (
          <div className="mx-4 mt-4 p-4 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg">
            {error}
          </div>
        )}
        {activeTab === 'ra' ? (
          <AbaRA refreshTrigger={refreshTrigger} />
        ) : activeTab === 'bacen' || activeTab === 'procon' || activeTab === 'n2' ? (
          <AbaAuxiliar tipo={activeTab} refreshTrigger={refreshTrigger} />
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <DashboardReclamacoes stats={stats} loading={loading} activeTab={activeTab} filtrosHome={filtrosHome} />
          </div>
        )}
      </main>

      {modalAberto && (
        <ModalConfiguracoes
          filtrosHome={filtrosHome}
          onAplicar={(novosFiltros) => {
            setFiltrosHome(novosFiltros);
            try {
              localStorage.setItem(STORAGE_KEY_FILTROS, JSON.stringify(novosFiltros));
            } catch (_) {}
            setModalAberto(false);
            loadStats(novosFiltros);
          }}
          onLimpar={() => {
            setFiltrosHome(DEFAULT_FILTROS);
            try {
              localStorage.setItem(STORAGE_KEY_FILTROS, JSON.stringify(DEFAULT_FILTROS));
            } catch (_) {}
            setModalAberto(false);
            loadStats(DEFAULT_FILTROS);
          }}
          onFechar={() => setModalAberto(false)}
        />
      )}
    </div>
  );
}

export default App;
