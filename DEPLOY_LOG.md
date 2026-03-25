# Deploy Log - Painel Tempo Real

## GitHub Push

**Data/Hora:** 2026-03-27  
**Tipo:** Push GitHub  
**Versão:** App v1.3.2 / auth v1.0.1  
**Repositório:** https://github.com/admVeloHub/TempoReal  
**Branch:** main  

### Arquivos modificados / incluídos
- `src/services/auth.js` (v1.0.1) — removidos `beforeunload` / `pagehide` que chamavam `registerLogout`; sessão preservada em F5 e navegação (ex. `/observador`)
- `src/App.js` (v1.3.2) — comentário de doc: sessão em localStorage até logout ou expiração (4h)

### Descrição
Correção: login não é mais invalidado ao recarregar ou mudar de rota; logout explícito inalterado.

---

## GitHub Push

**Data/Hora:** 2026-03-26  
**Tipo:** Push GitHub  
**Versão:** App v1.3.1 / LoginPage v1.0.7 / ObservadorOctadesk v1.2.2  
**Repositório:** https://github.com/admVeloHub/TempoReal  
**Branch:** main  

### Arquivos modificados / incluídos
- `src/App.js` (v1.3.1) — menu do usuário sem linha de e-mail (nome já no header)
- `src/components/LoginPage.js` (v1.0.7) — Google Sign-In: script único, `initialize` uma vez por carga, callback via ref
- `src/components/ObservadorOctadesk.js` (v1.2.2) — remoção e-mail redundante; barra de status API compacta (v1.2.1); sem aviso de webhook no corpo

### Descrição
UX: menos duplicação de identidade no header/menu. Login Google: evita aviso GSI por múltiplas chamadas a `initialize` em dev (Strict Mode).

---

## GitHub Push

**Data/Hora:** 2026-03-25  
**Tipo:** Push GitHub  
**Versão:** octadeskIntegration v1.1.0 / octadeskIngest v1.1.0 / Observador v1.2.0 / api v1.3.1  
**Repositório:** https://github.com/admVeloHub/TempoReal  
**Branch:** main  

### Arquivos modificados / incluídos
- `backend/routes/octadeskIntegration.js` (v1.1.0) — webhook **sem** autenticação por segredo; `GET /logs` com `Cache-Control: no-store`
- `backend/services/octadeskIngestService.js` (v1.1.0) — remoção validação de secret; meta `webhookRequiresSecret: false` nos logs
- `backend/.env.example` — removido `OCTADESK_WEBHOOK_SECRET` (não utilizado)
- `src/components/ObservadorOctadesk.js` (v1.2.0) — aviso de endpoint público; ajuda sem `unauthorized` como fluxo atual
- `src/services/api.js` (v1.3.1) — `fetch` dos logs com `cache: 'no-store'`
- `LISTA_SCHEMAS.rb` — ajustes de comentário quando aplicável

### Descrição
Webhook Octadesk aceita payload sem secret (requisito operacional). Observador e API de logs evitam cache HTTP; documentação de env alinhada.

---

## GitHub Push

**Data/Hora:** 2026-03-24  
**Tipo:** Push GitHub  
**Versão:** backend server v1.3.0 / stats v1.8.1 / octadeskIngest v1.0.4 / front App v1.3.0 / Dashboard v2.2.0 / api v1.3.0  
**Repositório:** https://github.com/admVeloHub/TempoReal  
**Branch:** main  

### Arquivos modificados / incluídos
- `LISTA_SCHEMAS.rb` — `reclamações_n1Stats`, `octadesk_ingest_log`, comentários alinhados às regras N1 (motivo Chave Pix; detalhe Liberação/Retenção; pixLiberado; produto)
- `backend/server.js` (v1.3.0) — registro rotas Octadesk, `ensureOctadeskIndexes` na subida
- `backend/routes/octadeskIntegration.js` (v1.0.0) — `POST /api/integrations/octadesk/webhook`, `GET /api/integrations/octadesk/logs`
- `backend/services/octadeskIngestService.js` (v1.0.4) — elegibilidade por motivo Chave Pix; `pixLiberado` com Resolvido + detalhe; `x-api-key` no webhook; upsert `reclamações_n1Stats`
- `backend/routes/stats.js` (v1.8.1) — `porTipo.N1`, Total cinco fontes, `dataEntradaN1`, `documentoResolvidoParaMetricas` (taxa resolução estrita)
- `backend/.env.example` — `OCTADESK_WEBHOOK_SECRET` e notas de headers
- `src/components/DashboardReclamacoes.js` (v2.2.0) — N1 via `porTipo`
- `src/components/ObservadorOctadesk.js` (v1.0.0) — `/observador`
- `src/App.js` (v1.3.0) — rota observador, link menu usuário
- `src/services/api.js` (v1.3.0) — `fetchOctadeskIngestLogs`
- `exemplo/body.json` — payload exemplo Octadesk

### Descrição
Integração Octadesk: webhook (secret ou `x-api-key`), persistência em `reclamações_n1Stats`, logs em `octadesk_ingest_log`, agregação N1 no painel e no Total, tela Observador. Regras de negócio N1 e taxa de resolução documentadas no código e no LISTA_SCHEMAS.

---

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

---

## GitHub Push

**Data/Hora:** 2026-03-13  
**Tipo:** Push GitHub  
**Versão:** 1.2.4  
**Repositório:** https://github.com/admVeloHub/TempoReal
**Branch:** main

### Arquivos modificados / incluídos
- `src/App.js` (v1.2.4) - remoção persistência localStorage; todo login inicia no padrão
- `DEPLOY_LOG.md` - registro deste push

### Descrição
Removida persistência de filtros no localStorage. Todo carregamento/login inicia com filtros padrão (Antecipação 2026, data 2026-01-01).

---

## GitHub Push

**Data/Hora:** 2026-03-20  
**Tipo:** Push GitHub  
**Versão:** backend v1.7.6 / front v1.2.6  
**Repositório:** https://github.com/admVeloHub/TempoReal  
**Branch:** main

### Arquivos modificados / incluídos
- `backend/routes/stats.js` (v1.7.6) - deduplicação/agrupamento de motivos; totais e motivos por produto (RA + Bacen/Procon/N2/Judicial); rota `GET /api/stats/judicial` (`reclamacoes_judicial`, `dataEntrada`)
- `src/App.js` (v1.2.5) - aba Judicial
- `src/components/AbaAuxiliar.js` (v1.0.5) - suporte tipo judicial
- `src/components/ConteudoAuxiliar.js` (v1.2.6) - tabelas pivot scroll/sticky/zebrado; coluna Produtos expansível em todas as abas com API; rótulos Antecipação; bordas e fonte `text-xs`
- `src/services/api.js` (v1.2.5) - versão comentário
- `DEPLOY_LOG.md` - registro deste push

### Descrição
Stats: motivos canônicos por documento e por produto; novos campos `totaisPorProdutoPorDia` / `motivosPorProdutoPorDia` nas rotas auxiliares e RA. UI: tabela reclamações com produtos expansíveis, ajustes visuais de contraste e tipografia. Nova aba Judicial para `reclamacoes_judicial`.

---

## GitHub Push

**Data/Hora:** 2026-03-20  
**Tipo:** Push GitHub  
**Versão:** backend server v1.2.2 / auth v1.0.3 / userSessionLogger v1.0.3 / LoginPage v1.0.6  
**Repositório:** https://github.com/admVeloHub/TempoReal  
**Branch:** main

### Arquivos modificados / incluídos
- `backend/server.js` (v1.2.2) - conexão MongoDB apenas via variável de ambiente `MONGO_ENV` (sem `MONGODB_URI`)
- `backend/services/userSessionLogger.js` (v1.0.3) - idem `MONGO_ENV`
- `backend/routes/auth.js` (v1.0.3) - mensagens 503 e detecção de erro de DB alinhadas a `MONGO_ENV`
- `backend/.env.example`, `.env.example` - documentação só `MONGO_ENV`
- `src/components/LoginPage.js` (v1.0.6) - tratamento de respostas não-JSON em login/validate-access
- `DEPLOY_LOG.md` - registro deste push

### Descrição
Padronização da string de conexão MongoDB em `MONGO_ENV` (Cloud Run / local). Remoção de referências a `MONGODB_URI`. Ajustes em login para corpos de resposta não JSON.

---

## GitHub Push

**Data/Hora:** 2026-03-20  
**Tipo:** Push GitHub  
**Versão:** backend server v1.2.3 / userSessionLogger v1.0.4  
**Repositório:** https://github.com/admVeloHub/TempoReal  
**Branch:** main

### Arquivos modificados / incluídos
- `backend/server.js` (v1.2.3) - antes de reutilizar o `MongoClient` singleton, `ping` no `admin`; em falha (`MongoTopologyClosedError` / idle Cloud Run), `close` + nova conexão
- `backend/services/userSessionLogger.js` (v1.0.4) - mesma lógica de verificação/reconexão no `connect()`
- `DEPLOY_LOG.md` - registro deste push

### Descrição
Correção de `MongoTopologyClosedError: Topology is closed` em `/api/stats` e rotas que compartilham o cliente: evita reutilizar topologia já fechada após idle ou queda de rede no Cloud Run.
