# Deploy Log - Painel Tempo Real

## GitHub Push

**Data/Hora:** 2025-03-05  
**Tipo:** Push GitHub  
**Versão:** 1.0.0  
**Repositório:** https://github.com/admVeloHub/TempoReal
**Branch:** main

### Arquivos modificados / incluídos
- Projeto completo (inicialização do repositório)
- `src/components/LoginPage.js` (v1.0.5) - login com modal, auth, botão Google, autocomplete, ajustes de layout
- `src/config/google-config.js` - configuração OAuth Google
- `src/config.js` - API_BASE_URL
- `backend/` - rotas auth, stats, session
- Demais arquivos do projeto

### Descrição
Push inicial do Painel Reclamações Tempo Real para o repositório admVeloHub/TempoReal. Inclui sistema de login (email/senha e Google OAuth), filtros dinâmicos, dashboard de reclamações em tempo real e proteção de rotas por sessão.

---

## Branch realtime-api (deploy backend separado)

**Data/Hora:** 2025-03-05  
**Branch:** realtime-api  

Backend na raiz para deploy separado no Vercel. Ver branch `realtime-api` no repositório.

---

## Cloud Run - Docker

**Data/Hora:** 2025-03-09  
**Branch:** main  

Backend com Docker para deploy no GCP Cloud Run. Projeto unificado em main (frontend + backend). `backend/Dockerfile`, `backend/.dockerignore`, `cloudbuild.yaml` (raiz). uuid v13 com dynamic import. Deploy (na raiz): `gcloud builds submit --config=cloudbuild.yaml .`

---

## GitHub Push

**Data/Hora:** 2026-03-05  
**Tipo:** Push GitHub  
**Versão:** 1.7.1  
**Repositório:** https://github.com/admVeloHub/TempoReal
**Branch:** main

### Arquivos modificados / incluídos
- `backend/routes/stats.js` (v1.7.1) - motivoReduzido como array, match exato "Liberação Chave Pix", Pix Liberado/Retido/% Retenção conforme regras, log pixLiberadoNoPeriodo
- `src/components/DashboardReclamacoes.js` (v1.0.16) - comentário campos data
- `src/services/api.js` (v1.2.2) - log camposDataBackend
- `DEPLOY_LOG.md` - registro deste push

### Descrição
Ajuste de contagens: motivoReduzido tratado sempre como array com match exato "Liberação Chave Pix". Pix Liberado = ocorrências no período com pixLiberado=true. Pix Retido = Liberação Chave Pix + Resolvido + pixLiberado=false. Logs de diagnóstico ampliados.

---

## GitHub Push

**Data/Hora:** 2026-03-13  
**Tipo:** Push GitHub  
**Versão:** 2.1.2  
**Repositório:** https://github.com/admVeloHub/TempoReal
**Branch:** main

### Arquivos modificados / incluídos
- `src/components/DashboardReclamacoes.js` (v2.1.2) - opacidade headers 20%, painel adm deslocado 40px à esquerda
- `DEPLOY_LOG.md` - registro deste push
- Demais arquivos pendentes no working tree (ícones, index.html, App.js, index.css, LISTA_SCHEMAS.rb)

### Descrição
Ajustes visuais no dashboard: opacidade dos headers dos cards de 12% para 20%; conjunto ícone + painel administrativo deslocado 40px à esquerda.

---

## GitHub Push

**Data/Hora:** 2026-03-13  
**Tipo:** Push GitHub  
**Versão:** 1.2.3  
**Repositório:** https://github.com/admVeloHub/TempoReal
**Branch:** main

### Arquivos modificados / incluídos
- `src/App.js` (v1.2.3) - filtro de produto padrão: Antecipação 2026
- `DEPLOY_LOG.md` - registro deste push

### Descrição
Filtro de produto do dashboard configurado por padrão como "Antecipação 2026".
