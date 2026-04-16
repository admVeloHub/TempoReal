/**
 * Exportar payloads de octadesk_ingest_log ou reenviar ao webhook local (teste).
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
 * Usa MONGO_ENV do backend/.env (mesmo cluster que Cloud Run se apontar a mesma URI).
 *
 * Listar últimas entregas:
 *   node scripts/ingestLogExportReplay.js --list --limit 15
 *
 * Exportar JSON do payload para pasta (um arquivo por entrega com payload):
 *   node scripts/ingestLogExportReplay.js --export --limit 5 --out ./exported_payloads
 *
 * Reenviar POST para localhost (útil com o mesmo payload que produção gravou):
 *   node scripts/ingestLogExportReplay.js --replay --url http://localhost:5050/api/integrations/octadesk/webhook --limit 3
 * Com segredo local (query octadesk_webhook_key):
 *   node scripts/ingestLogExportReplay.js --replay --url http://localhost:5050/api/integrations/octadesk/webhook --secret SEU_SEGREDO --limit 1
 *
 * Filtrar por outcome:
 *   ... --outcome upsert
 */


const fs = require('fs').promises;
const path = require('path');
const { MongoClient } = require('mongodb');

const DB = 'hub_ouvidoria';
const INGEST_LOG = 'octadesk_ingest_log';

function parseArgs(argv) {
  const opts = {
    help: false,
    list: false,
    export: false,
    replay: false,
    limit: 10,
    outDir: null,
    url: null,
    secret: null,
    outcome: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') opts.list = true;
    else if (a === '--export') opts.export = true;
    else if (a === '--replay') opts.replay = true;
    else if (a === '--limit' && argv[i + 1]) {
      opts.limit = Math.min(500, Math.max(1, parseInt(argv[++i], 10) || 10));
    } else if (a === '--out' && argv[i + 1]) opts.outDir = argv[++i];
    else if (a === '--url' && argv[i + 1]) opts.url = argv[++i];
    else if (a === '--secret' && argv[i + 1]) opts.secret = argv[++i];
    else if (a === '--outcome' && argv[i + 1]) opts.outcome = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

function printHelp() {
  console.log(`ingestLogExportReplay.js — hub_ouvidoria.${INGEST_LOG}

MONGO_ENV obrigatória no .env do backend.

  --list              Resumo: receivedAt, ticket, outcome, tem payload?
  --export            Grava payloads em arquivos JSON (--out DIR obrigatório)
  --replay            POST cada payload para --url (POST JSON)
  --limit N           Padrão 10; máx. 500
  --out DIR           Pasta para --export
  --url URL           URL completa do webhook local/prod para --replay
  --secret VAL        Anexa ?octadesk_webhook_key=VAL (opcional)
  --outcome X         Filtra: upsert | skipped | error
`);
}

function hasUsablePayload(doc) {
  const p = doc?.payload;
  if (p == null || typeof p !== 'object' || Array.isArray(p)) return false;
  if (p._postOriginalNaoArmazenado || p._erro === 'body_deve_ser_objeto_json') return false;
  return true;
}

async function fetchDocs(client, limit, outcome) {
  const db = client.db(DB);
  const match = {};
  if (outcome && ['upsert', 'skipped', 'error'].includes(outcome)) {
    match.outcome = outcome;
  }
  const cursor = db
    .collection(INGEST_LOG)
    .find(Object.keys(match).length ? match : {})
    .sort({ receivedAt: -1 })
    .limit(limit);
  return cursor.toArray();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }
  if (!opts.list && !opts.export && !opts.replay) {
    printHelp();
    process.exit(1);
  }

  const uri = process.env.MONGO_ENV;
  if (!uri || typeof uri !== 'string') {
    console.error('[ingestLogExportReplay] MONGO_ENV não definida no .env do backend.');
    process.exit(1);
  }

  if (opts.export && !opts.outDir) {
    console.error('[ingestLogExportReplay] --export exige --out DIR');
    process.exit(1);
  }
  if (opts.replay && !opts.url) {
    console.error('[ingestLogExportReplay] --replay exige --url https://.../webhook');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const docs = await fetchDocs(client, opts.limit, opts.outcome);
    console.log(`[ingestLogExportReplay] ${docs.length} documento(s) lidos.`);

    if (opts.list) {
      for (const d of docs) {
        const has = hasUsablePayload(d);
        console.log(
          `${d.receivedAt?.toISOString?.() || d.receivedAt}\t#${d.octadeskNumber ?? '—'}\t${d.outcome}\tpayload:${has ? 'sim' : 'não'}\t${d.message || ''}`
        );
      }
      return;
    }

    if (opts.export) {
      await fs.mkdir(opts.outDir, { recursive: true });
      let n = 0;
      for (let i = 0; i < docs.length; i++) {
        const d = docs[i];
        if (!hasUsablePayload(d)) continue;
        const stamp = (d.receivedAt instanceof Date ? d.receivedAt : new Date()).toISOString().replace(/[:.]/g, '-');
        const num = d.octadeskNumber ?? 'x';
        const fname = `ingest_${stamp}_${num}_${i}.json`;
        const fpath = path.join(opts.outDir, fname);
        await fs.writeFile(fpath, JSON.stringify(d.payload, null, 2), 'utf8');
        n++;
        console.log(`[ingestLogExportReplay] gravado ${fpath}`);
      }
      console.log(`[ingestLogExportReplay] exportados ${n} payload(s).`);
      return;
    }

    if (opts.replay) {
      for (let i = 0; i < docs.length; i++) {
        const d = docs[i];
        if (!hasUsablePayload(d)) {
          console.warn(`[ingestLogExportReplay] skip linha ${i}: sem payload utilizável`);
          continue;
        }
        let target = opts.url;
        if (opts.secret) {
          const u = new URL(opts.url);
          u.searchParams.set('octadesk_webhook_key', opts.secret);
          target = u.toString();
        }
        const res = await fetch(target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(d.payload),
        });
        const text = await res.text();
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text.slice(0, 2000) };
        }
        console.log(
          `[ingestLogExportReplay] #${d.octadeskNumber} HTTP ${res.status} ${JSON.stringify(parsed)}`
        );
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error('[ingestLogExportReplay]', e.message);
  process.exit(1);
});
