/**
 * Painel Reclamações Tempo Real - Octa supervisão (webhook paralelo + snapshot horário)
 * VERSION: v1.0.1
 *
 * DB octa_supervisao: tickets_abertura, hourly_snapshot. Não altera hub_ouvidoria.
 */

const cron = require('node-cron');
const { DateTime } = require('luxon');

const DB_NAME = 'octa_supervisao';
const TICKETS_COLLECTION = 'tickets_abertura';
const SNAPSHOT_COLLECTION = 'hourly_snapshot';

const DEFAULT_TZ = 'America/Sao_Paulo';
const TICKET_NUMBERS_SAMPLE_MAX = 500;

function getSupervisaoTz() {
  return process.env.OCTA_SUPERVISAO_TZ || DEFAULT_TZ;
}

function parseBaselinePerHour() {
  const raw = process.env.OCTA_SUPERVISAO_BASELINE_PER_HOUR;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Prioridade TopicName / TopicGroupName (igual ao topicProduto em octadeskIngestService.buildMergedSet).
 */
function extractCategoriaAssunto(body) {
  if (!body || typeof body !== 'object') return '';
  if (body.TopicName != null && String(body.TopicName).trim()) {
    return String(body.TopicName).trim();
  }
  if (body.TopicGroupName != null && String(body.TopicGroupName).trim()) {
    return String(body.TopicGroupName).trim();
  }
  return '';
}

/**
 * Custom fields no padrão motivo_<categoria> (ex.: motivo_2026). Tie-break: motivo_2026 (case-insensitive), senão lexicográfico.
 */
function extractMotivoFromCustomFields(cf) {
  if (!cf || typeof cf !== 'object') {
    return { motivo: '', motivoFieldKey: null };
  }
  const keys = Object.keys(cf).filter((k) => k.toLowerCase().startsWith('motivo_'));
  const nonEmpty = keys.filter((k) => {
    const v = cf[k];
    return v != null && String(v).trim() !== '';
  });
  if (nonEmpty.length === 0) {
    return { motivo: '', motivoFieldKey: null };
  }
  const preferred =
    nonEmpty.find((k) => k.toLowerCase() === 'motivo_2026') ||
    [...nonEmpty].sort((a, b) => a.localeCompare(b, 'pt-BR'))[0];
  return { motivo: String(cf[preferred]).trim(), motivoFieldKey: preferred };
}

/**
 * Upsert 1 doc por octadeskNumber. Falhas devem ser capturadas pelo chamador ou aqui não lançar — preferir try/catch no webhook.
 */
async function upsertTicketAbertura(client, body) {
  if (!body || typeof body !== 'object') return;
  const numRaw = body.Number;
  if (numRaw == null || numRaw === '' || Number.isNaN(Number(numRaw))) return;

  const num = Number(numRaw);
  const cf = body.CustomField && typeof body.CustomField === 'object' ? body.CustomField : {};
  const { motivo, motivoFieldKey } = extractMotivoFromCustomFields(cf);
  const categoriaAssunto = extractCategoriaAssunto(body);
  const now = new Date();

  const db = client.db(DB_NAME);
  const setFields = {
    lastSeenAt: now,
    categoriaAssunto,
    motivo,
    motivoFieldKey: motivoFieldKey || null,
    updatedAt: now,
  };

  await db.collection(TICKETS_COLLECTION).updateOne(
    { octadeskNumber: num },
    {
      $setOnInsert: { firstSeenAt: now, octadeskNumber: num },
      $set: setFields,
    },
    { upsert: true }
  );
}

async function ensureOctaSupervisaoIndexes(client) {
  const db = client.db(DB_NAME);
  const tickets = db.collection(TICKETS_COLLECTION);
  const snaps = db.collection(SNAPSHOT_COLLECTION);
  await tickets.createIndex({ octadeskNumber: 1 }, { unique: true });
  await tickets.createIndex({ firstSeenAt: 1 });
  await tickets.createIndex({ lastSeenAt: -1 });
  await snaps.createIndex({ bucketStart: 1, timezone: 1 }, { unique: true });
}

/**
 * Janela da hora anterior completa no fuso configurado (intervalo [bucketStart, bucketEnd)).
 */
function previousHourBoundsInTimezone(timeZone) {
  const zone = timeZone || DEFAULT_TZ;
  const end = DateTime.now().setZone(zone).startOf('hour');
  const start = end.minus({ hours: 1 });
  return {
    bucketStart: start.toJSDate(),
    bucketEnd: end.toJSDate(),
    timezone: zone,
  };
}

/**
 * Agrega tickets com firstSeenAt na janela; grava/atualiza hourly_snapshot; opcionalmente chama IA.
 */
async function buildAndSaveHourlySnapshot(client, bucketStart, bucketEnd, timezone) {
  const db = client.db(DB_NAME);
  const coll = db.collection(TICKETS_COLLECTION);

  const [facetResult] = await coll
    .aggregate([
      {
        $match: {
          firstSeenAt: { $gte: bucketStart, $lt: bucketEnd },
        },
      },
      {
        $facet: {
          total: [{ $count: 'n' }],
          byCat: [{ $group: { _id: '$categoriaAssunto', c: { $sum: 1 } } }],
          byMotivo: [{ $group: { _id: '$motivo', c: { $sum: 1 } } }],
          numbers: [
            { $project: { _id: 0, octadeskNumber: 1 } },
            { $limit: TICKET_NUMBERS_SAMPLE_MAX },
          ],
        },
      },
    ])
    .toArray();

  const totalArr = facetResult?.total || [];
  const novosTicketsNaHora = totalArr[0]?.n ?? 0;

  const porCategoria = {};
  for (const row of facetResult?.byCat || []) {
    const k = row._id === null || row._id === undefined ? '' : String(row._id);
    porCategoria[k] = row.c;
  }
  const porMotivo = {};
  for (const row of facetResult?.byMotivo || []) {
    const k = row._id === null || row._id === undefined ? '' : String(row._id);
    porMotivo[k] = row.c;
  }
  const ticketNumbersSample = (facetResult?.numbers || []).map((r) => r.octadeskNumber);

  const baselineMedia = parseBaselinePerHour();
  const baseline = {};
  if (baselineMedia != null) baseline.mediaEsperadaPorHora = baselineMedia;

  const now = new Date();
  const doc = {
    bucketStart,
    bucketEnd,
    timezone,
    totais: {
      novosTicketsNaHora,
      porCategoria,
      porMotivo,
    },
    ticketNumbersSample,
    ticketCount: novosTicketsNaHora,
    baseline: Object.keys(baseline).length ? baseline : {},
    aiRequestAt: null,
    aiResponse: null,
    aiModel: null,
    flags: {
      surgeHora: false,
      surgeDia: false,
    },
    createdAt: now,
    updatedAt: now,
  };

  await db.collection(SNAPSHOT_COLLECTION).replaceOne(
    { bucketStart, timezone },
    doc,
    { upsert: true }
  );

  const saved = await db.collection(SNAPSHOT_COLLECTION).findOne({ bucketStart, timezone });
  return saved;
}

async function enrichSnapshotWithAiAndPersist(client, snapshotDoc) {
  const url = process.env.OCTA_SUPERVISAO_AI_URL;
  if (!url || !snapshotDoc?._id) return snapshotDoc;

  const key = process.env.OCTA_SUPERVISAO_AI_KEY || '';
  const model = process.env.OCTA_SUPERVISAO_AI_MODEL || '';

  const payload = {
    bucketStart: snapshotDoc.bucketStart,
    bucketEnd: snapshotDoc.bucketEnd,
    timezone: snapshotDoc.timezone,
    totais: snapshotDoc.totais,
    baseline: snapshotDoc.baseline,
    ticketCount: snapshotDoc.ticketCount,
  };

  const headers = {
    'Content-Type': 'application/json',
  };
  if (key) headers.Authorization = `Bearer ${key}`;

  const aiRequestAt = new Date();
  let parsed = null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ snapshot: payload, model: model || undefined }),
    });
    const aiText = await res.text();
    try {
      parsed = JSON.parse(aiText);
    } catch (_e) {
      parsed = { raw: aiText.slice(0, 50_000) };
    }
  } catch (err) {
    parsed = { error: err.message || String(err) };
  }

  const flags = {
    surgeHora: Boolean(parsed?.surgeHora ?? parsed?.flags?.surgeHora),
    surgeDia: Boolean(parsed?.surgeDia ?? parsed?.flags?.surgeDia),
  };

  const db = client.db(DB_NAME);
  await db.collection(SNAPSHOT_COLLECTION).updateOne(
    { _id: snapshotDoc._id },
    {
      $set: {
        aiRequestAt,
        aiResponse: parsed,
        aiModel: model || null,
        flags,
        updatedAt: new Date(),
      },
    }
  );

  return {
    ...snapshotDoc,
    aiRequestAt,
    aiResponse: parsed,
    aiModel: model || null,
    flags,
  };
}

/**
 * Executa snapshot da hora anterior + IA (se URL configurada).
 */
async function runHourlySupervisaoJob(client) {
  const { bucketStart, bucketEnd, timezone } = previousHourBoundsInTimezone(getSupervisaoTz());
  const saved = await buildAndSaveHourlySnapshot(client, bucketStart, bucketEnd, timezone);
  let afterAi = saved;
  if (process.env.OCTA_SUPERVISAO_AI_URL && saved) {
    afterAi = await enrichSnapshotWithAiAndPersist(client, saved);
  }
  return {
    bucketStart,
    bucketEnd,
    timezone,
    novosTicketsNaHora: saved?.totais?.novosTicketsNaHora ?? 0,
    snapshotId: saved?._id?.toString?.() || null,
    aiEnriched: Boolean(process.env.OCTA_SUPERVISAO_AI_URL && afterAi?.aiRequestAt),
  };
}

function validateSupervisaoRunSecret(req) {
  const secret = process.env.OCTA_SUPERVISAO_RUN_SECRET;
  if (!secret) return false;
  const header = req.get('x-octa-supervisao-secret');
  return header === secret;
}

let cronTask = null;

function registerOctaSupervisaoCron(connectToMongo) {
  if (process.env.OCTA_SUPERVISAO_CRON_ENABLED !== '1' && process.env.OCTA_SUPERVISAO_CRON_ENABLED !== 'true') {
    return;
  }
  if (cronTask) return;

  const tz = getSupervisaoTz();
  cronTask = cron.schedule(
    '5 * * * *',
    async () => {
      try {
        const client = await connectToMongo();
        const r = await runHourlySupervisaoJob(client);
        console.log('[octaSupervisao] hourly job OK', r.snapshotId, 'novos=', r.novosTicketsNaHora);
      } catch (e) {
        console.error('[octaSupervisao] hourly job:', e.message);
      }
    },
    { timezone: tz }
  );
  console.log(`[octaSupervisao] cron ativo (minuto 5, TZ ${tz})`);
}

module.exports = {
  DB_NAME,
  TICKETS_COLLECTION,
  SNAPSHOT_COLLECTION,
  getSupervisaoTz,
  extractCategoriaAssunto,
  extractMotivoFromCustomFields,
  upsertTicketAbertura,
  ensureOctaSupervisaoIndexes,
  previousHourBoundsInTimezone,
  buildAndSaveHourlySnapshot,
  enrichSnapshotWithAiAndPersist,
  runHourlySupervisaoJob,
  validateSupervisaoRunSecret,
  registerOctaSupervisaoCron,
};
