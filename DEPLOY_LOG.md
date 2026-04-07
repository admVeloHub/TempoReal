# Deploy Log - Painel Tempo Real

## GitHub Push

**Data/Hora:** 2026-04-08  
**Tipo:** Push GitHub  
**Versão:** `stats.js` v1.20.0 / `octadeskIngestService` v1.14.1 / `LISTA_SCHEMAS` v4.16.20 / `App.js` v1.4.5 / `DashboardReclamacoes` v2.5.8  
**Repositório:** https://github.com/admVeloHub/TempoReal  
**Branch:** main  

### Arquivos modificados / incluídos
- `backend/routes/stats.js` v1.20.0 — card N1: `pixLiberado` conta `escalar_chamado` normalizado ∈ {Casos Especiais - Ouvidoria, Devolutiva, -}; logs `stats v1.20.0`
- `backend/services/octadeskIngestService.js` v1.14.1 — `escalar_chamado`: Devolutiva, Reabertura, “-”, traços Unicode só-hífen e vazio **não** entram no `$set` (preservam valor válido, ex. Ouvidoria)
- `LISTA_SCHEMAS.rb` v4.16.20 — notas `escalar_chamado` ingest + stats
- `src/App.js` v1.4.5 — filtro default: só Antecipação 2026 (remove “Outros Anos” do `DEFAULT_FILTROS`)
- `src/components/DashboardReclamacoes.js` v2.5.8 — comentário alinhado ao critério Escalado N2
- `backend/scripts/listN1CardSemClassificacao.js` v1.1.0 — diagnóstico docs N1 fora dos três mostradores do card
- `backend/scripts/listN2RetidosCpfs.js` v1.2.0 — listagem CPFs retidos N2 (exclui “Outros Anos” por padrão)

### Descrição
Métrica Escalado N1 alargada no `stats`; ingest deixa de sobrescrever Ouvidoria com estados transitórios do custom field. UI abre com filtro de produto apenas Antecipação - 2026. Scripts auxiliares para conferência no Mongo.

---

## GitHub Push

**Data/Hora:** 2026-04-08  
**Tipo:** Push GitHub  
**Versão:** `backend/routes/stats.js` v1.19.1 / `octadeskIngestService` v1.13.0 / LISTA_SCHEMAS v4.16.19 / `src/config.js` v1.2.0  
**Repositório:** https://github.com/admVeloHub/TempoReal  
**Branch:** main  

### Arquivos modificados / incluídos
- `LISTA_SCHEMAS.rb` — N1: `produto` documentado como fixo `Antecipação - 2026`; bloco `reclamacoes_n1Stats` v4.16.19
- `backend/services/octadeskIngestService.js` v1.13.0 — upsert N1: `produto` sempre `Antecipação - 2026`; `motivoReduzido` canónico; `$unset` legados
- `backend/routes/stats.js` v1.19.1 — card N1: `find` só período em `createdAt`; sem filtro produto/motivo da UI; log `stats v1.19.1`; export `criarFiltroPeriodoN1PorCreatedAt` para diagnose
- `backend/routes/octadeskIntegration.js`, `backend/server.js` — ajustes de integração/servidor na mesma linha de trabalho
- `backend/scripts/backupReclamacoesN1StatsJson.js`, `diagnoseN1StatsFilter.js` v1.3.1, `normalizeN1ProdutoAntecipacao2026.js` v1.0.0
- `src/config.js` v1.2.0 — dev: API padrão `http://localhost:5050`; Cloud Run só com `REACT_APP_USE_PRODUCTION_API=1`
- `src/App.js`, `FiltrosAuxiliar.js`, `api.js`, `DashboardReclamacoes.js`, `AbaAuxiliar.js`, `AbaRA.js`, `HookWebhookOctadesk.js` — comentários/versões alinhados ao stats e à API
- `.env.example` v1.0.3 — documentação variáveis front; `.gitignore`
- Removidos: `PROMPT_AGREGACAO_MOTIVOS_BACEN.md`, `exemplo/body.json`

### Descrição
Painel N1 passa a contar todos os documentos de `reclamações_n1Stats` no intervalo de `createdAt`, sem aplicar os filtros de produto/motivo das ouvidorias. Ingest grava produto fixo. Em desenvolvimento, o React deixa de usar `REACT_APP_API_URL` (Cloud Run) por defeito, evitando `/api/stats` antigo ao testar com `npm start` + backend local.

---

## GitHub Push

**Data/Hora:** 2026-04-06 (registro da alteração no repositório)  
**Tipo:** Push GitHub  
**Versão:** backend `octadeskIngestService` v1.9.7 / `stats` v1.12.4 / `server` v1.4.10 / script `migrateN1StatsLegacyFields` v1.0.0  
**Repositório:** https://github.com/admVeloHub/TempoReal  
**Branch:** main  

### Arquivos modificados / incluídos
- `backend/routes/stats.js` (v1.12.4) — métricas Liberação Chave Pix com `documentoLiberadoChavePixParaMetricas` (`retido_no_atendimento` + fallback `pixLiberado`); filtro motivo N1 com `motivos_chave_pix`
- `backend/services/octadeskIngestService.js` (v1.9.7) — `$set` sem `motivoReduzido`/`pixLiberado`; `$unset` desses campos a cada upsert N1
- `backend/server.js` (v1.4.10)
- `backend/scripts/migrateN1StatsLegacyFields.js` (v1.0.0) — migração `reclamações_n1Stats` (`DRY_RUN=1` ou `MIGRATE_N1_STATS=1`)
- `LISTA_SCHEMAS.rb` — bloco N1 sem `motivoReduzido`; notas legado `pixLiberado` / `motivo_2026`

### Descrição
N1: modelo de persistência alinhado a `retido_no_atendimento` e remoção de `motivoReduzido`/`pixLiberado` no webhook; stats e script operacional para normalizar documentos legados no Mongo (executar script apenas com backup e após validar `DRY_RUN=1`).

---

## GCP Cloud Run

**Data/Hora:** 2026-04-06 15:06  
**Tipo:** Deploy GCP Cloud Run (Cloud Build)  
**Serviço / imagem:** `tempo-real-api` (`gcr.io/$PROJECT_ID/tempo-real-api:$SHORT_SHA`)  
**Região (substituição cloudbuild):** southamerica-east1  
**Comando (raiz do repo):** `gcloud builds submit --config=cloudbuild.yaml .`

### Versões / foco deste deploy
- `backend/services/octadeskIngestService.js` **v1.9.6** — POST `/api/integrations/octadesk/webhook`, N1 upsert/skipped, `processedBy` + `ingestServiceVersion` no `octadesk_ingest_log`, decisão de motivo sem heurística ampla no webhook, `detail` JSON em skip
- `backend/routes/octadeskIntegration.js` **v1.6.3**, `backend/server.js` **v1.4.9**, `backend/services/octadeskIngestTailService.js` **v1.0.0** (tail opcional), scripts `ingestLogExportReplay.js`
- `src/components/HookWebhookOctadesk.js` **v1.4.6** — coluna Instância, meta `processorTagThisApi`, texto explicando Mongo vs quem recebe o POST
- `LISTA_SCHEMAS.rb`, `backend/.env.example` — documentação webhook / segredo / tail / `OCTADESK_INGEST_PROCESSOR_TAG`

### Descrição
Deploy para validar em produção o ingest Octadesk N1 (`reclamações_n1Stats` + log com rastreio de instância). Após o build: disparar webhook de teste ou atualizar ticket; conferir `/hook` (Instância = Cloud Run) e Mongo N1.

---

## GitHub Push

**Data/Hora:** 2026-03-31 16:59  
**Tipo:** Push GitHub  
**Versão:** DashboardReclamacoes v2.3.7  
**Repositório:** https://github.com/admVeloHub/TempoReal  
**Branch:** main  

### Arquivos modificados / incluídos
- `src/components/DashboardReclamacoes.js` (v2.3.7) — card N1: % Retenção calculada de novo (`retidos ÷ solLiberacao` só com dados N1); removida `percRetencaoLiteral` não usada

### Descrição
Gauge de retenção no canal N1 alinhado aos demais; painel executivo continua sem N1 na agregação.

---

## GitHub Push

**Data/Hora:** 2026-03-31 16:24  
**Tipo:** Push GitHub  
**Versão:** stats v1.8.7 / DashboardReclamacoes v2.3.6 / LoginPage v1.0.9  
**Repositório:** https://github.com/admVeloHub/TempoReal  
**Branch:** main  

### Arquivos modificados / incluídos
- `backend/routes/stats.js` (v1.8.7) — `percRetencao` = `pixRetido / solLiberacao × 100` (agregado alinhado a retidos ÷ ocorrências Liberação Chave Pix)
- `src/components/DashboardReclamacoes.js` (v2.3.6) — % Retenção: retidos ÷ `solLiberacao` no executivo e nos cards; painel adm sem N1; card N1 sem gauge; `percRetencaoLiteral` mantida só para compatibilidade HMR
- `src/components/LoginPage.js` (v1.0.9) — fundo fixo em camada, cor base `#000058`, query string de revisão no asset de background
- `public/login background.png` — arte atualizada do login

### Descrição
Retenção no painel e na API unificada como retidos sobre ocorrências (universo Liberação Chave Pix). Login: layout de fundo full-screen e bust de cache do PNG.

---

## GitHub Push

**Data/Hora:** 2026-03-31 15:16  
**Tipo:** Push GitHub  
**Versão:** DashboardReclamacoes v2.3.1  
**Repositório:** https://github.com/admVeloHub/TempoReal  
**Branch:** main  

### Arquivos modificados / incluídos
- `src/components/DashboardReclamacoes.js` (v2.3.1) — painel executivo: mostrador Liberados exclui `pixLiberado` do N1 (Escalado N2); cards por canal inalterados

### Descrição
Visão geral administrativa: Liberados agrega só Bacen, RA, Procon e N2; N1 permanece apenas no card Escalado N2.

---

## GitHub Push

**Data/Hora:** 2026-03-30 11:05  
**Tipo:** Push GitHub  
**Versão:** stats v1.8.6 / DashboardReclamacoes v2.3.0 / octadeskIngestService v1.3.1  
**Repositório:** https://github.com/admVeloHub/TempoReal  
**Branch:** main  

### Arquivos modificados / incluídos
- `backend/routes/stats.js` (v1.8.6) — Liberação Chave Pix exclusiva (`detalhe_2026` quando preenchido); `pixLiberado` só no universo Liberação; `% Retenção` = retidos / (escalado + retidos); comentários e nomes alinhados à conta literal
- `src/components/DashboardReclamacoes.js` (v2.3.0) — rótulos (Ocorrências, Escalado N2 N1), layout cards; `% Retenção` no gauge derivado de `pixLiberado` + `pixRetido` exibidos
- `backend/services/octadeskIngestService.js` (v1.3.1) — `motivoReduzidoFromDetalhe`; `motivoReduzido` espelha detalhe (Liberação / Retenção / texto), não força Liberação em todo Chave Pix
- `LISTA_SCHEMAS.rb` — comentário `motivoReduzido` em `reclamações_n1Stats` alinhado ao detalhe Octadesk

### Descrição
Painel tempo real: métricas N1/por tipo coerentes com Liberação Chave Pix; retenção literal e gauge sincronizado com os números do card; ingest N1 alinha `motivoReduzido` ao `detalhe_2026`.

---

## GitHub Push

**Data/Hora:** 2026-03-28  
**Tipo:** Push GitHub  
**Versão:** App v1.3.3 / octadeskIngest v1.3.0 / octadeskIntegration v1.3.0 / HookWebhookOctadesk v1.3.0 / api v1.3.2  
**Repositório:** https://github.com/admVeloHub/TempoReal  
**Branch:** main  

### Arquivos modificados / incluídos
- `src/components/HookWebhookOctadesk.js` (v1.3.0) — rota oculta `/hook`: JSON do POST (payload), polling ~3s, destaque linhas novas; legado `payloadCapturado`
- `src/App.js` (v1.3.3) — `isHookPath`, render HookWebhookOctadesk
- `src/services/api.js` (v1.3.2) — `fetchOctadeskIngestLogs(..., { includePayload })`
- `backend/services/octadeskIngestService.js` (v1.3.0) — `snapshotWebhookBody`; todo `writeIngestLog` com `payload`; lista com `includePayload` e placeholder + `payloadCapturado`
- `backend/routes/octadeskIntegration.js` (v1.3.0) — query `includePayload`
- `LISTA_SCHEMAS.rb` — `octadesk_ingest_log.payload` documentado
- `.env.example` (v1.0.2) / `backend/.env.example` — URL prod Cloud Run e fluxo webhook/front

### Descrição
Tela `/hook` para inspecionar corpo JSON dos webhooks Octadesk; persistência obrigatória de snapshot do POST nos novos logs; API enriquecida para UI e registros antigos sem corpo.

---

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
