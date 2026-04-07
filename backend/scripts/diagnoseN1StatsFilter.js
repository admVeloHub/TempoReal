/**
 * Diagnóstico: hub_ouvidoria.reclamações_n1Stats vs filtro N1 do GET /api/stats.
 * VERSION: v1.3.1
 *
 * Uso (pasta backend, .env com MONGO_ENV):
 *   node scripts/diagnoseN1StatsFilter.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { DateTime } = require('luxon');
const { MongoClient } = require('mongodb');

const STATS_DATE_ZONE = process.env.STATS_TZ || 'America/Sao_Paulo';
const { criarFiltroPeriodoN1PorCreatedAt } = require('../routes/stats');

const DB = 'hub_ouvidoria';
const COLLECTION = 'reclamações_n1Stats';

function parseDatasComoStatsGet(dataInicioRaw, dataFimRaw) {
  const defaultInicio = '2026-01-01';
  const inRaw = (dataInicioRaw && String(dataInicioRaw).trim()) || defaultInicio;
  const mIn = /^(\d{4})-(\d{2})-(\d{2})$/.exec(inRaw);
  let dataInicio = mIn
    ? DateTime.fromISO(`${mIn[1]}-${mIn[2]}-${mIn[3]}`, { zone: STATS_DATE_ZONE }).startOf('day').toJSDate()
    : null;
  if (!dataInicio || Number.isNaN(dataInicio.getTime())) {
    dataInicio = DateTime.fromISO(defaultInicio, { zone: STATS_DATE_ZONE }).startOf('day').toJSDate();
  }
  let dataFim;
  if (dataFimRaw && String(dataFimRaw).trim()) {
    const mF = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dataFimRaw).trim());
    dataFim = mF
      ? DateTime.fromISO(`${mF[1]}-${mF[2]}-${mF[3]}`, { zone: STATS_DATE_ZONE }).endOf('day').toJSDate()
      : DateTime.now().setZone(STATS_DATE_ZONE).endOf('day').toJSDate();
  } else {
    dataFim = DateTime.now().setZone(STATS_DATE_ZONE).endOf('day').toJSDate();
  }
  if (dataInicio.getTime() > dataFim.getTime()) {
    const di = DateTime.fromJSDate(dataInicio, { zone: STATS_DATE_ZONE });
    const df = DateTime.fromJSDate(dataFim, { zone: STATS_DATE_ZONE });
    dataInicio = df.startOf('day').toJSDate();
    dataFim = di.endOf('day').toJSDate();
  }
  return { dataInicio, dataFim };
}

function tsCampo(v) {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Espelha criarFiltroPeriodoN1PorCreatedAt (só createdAt). */
function pseudoMatchPeriodoN1(d, dataInicio, dataFim) {
  const lo = dataInicio.getTime();
  const hi = dataFim.getTime();
  const c = tsCampo(d.createdAt);
  return c != null && c >= lo && c <= hi;
}

function replacerRegex(key, value) {
  if (value instanceof RegExp) return value.toString();
  return value;
}

async function main() {
  const uri = process.env.MONGO_ENV;
  if (!uri || typeof uri !== 'string') {
    console.error('[diagnoseN1StatsFilter] MONGO_ENV não definida no .env.');
    process.exit(1);
  }

  const { dataInicio, dataFim } = parseDatasComoStatsGet('2026-01-01', undefined);
  const filtroN1 = { ...criarFiltroPeriodoN1PorCreatedAt(dataInicio, dataFim) };

  const client = new MongoClient(uri);
  await client.connect();
  const coll = client.db(DB).collection(COLLECTION);

  const total = await coll.countDocuments({});
  const matched = await coll.countDocuments(filtroN1);

  const docs = await coll
    .find({})
    .project({
      octadeskNumber: 1,
      produto: 1,
      motivoReduzido: 1,
      createdAt: 1,
    })
    .toArray();

  await client.close();

  console.log(
    `[diagnoseN1StatsFilter] Alinhado ao GET /api/stats (stats v1.19.1+): createdAt (${STATS_DATE_ZONE}); sem filtro produto/motivo na query N1`
  );
  console.log('[diagnoseN1StatsFilter] Total documentos na collection:', total);
  console.log('[diagnoseN1StatsFilter] Documentos que passam filtroN1 (como GET /api/stats):', matched);
  console.log('[diagnoseN1StatsFilter] filtroN1 JSON:', JSON.stringify(filtroN1, replacerRegex, 2));

  for (const d of docs) {
    const ok = pseudoMatchPeriodoN1(d, dataInicio, dataFim);
    console.log(
      `[ticket ${d.octadeskNumber}] produto="${d.produto ?? ''}" motivoReduzido="${d.motivoReduzido ?? ''}" | periodoOK=${ok}`
    );
    if (d.createdAt) console.log(`    createdAt: ${d.createdAt.toISOString?.() || d.createdAt}`);
  }
}

main().catch((e) => {
  console.error('[diagnoseN1StatsFilter]', e);
  process.exit(1);
});
