/**
 * Backup auditável — hub_ouvidoria.reclamacoes_n2Pix
 * VERSION: v1.0.0
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

 *
 * Gera em backend/backups/:
 *   1) *_raw.json — dump BSON (EJSON relaxado), fiel ao Mongo.
 *   2) *_painel.json — chaves de negócio + predicados do card N2 (stats.js calcularStatsPorTipo + enrich).
 *   3) *_manifest.json — metadados, SHA-256 do raw, totais e reconciliação (soma dos flags = métricas).
 *
 * Uso (pasta backend, .env com MONGO_ENV):
 *   node scripts/backupAuditoriaReclamacoesN2Pix.js
 *
 * Opcional (mesmo critério de data do GET /api/stats para N2 — campo dataEntradaN2):
 *   DATA_INICIO=2026-01-01 DATA_FIM=2026-04-09 node scripts/backupAuditoriaReclamacoesN2Pix.js
 */


const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');

const statsRoute = require('../routes/stats');

const DB = 'hub_ouvidoria';
const COLL = 'reclamacoes_n2Pix';

function timestampFilePart() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

function sha256File(p) {
  const buf = fs.readFileSync(p);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sumFlags(docs, key) {
  return docs.reduce((n, row) => n + (row.predicadosPainel && row.predicadosPainel[key] === true ? 1 : 0), 0);
}

async function main() {
  const uri = process.env.MONGO_ENV;
  if (!uri || typeof uri !== 'string') {
    console.error('[backupAuditoriaReclamacoesN2Pix] MONGO_ENV não definida no .env.');
    process.exit(1);
  }

  const dataInicio = process.env.DATA_INICIO && String(process.env.DATA_INICIO).trim();
  const dataFim = process.env.DATA_FIM && String(process.env.DATA_FIM).trim();
  const filtro =
    dataInicio || dataFim
      ? statsRoute.criarFiltroDataPorCollection(COLL, dataInicio || null, dataFim || null)
      : {};

  const backupsDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const stamp = timestampFilePart();
  const base = `reclamacoes_n2Pix_audit_${stamp}`;
  const rawPath = path.join(backupsDir, `${base}_raw.json`);
  const painelPath = path.join(backupsDir, `${base}_painel.json`);
  const manifestPath = path.join(backupsDir, `${base}_manifest.json`);

  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db(DB).collection(COLL);
  const docs = await col.find(filtro).sort({ dataEntradaN2: 1, _id: 1 }).toArray();
  await client.close();

  const rawJson = EJSON.stringify(docs, { relaxed: true, legacy: false });
  fs.writeFileSync(rawPath, rawJson, 'utf8');

  const statsBase = statsRoute.calcularStatsPorTipo(docs);
  const statsEnriched = statsRoute.enrichComMostradoresOuvidoria(statsBase, docs);

  const linhas = docs.map((r) => {
    const pred = statsRoute.auditoriaPainelPredicatesPorDoc(r);
    return {
      _id: r._id,
      cpf: r.cpf != null ? String(r.cpf) : null,
      nome: r.nome != null ? String(r.nome) : null,
      produto: r.produto != null ? String(r.produto) : null,
      dataEntradaN2: r.dataEntradaN2 ?? null,
      motivoReduzido: r.motivoReduzido ?? null,
      motivos_chave_pix: r.motivos_chave_pix ?? null,
      detalhe_2026: r.detalhe_2026 ?? null,
      pixLiberado: r.pixLiberado,
      retido_no_atendimento: r.retido_no_atendimento,
      Finalizado: r.Finalizado ?? null,
      octadeskNumber: r.octadeskNumber ?? null,
      predicadosPainel: pred,
    };
  });

  const fromFlags = {
    ocorrencias: linhas.length,
    emAberto: sumFlags(linhas, 'emAbertoCard'),
    resolvido: sumFlags(linhas, 'resolvidoParaMetricas'),
    caEProtocolos: sumFlags(linhas, 'contribuiCaEProtocolos'),
    solLiberacao: sumFlags(linhas, 'contribuiSolLiberacao'),
    pixLiberado: sumFlags(linhas, 'contribuiPixLiberadoCard'),
    pixRetido: sumFlags(linhas, 'contribuiPixRetidoCard'),
    semResposta: sumFlags(linhas, 'semRespostaClienteAposResolvido'),
    opCancelada: sumFlags(linhas, 'opCanceladaMotivo7Dias'),
  };

  const percRetencao =
    fromFlags.solLiberacao > 0
      ? Math.round((fromFlags.pixRetido / fromFlags.solLiberacao) * 1000) / 10
      : 0;
  const taxaResolucao =
    fromFlags.ocorrencias > 0
      ? Math.round((fromFlags.resolvido / fromFlags.ocorrencias) * 1000) / 10
      : 0;
  const fromFlagsComplete = { ...fromFlags, percRetencao, taxaResolucao };

  const keys = [
    'ocorrencias',
    'emAberto',
    'resolvido',
    'caEProtocolos',
    'solLiberacao',
    'pixLiberado',
    'pixRetido',
    'semResposta',
    'opCancelada',
    'percRetencao',
    'taxaResolucao',
  ];
  const reconciliacao = {};
  let allMatch = true;
  keys.forEach((k) => {
    const a = statsEnriched[k];
    const b = fromFlagsComplete[k];
    const ok = a === b;
    if (!ok) allMatch = false;
    reconciliacao[k] = { statsRoute: a, somaPredicados: b, match: ok };
  });

  const painelPayload = {
    meta: {
      script: 'backupAuditoriaReclamacoesN2Pix.js',
      scriptVersion: 'v1.0.0',
      geradoEm: new Date().toISOString(),
      database: DB,
      collection: COLL,
      filtroMongo: filtro,
      filtroDescricao:
        dataInicio || dataFim
          ? `dataEntradaN2 no intervalo DATA_INICIO/DATA_FIM (stats.js criarFiltroDataPorCollection)`
          : 'coleção completa (sem filtro de data)',
      documentos: linhas.length,
      referenciaCalculo:
        'backend/routes/stats.js — calcularStatsPorTipo, enrichComMostradoresOuvidoria, auditoriaPainelPredicatesPorDoc',
    },
    metricasPainelN2: statsEnriched,
    reconciliacaoPredicadosVsMetricas: {
      todasBatem: allMatch,
      porCampo: reconciliacao,
    },
    linhas,
  };

  fs.writeFileSync(painelPath, JSON.stringify(painelPayload, null, 2), 'utf8');

  const shaRaw = sha256File(rawPath);

  const manifest = {
    backup: base,
    versaoScript: 'v1.0.0',
    geradoEm: new Date().toISOString(),
    database: DB,
    collection: COLL,
    filtroMongo: filtro,
    arquivos: {
      raw: path.basename(rawPath),
      raw_sha256_hex: shaRaw,
      painel: path.basename(painelPath),
    },
    contagemDocumentos: docs.length,
    metricasAgregadasN2_comoStatsRoute: statsEnriched,
    reconciliacaoOk: allMatch,
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`[backupAuditoriaReclamacoesN2Pix] ${docs.length} documento(s)`);
  console.log(`  raw       → ${rawPath}`);
  console.log(`  painel    → ${painelPath}`);
  console.log(`  manifest  → ${manifestPath}`);
  console.log(`  SHA-256   → ${shaRaw}`);
  console.log(`  Reconciliação predicados × métricas: ${allMatch ? 'OK' : 'DIVERGÊNCIA — ver manifest'}`);
}

main().catch((e) => {
  console.error('[backupAuditoriaReclamacoesN2Pix]', e.message);
  process.exit(1);
});
