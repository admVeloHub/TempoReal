/**
 * Painel Reclamações — acompanhamento de octadesk_ingest_log no terminal (dev / pré-prod).
 * VERSION: v1.0.0
 *
 * Com OCTADESK_INGEST_TAIL_CONSOLE=1 o backend faz polling em hub_ouvidoria.octadesk_ingest_log
 * e loga novas inserções (ex.: feitas pelo Cloud Run no mesmo MONGO_ENV).
 * Opcional: OCTADESK_INGEST_TAIL_BOOT_LAST=N imprime os N registros mais recentes ao subir.
 */

const { INGEST_LOG_COLLECTION } = require('./octadeskIngestService');

const DB_NAME = 'hub_ouvidoria';

function formatLine(doc) {
  const received =
    doc.receivedAt instanceof Date ? doc.receivedAt.toISOString() : String(doc.receivedAt ?? '');
  const n = doc.octadeskNumber ?? '—';
  const oc = doc.outcome ?? '?';
  const msg = (doc.message || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const p = doc.payload;
  const hasPayload =
    p != null &&
    typeof p === 'object' &&
    !Array.isArray(p) &&
    !p._postOriginalNaoArmazenado;
  return `[octadesk_ingest_tail] ${received} | #${n} | ${oc} | payload:${hasPayload ? 'sim' : 'não'} | ${msg}`;
}

function maxDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * Inicia polling no cliente Mongo já conectado. Retorna função stop().
 */
function startOctadeskIngestLogTailConsole(client) {
  if (process.env.OCTADESK_INGEST_TAIL_CONSOLE !== '1') {
    return () => {};
  }

  const intervalMs = Math.max(
    1000,
    parseInt(String(process.env.OCTADESK_INGEST_TAIL_MS || '2500'), 10) || 2500
  );
  const bootLast = Math.min(
    50,
    Math.max(0, parseInt(String(process.env.OCTADESK_INGEST_TAIL_BOOT_LAST || '0'), 10) || 0)
  );

  const coll = client.db(DB_NAME).collection(INGEST_LOG_COLLECTION);
  let lastAfter = new Date();
  let timer = null;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const rows = await coll
        .find({ receivedAt: { $gt: lastAfter } })
        .sort({ receivedAt: 1 })
        .limit(100)
        .toArray();
      for (const doc of rows) {
        console.log(formatLine(doc));
        if (doc.receivedAt instanceof Date) {
          lastAfter = maxDate(lastAfter, doc.receivedAt);
        }
      }
    } catch (e) {
      console.warn('[octadesk_ingest_tail]', e.message || e);
    }
  };

  const run = async () => {
    if (bootLast > 0) {
      try {
        const recent = await coll.find({}).sort({ receivedAt: -1 }).limit(bootLast).toArray();
        console.log(`[octadesk_ingest_tail] últimos ${recent.length} no log (boot):`);
        for (const doc of recent.slice().reverse()) {
          console.log(formatLine(doc));
        }
        for (const doc of recent) {
          if (doc.receivedAt instanceof Date) {
            lastAfter = maxDate(lastAfter, doc.receivedAt);
          }
        }
      } catch (e) {
        console.warn('[octadesk_ingest_tail] boot snapshot:', e.message || e);
      }
    }

    console.log(
      `[octadesk_ingest_tail] polling ${intervalMs}ms em ${DB_NAME}.${INGEST_LOG_COLLECTION} — eventos novos após este instante (ou após boot snapshot).`
    );
    timer = setInterval(tick, intervalMs);
    tick();
  };

  run();

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}

module.exports = {
  startOctadeskIngestLogTailConsole,
};
