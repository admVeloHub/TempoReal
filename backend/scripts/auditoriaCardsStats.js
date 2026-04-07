/**
 * Auditoria dos cards do Dashboard — mesmo pipeline que GET /api/stats (find + porTipo).
 * VERSION: v1.0.0
 *
 * Gera backend/reports/auditoria_cards_stats_<timestamp>.txt com contagens por canal
 * (N1, N2, Reclame Aqui, Bacen, Procon, Total) para conferir com o painel.
 *
 * Uso (pasta backend, .env com MONGO_ENV):
 *   node scripts/auditoriaCardsStats.js
 *
 * Filtros (igual semântica da rota; N1 ignora produto/motivo):
 *   DATA_INICIO=2026-01-01  DATA_FIM=2026-04-07  (opcional; padrão = stats)
 *   FILTRO_VAZIO=1  — sem filtro produto/motivo nas ouvidorias (só período)
 *   PRODUTO=a,b     — CSV para $in produto (se definido e não FILTRO_VAZIO)
 *   MOTIVO=a,b      — CSV motivos (se definido e não FILTRO_VAZIO)
 *
 * Se PRODUTO/MOTIVO omitidos e não FILTRO_VAZIO: padrão App — [Antecipação - 2026, Antecipação 2026] + Liberação chave pix.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const { MongoClient } = require('mongodb');
const { N1_STATS_COLLECTION } = require('../services/octadeskIngestService');
const statsRoute = require('../routes/stats');

const DB = 'hub_ouvidoria';
const STATS_DATE_ZONE = process.env.STATS_TZ || 'America/Sao_Paulo';

const COLLECTIONS = {
  bacen: 'reclamacoes_bacen',
  n2: 'reclamacoes_n2Pix',
  ra: 'reclamacoes_reclameAqui',
  procon: 'reclamacoes_procon',
};

function parseCsvEnv(name) {
  const raw = process.env[name];
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return [];
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

function produtosParaAuditoria() {
  if (process.env.FILTRO_VAZIO === '1' || String(process.env.FILTRO_VAZIO || '').toLowerCase() === 'true') {
    return [];
  }
  const p = parseCsvEnv('PRODUTO');
  if (p !== null) return p;
  return ['Antecipação - 2026', 'Antecipação 2026'];
}

function motivosParaAuditoria() {
  if (process.env.FILTRO_VAZIO === '1' || String(process.env.FILTRO_VAZIO || '').toLowerCase() === 'true') {
    return [];
  }
  const m = parseCsvEnv('MOTIVO');
  if (m !== null) return m;
  return ['Liberação chave pix'];
}

function fmtLinhaCard(label, stats) {
  const s = stats || {};
  return [
    label,
    `  ocorrencias:  ${s.ocorrencias ?? 0}`,
    `  solLiberacao: ${s.solLiberacao ?? 0} (universo Liberação Chave Pix — N1 usa ocorrencias)`,
    `  Liberados:    ${s.pixLiberado ?? 0}  (N1: Escalado N2)`,
    `  Retidos:      ${s.pixRetido ?? 0}`,
    `  % Retenção:   ${s.percRetencao ?? 0}`,
    `  Taxa resol.:  ${s.taxaResolucao ?? 0}`,
    `  resolvido:    ${s.resolvido ?? 0}`,
    `  emAberto:     ${s.emAberto ?? 0}`,
    `  semResposta:  ${s.semResposta ?? '—'} (ouvidoria)`,
    `  opCancelada:  ${s.opCancelada ?? '—'} (ouvidoria)`,
    `  caEProtocolos:${s.caEProtocolos ?? 0}`,
  ].join('\n');
}

async function main() {
  const uri = process.env.MONGO_ENV;
  if (!uri || typeof uri !== 'string') {
    console.error('[auditoriaCardsStats] MONGO_ENV ausente.');
    process.exit(1);
  }

  const dataInicioRaw = (process.env.DATA_INICIO && String(process.env.DATA_INICIO).trim()) || undefined;
  const dataFimRaw = process.env.DATA_FIM;
  const { dataInicio, dataFim } = statsRoute.normalizarIntervaloDatasQueryStats(dataInicioRaw, dataFimRaw);

  const produtos = produtosParaAuditoria();
  const motivos = motivosParaAuditoria();
  const filtroProduto = statsRoute.criarFiltroProduto(produtos);
  const filtroMotivo = statsRoute.criarFiltroMotivo(motivos);

  const filtroDataBacen = statsRoute.criarFiltroDataPorCollection('reclamacoes_bacen', dataInicio, dataFim);
  const filtroDataN2 = statsRoute.criarFiltroDataPorCollection('reclamacoes_n2Pix', dataInicio, dataFim);
  const filtroDataRA = statsRoute.criarFiltroDataPorCollection('reclamacoes_reclameAqui', dataInicio, dataFim);
  const filtroDataProcon = statsRoute.criarFiltroDataPorCollection('reclamacoes_procon', dataInicio, dataFim);
  const filtroDataN1 = statsRoute.criarFiltroPeriodoN1PorCreatedAt(dataInicio, dataFim);

  const filtroBacen = statsRoute.mesclarFiltros(filtroDataBacen, filtroProduto, filtroMotivo);
  const filtroN2 = statsRoute.mesclarFiltros(filtroDataN2, filtroProduto, filtroMotivo);
  const filtroRA = statsRoute.mesclarFiltros(filtroDataRA, filtroProduto, filtroMotivo);
  const filtroProcon = statsRoute.mesclarFiltros(filtroDataProcon, filtroProduto, filtroMotivo);
  const filtroN1 = { ...filtroDataN1 };

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB);

  const [bacen, n2Pix, reclameAquiDocs, proconDocs, n1Docs] = await Promise.all([
    db.collection(COLLECTIONS.bacen).find(filtroBacen).toArray(),
    db.collection(COLLECTIONS.n2).find(filtroN2).toArray(),
    db.collection(COLLECTIONS.ra).find(filtroRA).toArray(),
    db.collection(COLLECTIONS.procon).find(filtroProcon).toArray(),
    db.collection(N1_STATS_COLLECTION).find(filtroN1).toArray(),
  ]);

  const todas = [...bacen, ...n2Pix, ...reclameAquiDocs, ...proconDocs, ...n1Docs];

  const porTipo = {
    N1: statsRoute.calcularStatsCardN1(n1Docs),
    N2: statsRoute.enrichComMostradoresOuvidoria(statsRoute.calcularStatsPorTipo(n2Pix), n2Pix),
    'Reclame Aqui': statsRoute.enrichComMostradoresOuvidoria(
      statsRoute.calcularStatsPorTipo(reclameAquiDocs),
      reclameAquiDocs
    ),
    Bacen: statsRoute.enrichComMostradoresOuvidoria(statsRoute.calcularStatsPorTipo(bacen), bacen),
    Procon: statsRoute.enrichComMostradoresOuvidoria(statsRoute.calcularStatsPorTipo(proconDocs), proconDocs),
    Total: statsRoute.calcularStatsPorTipo(todas),
  };

  const agora = DateTime.now().setZone(STATS_DATE_ZONE);
  const stamp = agora.toFormat('yyyy-MM-dd_HHmmss');
  const dirOut = path.join(__dirname, '..', 'reports');
  const arquivo = path.join(dirOut, `auditoria_cards_stats_${stamp}.txt`);

  const blocos = [
    'AUDITORIA CARDS — pipeline idêntico GET /api/stats (porTipo)',
    '============================================================',
    `Gerado: ${agora.toFormat('yyyy-MM-dd HH:mm:ss')} (${STATS_DATE_ZONE})`,
    'Script: backend/scripts/auditoriaCardsStats.js v1.0.0',
    '',
    'FILTROS',
    '-------',
    `dataInicio query: ${dataInicioRaw ?? '(padrão stats 2026-01-01)'}`,
    `dataFim query:    ${dataFimRaw ?? '(padrão fim do dia hoje)'}`,
    `Intervalo aplicado dataInicio JS: ${dataInicio?.toISOString?.()}`,
    `Intervalo aplicado dataFim JS:    ${dataFim?.toISOString?.()}`,
    `produtos (ouvidoria): ${JSON.stringify(produtos)}`,
    `motivos:               ${JSON.stringify(motivos)}`,
    'N1: apenas período em createdAt (produto/motivo ignorados, como na rota).',
    '',
    'DOCUMENTOS RETORNADOS PELO find (por coleção)',
    '----------------------------------------------',
    `reclamacoes_bacen:        ${bacen.length}`,
    `reclamacoes_n2Pix:        ${n2Pix.length}`,
    `reclamacoes_reclameAqui:  ${reclameAquiDocs.length}`,
    `reclamacoes_procon:       ${proconDocs.length}`,
    `${N1_STATS_COLLECTION}: ${n1Docs.length}`,
    `soma (Total.ocorrencias): ${todas.length}`,
    '',
    'MÉTRICAS POR CARD (porTipo)',
    '---------------------------',
    fmtLinhaCard('--- N1 ---', porTipo.N1),
    '',
    fmtLinhaCard('--- N2 ---', porTipo.N2),
    '',
    fmtLinhaCard('--- Reclame Aqui ---', porTipo['Reclame Aqui']),
    '',
    fmtLinhaCard('--- Bacen ---', porTipo.Bacen),
    '',
    fmtLinhaCard('--- Procon ---', porTipo.Procon),
    '',
    fmtLinhaCard('--- Total (agregado) ---', porTipo.Total),
    '',
    'JSON porTipo (colar para diff)',
    '--------------------------------',
    JSON.stringify(porTipo, null, 2),
    '',
    '— Fim —',
  ];

  fs.mkdirSync(dirOut, { recursive: true });
  fs.writeFileSync(arquivo, blocos.join('\n'), 'utf8');

  console.log('[auditoriaCardsStats] Arquivo:', arquivo);
  console.log('[auditoriaCardsStats] Docs:', {
    bacen: bacen.length,
    n2: n2Pix.length,
    ra: reclameAquiDocs.length,
    procon: proconDocs.length,
    n1: n1Docs.length,
    total: todas.length,
  });

  await client.close();
}

main().catch((e) => {
  console.error('[auditoriaCardsStats]', e);
  process.exit(1);
});
