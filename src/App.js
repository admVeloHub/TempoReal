/**
 * Painel Reclamações Tempo Real - App
 * VERSION: v1.4.13
 *
 * v1.4.13: Aba Conciliação — tabela só via filtros globais (engrenagem); layout export/divisor na aba.
 * v1.4.12: Aba Conciliação — onFiltrosChange (período) sincroniza filtros globais + stats; rótulo "Conciliação".
 * v1.4.11: Aba "Tabela de liberação" (visibilidade restrita); filtros compartilhados com Pix: Tempo Real.
 *
 * Login obrigatório (acessos.tempoReal em qualidade_funcionarios).
 * Polling a cada 60 segundos. Filtros da home configuráveis via modal. Sessão em localStorage até logout ou expiração (4h).
 * v1.4.6: após fetch de stats, sempre atualiza estado (remove guard JSON porTipo); modal só altera filtros — um único GET via useEffect.
 * v1.4.7: stats home com AbortController + seq (cancela GET anterior); loading só encerra no término da tentativa vigente.
 * v1.4.8: filtrosHomeRef + assinatura pós-await.
 * v1.4.9: Aplicar/Limpar chama loadStats(snapshot) com cópia imutável dos filtros; useEffect não depende de filtrosHome (evita abort da requisição do clique); debug [STATS_FILTROS_HOME] em dev.
 * v1.4.10: persiste filtros home em localStorage e reidrata no boot; polling usa o último snapshot aplicado mesmo após remount/reload.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { fetchStats } from './services/api';
import { checkAuthenticationState, logout, getUserSession } from './services/auth';
import DashboardReclamacoes from './components/DashboardReclamacoes';
import AbaRA from './components/AbaRA';
import AbaAuxiliar from './components/AbaAuxiliar';
import AbaTabelaLiberacao from './components/AbaTabelaLiberacao';
import LoginPage from './components/LoginPage';
import ObservadorOctadesk from './components/ObservadorOctadesk';
import HookWebhookOctadesk from './components/HookWebhookOctadesk';
import {
  PRODUTOS,
  MOTIVOS,
  MultiSelectDropdown,
  expandProdutosFiltroParaApi,
  PRODUTO_CHAVE_GRUPO_ANTECIPACAO_2026,
} from './components/FiltrosAuxiliar';

const POLL_INTERVAL_MS = 60000;

function pathNormalized() {
  return (window.location.pathname || '/').replace(/\/$/, '') || '/';
}

function isObservadorPath() {
  return pathNormalized() === '/observador';
}

function isHookPath() {
  return pathNormalized() === '/hook';
}

/** Filtros ao abrir: grupo produto 2026 (= Antecipação - 2026 + Antecipação 2026 no $in; não inclui "Antecipação" sozinha — essa é Outros Anos); motivo Liberação chave pix; período 01/01/2026. */
const DEFAULT_FILTROS = {
  produtos: [PRODUTO_CHAVE_GRUPO_ANTECIPACAO_2026],
  motivos: ['Liberação chave pix'],
  dataInicio: '2026-01-01',
  dataFim: '',
};
const FILTROS_HOME_STORAGE_KEY = 'velohub.painelTempoReal.filtrosHome.v1';

/** Query efetiva do GET /api/stats (home) + string estável para detectar filtro obsoleto após await. */
function paramsStatsHomeDesdeFiltros(f) {
  const produtosApi = expandProdutosFiltroParaApi(f?.produtos || []);
  return {
    dataInicio: f?.dataInicio || undefined,
    dataFim: f?.dataFim || undefined,
    produtos: produtosApi.length ? produtosApi : undefined,
    motivos: f?.motivos?.length ? f.motivos : undefined,
  };
}

function assinaturaParamsStatsHome(f) {
  const p = paramsStatsHomeDesdeFiltros(f);
  return JSON.stringify({
    dataInicio: p.dataInicio ?? '',
    dataFim: p.dataFim ?? '',
    produtos: p.produtos ?? [],
    motivos: p.motivos ?? [],
  });
}

/** Cópia rasa para estado/React (arrays novos) — mesmo conteúdo que o modal envia ao Aplicar. */
function snapshotFiltrosParaEstado(f) {
  return {
    produtos: Array.isArray(f?.produtos) ? [...f.produtos] : [],
    motivos: Array.isArray(f?.motivos) ? [...f.motivos] : [],
    dataInicio: f?.dataInicio || DEFAULT_FILTROS.dataInicio,
    dataFim: f?.dataFim != null && String(f.dataFim).trim() !== '' ? String(f.dataFim).trim() : '',
  };
}

function snapshotDefaultFiltros() {
  return snapshotFiltrosParaEstado(DEFAULT_FILTROS);
}

function lerFiltrosHomePersistidos() {
  if (typeof window === 'undefined') return snapshotDefaultFiltros();
  try {
    const raw = window.localStorage.getItem(FILTROS_HOME_STORAGE_KEY);
    if (!raw) return snapshotDefaultFiltros();
    return snapshotFiltrosParaEstado(JSON.parse(raw));
  } catch (_e) {
    return snapshotDefaultFiltros();
  }
}

function persistirFiltrosHome(snap) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FILTROS_HOME_STORAGE_KEY, JSON.stringify(snapshotFiltrosParaEstado(snap)));
  } catch (_e) {
    // Não bloqueia uso dos filtros se localStorage falhar.
  }
}

const ICONE_ENGRENAGEM = (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const TABS_BASE = [
  { id: 'pix-tempo-real', label: 'Pix: Tempo Real' },
  { id: 'ra', label: 'RA' },
  { id: 'bacen', label: 'Bacen' },
  { id: 'procon', label: 'Procon' },
  { id: 'n2', label: 'N2' },
  { id: 'judicial', label: 'Judicial' },
];

const TAB_TABELA_LIBERACAO = { id: 'tabela-liberacao', label: 'Conciliação' };

/** Nomes autorizados a ver a aba Tabela de liberação (comparação sem acentos). */
function nomePainelNormalizado(n) {
  return String(n || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase();
}

const NOMES_TAB_TABELA_LIBERACAO = new Set([
  'lucas gravina',
  'emerson jose',
  'andre violaro',
].map((s) => nomePainelNormalizado(s)));

function podeVerTabelaLiberacao(userName) {
  return NOMES_TAB_TABELA_LIBERACAO.has(nomePainelNormalizado(userName));
}

function tabsParaUsuario(userName) {
  const tabs = [...TABS_BASE];
  if (podeVerTabelaLiberacao(userName)) tabs.push(TAB_TABELA_LIBERACAO);
  return tabs;
}

function ModalConfiguracoes({ filtrosHome, onAplicar, onLimpar, onFechar }) {
  const [form, setForm] = React.useState(filtrosHome);
  React.useEffect(() => {
    setForm({ ...filtrosHome });
  }, [filtrosHome]);

  const handleAplicar = () => {
    onAplicar({
      produtos: [...(form.produtos || [])],
      motivos: [...(form.motivos || [])],
      dataInicio: form.dataInicio || DEFAULT_FILTROS.dataInicio,
      dataFim: form.dataFim != null && String(form.dataFim).trim() !== '' ? String(form.dataFim).trim() : '',
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
  const [filtrosHome, setFiltrosHome] = useState(() => lerFiltrosHomePersistidos());
  const filtrosHomeRef = useRef(filtrosHome);
  filtrosHomeRef.current = filtrosHome;

  const statsRef = useRef(null);
  const statsFetchSeqRef = useRef(0);
  const statsAbortRef = useRef(null);
  const userMenuRef = useRef(null);

  const userSession = getUserSession();
  const userName = userSession?.user?.name || 'Usuário';
  const userPicture = userSession?.user?.picture;
  const tabsHeader = tabsParaUsuario(userName);

  useEffect(() => {
    checkAuthenticationState().then((ok) => {
      setIsAuthenticated(ok);
      setAuthChecking(false);
    });
  }, []);

  useEffect(() => {
    persistirFiltrosHome(filtrosHome);
  }, [filtrosHome]);

  /**
   * @param {object|undefined} filtrosSnapshot — se definido (ex.: clique em Aplicar), o GET usa só este objeto; senão lê filtrosHomeRef (montagem, polling).
   */
  const loadStats = useCallback(async (filtrosSnapshot) => {
    statsAbortRef.current?.abort();
    const ac = new AbortController();
    statsAbortRef.current = ac;
    const mySeq = ++statsFetchSeqRef.current;

    const f = filtrosSnapshot ?? filtrosHomeRef.current;
    const params = paramsStatsHomeDesdeFiltros(f);
    const filtrosAssinatura = assinaturaParamsStatsHome(f);
    const origemReq = filtrosSnapshot ? 'snapshot_modal' : 'ref_montagem_ou_poll';

    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.debug('[STATS_FILTROS_HOME] GET /api/stats', {
        origem: origemReq,
        seq: mySeq,
        params,
        assinatura: filtrosAssinatura,
      });
    }

    const isFirstLoad = statsRef.current === null;
    if (isFirstLoad) setLoading(true);
    try {
      const response = await fetchStats(params, { signal: ac.signal });
      if (mySeq !== statsFetchSeqRef.current) {
        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.debug('[STATS_FILTROS_HOME] descartado (seq obsoleta)', { mySeq, atual: statsFetchSeqRef.current });
        }
        return;
      }
      if (assinaturaParamsStatsHome(filtrosHomeRef.current) !== filtrosAssinatura) {
        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.debug('[STATS_FILTROS_HOME] descartado (filtro mudou durante o fetch)', {
            esperado: filtrosAssinatura,
            atualRef: assinaturaParamsStatsHome(filtrosHomeRef.current),
          });
        }
        return;
      }

      const newData = response?.data;
      setStats({ data: newData });
      statsRef.current = newData;
      setError(null);
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.debug('[STATS_FILTROS_HOME] aplicado ao painel', {
          assinatura: filtrosAssinatura,
          porTipoChaves: newData?.porTipo ? Object.keys(newData.porTipo) : [],
          N1_ocorrencias: newData?.porTipo?.N1?.ocorrencias,
          Total_ocorrencias: newData?.porTipo?.Total?.ocorrencias,
        });
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      if (mySeq !== statsFetchSeqRef.current) return;
      if (err.message?.includes('401') || err.message?.includes('Sessão')) {
        logout();
        return;
      }
      setError(err.message);
    } finally {
      if (isFirstLoad && mySeq === statsFetchSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadStats();
    return () => {
      statsAbortRef.current?.abort();
    };
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
    if (!podeVerTabelaLiberacao(userName) && activeTab === 'tabela-liberacao') {
      setActiveTab('pix-tempo-real');
    }
  }, [userName, activeTab]);

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

  if (isHookPath()) {
    return <HookWebhookOctadesk userName={userName} userPicture={userPicture} />;
  }

  if (isObservadorPath()) {
    return (
      <ObservadorOctadesk userName={userName} userPicture={userPicture} />
    );
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-gray-100 dark:bg-gray-900 flex flex-col">
      <header className="w-full bg-white dark:bg-gray-800 shadow py-2 px-4 shrink-0">
        <div className="flex gap-0.5 justify-center items-center relative">
          {(activeTab === 'pix-tempo-real' || activeTab === 'tabela-liberacao') && (
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
          {tabsHeader.map((tab) => (
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
                </div>
                <a
                  href="/observador"
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  onClick={() => setUserMenuAberto(false)}
                >
                  Observador Octadesk
                </a>
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
        ) : activeTab === 'bacen' || activeTab === 'procon' || activeTab === 'n2' || activeTab === 'judicial' ? (
          <AbaAuxiliar tipo={activeTab} refreshTrigger={refreshTrigger} />
        ) : activeTab === 'tabela-liberacao' ? (
          <AbaTabelaLiberacao filtrosHome={filtrosHome} refreshTrigger={refreshTrigger} activeTab={activeTab} />
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
            const snap = snapshotFiltrosParaEstado(novosFiltros);
            filtrosHomeRef.current = snap;
            persistirFiltrosHome(snap);
            setFiltrosHome(snap);
            setModalAberto(false);
            loadStats(snap);
          }}
          onLimpar={() => {
            const snap = snapshotDefaultFiltros();
            filtrosHomeRef.current = snap;
            persistirFiltrosHome(snap);
            setFiltrosHome(snap);
            setModalAberto(false);
            loadStats(snap);
          }}
          onFechar={() => setModalAberto(false)}
        />
      )}
    </div>
  );
}

export default App;
