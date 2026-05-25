/**
 * Contagem: universo Liberação Chave Pix + pixLiberado=true vs Liberados exibidos no painel.
 * Paridade de predicados com stats.js (documentoELiberacaoChavePixExclusivo + contribuiPixLiberadoCard).
 *
 * VERSION: v1.0.0
 *
 * Uso (pasta backend):
 *   node scripts/auditoriaPixLiberadoMotivoChavePix.js
 *
 * Filtros (iguais auditoriaCardsStats.js):
 *   DATA_INICIO, DATA_FIM, FILTRO_VAZIO=1, PRODUTO=csv, MOTIVO=csv
 */

/** Node no Windows: querySrv Atlas via DNS Google quando o resolver do sistema falha. */
(function configureDnsForAtlasSrv() {
  if (process.env.SKIP_DNS_OVERRIDE === '1') return;
  try {
    require('dns').setServers(['8.8.8.8', '8.8.4.4']);
  } catch (_e) {
    /* ignore */
  }
})();

(function loadVelohubFonteEnv(here) {
  const path = require('path');
  const fs = require('fs');
  let d = here;
  for (let i = 0; i < 14; i++) {
    const loader = path.join(d, 'FONTE DA VERDADE', 'bootstrapFonteEnv.cjs');
    if (fs.existsSync(loader)) {
      require(loader).loadFrom(here);
      return;
    }
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
})(__dirname);

const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const { MongoClient } = require('mongodb');
const statsRoute = require('../routes/stats');

const DB = 'hub_ouvidoria';
const STATS_DATE_ZONE = process.env.STATS_TZ || 'America/Sao_Paulo';

const CANAIS = [
  { canal: 'N1', collection: 'reclamacoes_timePortabilidade' },
  { canal: 'N2', collection: 'reclamacoes_n2Pix' },
  { canal: 'Reclame Aqui', collection: 'reclamacoes_reclameAqui' },
  { canal: 'Bacen', collection: 'reclamacoes_bacen' },
  { canal: 'Procon', collection: 'reclamacoes_procon' },
];

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

function normalizarCpf(cpf) {
  if (cpf == null) return '';
  return String(cpf).replace(/\D/g, '');
}

/** Universo Liberação Chave Pix (stats.js). */
function temMotivoLiberacaoChavePix(r) {
  return statsRoute.documentoELiberacaoChavePixExclusivo(r);
}

function pixLiberadoTrue(r) {
  return r != null && r.pixLiberado === true;
}

function docContribuiLiberadosPainel(r) {
  const p = statsRoute.auditoriaPainelPredicatesPorDoc(r);
  return Boolean(p && p.contribuiPixLiberadoCard);
}

function resolvido(r) {
  return statsRoute.documentoResolvidoParaMetricas(r);
}

function contarCpfsUnicos(docs) {
  const cpfs = new Set();
  let semCpf = 0;
  for (const d of docs) {
    const c = normalizarCpf(d.cpf);
    if (c) cpfs.add(c);
    else semCpf += 1;
  }
  return { cpfsUnicos: cpfs.size + semCpf, semCpf };
}

function analisarDocs(docs) {
  const libPixTrue = docs.filter((r) => temMotivoLiberacaoChavePix(r) && pixLiberadoTrue(r));
  const libPixTrueResolvido = libPixTrue.filter(resolvido);
  const liberadosPainel = docs.filter(docContribuiLiberadosPainel);

  const libPixTrueForaFind = docs.filter(
    (r) => !temMotivoLiberacaoChavePix(r) && pixLiberadoTrue(r)
  );

  return {
    totalDocsFind: docs.length,
    libChavePixPixTrue: libPixTrue.length,
    libChavePixPixTrueResolvido: libPixTrueResolvido.length,
    liberadosPainel: liberadosPainel.length,
    pixTrueSemUniversoLib: libPixTrueForaFind.length,
    cpfsLibChavePixPixTrue: contarCpfsUnicos(libPixTrue),
    cpfsLiberadosPainel: contarCpfsUnicos(liberadosPainel),
    /** pixLiberado=true + universo lib, mas painel não conta (não resolvido, sem resposta, etc.) */
    libPixTrueNaoNoPainel: libPixTrue.filter((r) => !docContribuiLiberadosPainel(r)).length,
    /** painel conta liberado mas pixLiberado não é true (N1 usa escalar_chamado) */
    painelSemPixTrue: liberadosPainel.filter((r) => !pixLiberadoTrue(r)).length,
  };
}

async function main() {
  const uri = process.env.MONGO_ENV;
  if (!uri || typeof uri !== 'string') {
    console.error('[auditoriaPixLiberadoMotivoChavePix] MONGO_ENV ausente.');
    process.exit(1);
  }

  const dataInicioRaw = (process.env.DATA_INICIO && String(process.env.DATA_INICIO).trim()) || undefined;
  const dataFimRaw = process.env.DATA_FIM;
  const { dataInicio, dataFim } = statsRoute.normalizarIntervaloDatasQueryStats(dataInicioRaw, dataFimRaw);

  const produtos = produtosParaAuditoria();
  const motivos = motivosParaAuditoria();
  const filtroProduto = statsRoute.criarFiltroProduto(produtos);
  const filtroMotivo = statsRoute.criarFiltroMotivo(motivos);

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB);

  const porCanal = [];
  const todasDocs = [];
  /** Período + produto, sem filtro motivo no Mongo — captura motivo só em motivos_chave_pix/detalhe_2026 */
  const todasPeriodoProduto = [];

  for (const { canal, collection } of CANAIS) {
    const filtroData = statsRoute.criarFiltroDataPorCollection(collection, dataInicio, dataFim);
    const filtroPainel = statsRoute.mesclarFiltros(filtroData, filtroProduto, filtroMotivo);
    const filtroSemMotivo = statsRoute.mesclarFiltros(filtroData, filtroProduto, {});

    const [docsPainel, docsSemMotivoMongo] = await Promise.all([
      db.collection(collection).find(filtroPainel).toArray(),
      db.collection(collection).find(filtroSemMotivo).toArray(),
    ]);

    todasDocs.push(...docsPainel);
    todasPeriodoProduto.push(...docsSemMotivoMongo);

    const aPainel = analisarDocs(docsPainel);
    const aAmplo = analisarDocs(docsSemMotivoMongo);

    porCanal.push({
      canal,
      collection,
      docsPainel,
      recortePainel: aPainel,
      recortePeriodoProdutoSemMotivoMongo: aAmplo,
      extrasForaFiltroMotivoMongo: aAmplo.libChavePixPixTrue - aPainel.libChavePixPixTrue,
      painelPixLiberado: statsRoute.calcularStatsPorTipo(docsPainel).pixLiberado,
    });
  }

  await client.close();

  const totalPainel = analisarDocs(todasDocs);
  const totalAmplo = analisarDocs(todasPeriodoProduto);
  const porTipoTotal = statsRoute.calcularStatsPorTipo(todasDocs);

  const agora = DateTime.now().setZone(STATS_DATE_ZONE);
  const stamp = agora.toFormat('yyyy-MM-dd_HHmmss');
  const dirOut = path.join(__dirname, '..', 'reports');
  const arquivo = path.join(dirOut, `auditoria_pix_liberado_motivo_chave_pix_${stamp}.txt`);

  const linhas = [
    'AUDITORIA — Liberação Chave Pix + pixLiberado=true vs LIBERADOS DO PAINEL',
    '=======================================================================',
    `Gerado: ${agora.toFormat('yyyy-MM-dd HH:mm:ss')} (${STATS_DATE_ZONE})`,
    'Script: backend/scripts/auditoriaPixLiberadoMotivoChavePix.js v1.0.0',
    '',
    'CRITÉRIOS',
    '---------',
    'A) Lib. Chave Pix + pixLiberado=true:',
    '   documentoELiberacaoChavePixExclusivo(r) AND r.pixLiberado === true',
    'B) Liberados no painel (GET /api/stats):',
    '   auditoriaPainelPredicatesPorDoc.contribuiPixLiberadoCard',
    '   (ouvidoria: resolvido + classificação excludente "liberado"; N1: Escalado N2)',
    '',
    'FILTROS RECORTE PAINEL (find Mongo = GET /api/stats)',
    '----------------------------------------------------',
    `dataInicio: ${dataInicioRaw ?? '(padrão 2026-01-01)'}`,
    `dataFim:    ${dataFimRaw ?? '(padrão hoje)'}`,
    `produtos:   ${JSON.stringify(produtos)}`,
    `motivos:    ${JSON.stringify(motivos)}`,
    '',
    'COMPARATIVO PRINCIPAL (recorte painel — mesmo find do dashboard)',
    '----------------------------------------------------------------',
    `Documentos no find (Total.ocorrencias):              ${totalPainel.totalDocsFind}`,
    '',
    `[A] Lib. Chave Pix + pixLiberado=true (TODOS):         ${totalPainel.libChavePixPixTrue}`,
    `    CPFs únicos:                                     ${totalPainel.cpfsLibChavePixPixTrue.cpfsUnicos}`,
    '',
    `[A+] Lib. Chave Pix + pixLiberado=true + Resolvido:   ${totalPainel.libChavePixPixTrueResolvido}`,
    '',
    `[B] Liberados exibidos no painel (Total.pixLiberado): ${porTipoTotal.pixLiberado}`,
    `    CPFs únicos (liberados painel):                  ${totalPainel.cpfsLiberadosPainel.cpfsUnicos}`,
    '',
    'DIFERENÇA A − B (docs):',
    `    ${totalPainel.libChavePixPixTrue - porTipoTotal.pixLiberado}`,
    '    (positivo = mais casos com pixLiberado=true do que o painel mostra em Liberados)',
    '',
    'DETALHAMENTO DA DIFERENÇA',
    '-------------------------',
    `[A] com pixLiberado=true mas NÃO entra em Liberados painel: ${totalPainel.libPixTrueNaoNoPainel}`,
    '    (tipicamente: não resolvido, sem resposta, op. cancelada, fora classificação liberado)',
    `[B] Liberados painel sem pixLiberado=true:                  ${totalPainel.painelSemPixTrue}`,
    '    (N1 / Time Portabilidade: critério Escalado N2, não pixLiberado)',
    `pixLiberado=true fora do universo Lib. Chave Pix (no find):  ${totalPainel.pixTrueSemUniversoLib}`,
    '',
    'RECORTE AMPLIADO (período + produto, SEM filtro motivo no Mongo)',
    '----------------------------------------------------------------',
    'Inclui documentos cujo motivo Lib. Chave Pix está só em motivos_chave_pix/detalhe_2026',
    'e não passariam no find do painel quando filtro motivo está ativo.',
    '',
    `[A amplo] Lib. Chave Pix + pixLiberado=true:           ${totalAmplo.libChavePixPixTrue}`,
    `    CPFs únicos:                                     ${totalAmplo.cpfsLibChavePixPixTrue.cpfsUnicos}`,
    `[A amplo] + Resolvido:                               ${totalAmplo.libChavePixPixTrueResolvido}`,
    `Extras vs recorte painel (docs [A amplo] − [A painel]): ${totalAmplo.libChavePixPixTrue - totalPainel.libChavePixPixTrue}`,
    '',
    'POR CANAL (recorte painel)',
    '--------------------------',
  ];

  for (const c of porCanal) {
    const r = c.recortePainel;
    linhas.push(
      '',
      `--- ${c.canal} (${c.collection}) ---`,
      `  Docs no find:                              ${r.totalDocsFind}`,
      `  [A] Lib. Chave Pix + pixLiberado=true:     ${r.libChavePixPixTrue} (CPFs: ${r.cpfsLibChavePixPixTrue.cpfsUnicos})`,
      `  [A+] + Resolvido:                          ${r.libChavePixPixTrueResolvido}`,
      `  [B] Liberados painel (pixLiberado card):   ${c.painelPixLiberado} (CPFs: ${r.cpfsLiberadosPainel.cpfsUnicos})`,
      `  Diferença A − B:                           ${r.libChavePixPixTrue - c.painelPixLiberado}`,
      `  [A] não no painel:                         ${r.libPixTrueNaoNoPainel}`,
      `  [B] painel sem pixLiberado=true:           ${r.painelSemPixTrue}`,
      `  Extras fora filtro motivo Mongo (A amplo): ${c.extrasForaFiltroMotivoMongo}`,
    );
  }

  linhas.push('', '— Fim —');

  fs.mkdirSync(dirOut, { recursive: true });
  fs.writeFileSync(arquivo, linhas.join('\n'), 'utf8');

  console.log('[auditoriaPixLiberadoMotivoChavePix] Arquivo:', arquivo);
  console.log('[auditoriaPixLiberadoMotivoChavePix] RECORTE PAINEL:');
  console.log(`  [A] Lib. Chave Pix + pixLiberado=true:  ${totalPainel.libChavePixPixTrue} (CPFs ${totalPainel.cpfsLibChavePixPixTrue.cpfsUnicos})`);
  console.log(`  [A+] + Resolvido:                       ${totalPainel.libChavePixPixTrueResolvido}`);
  console.log(`  [B] Liberados painel (Total):           ${porTipoTotal.pixLiberado}`);
  console.log(`  Diferença A − B:                        ${totalPainel.libChavePixPixTrue - porTipoTotal.pixLiberado}`);
  console.log(`  [A] não no painel:                      ${totalPainel.libPixTrueNaoNoPainel}`);
  console.log(`  [B] painel sem pixLiberado=true:        ${totalPainel.painelSemPixTrue}`);
  console.log(`  [A amplo] sem filtro motivo Mongo:      ${totalAmplo.libChavePixPixTrue}`);
}

main().catch((e) => {
  console.error('[auditoriaPixLiberadoMotivoChavePix]', e);
  process.exit(1);
});
