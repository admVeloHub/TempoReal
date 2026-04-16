/**
 * Exporta hub_ouvidoria.reclamações_n1Stats para JSON (Extended JSON relaxado, BSON).
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
 * Uso (pasta backend, .env com MONGO_ENV):
 *   node scripts/backupReclamacoesN1StatsJson.js
 *
 * Arquivo: backend/backups/reclamacoes_n1Stats_<timestamp>.json
 */


const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');

const DB = 'hub_ouvidoria';
const COLLECTION = 'reclamações_n1Stats';

function timestampFilePart() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

async function main() {
  const uri = process.env.MONGO_ENV;
  if (!uri || typeof uri !== 'string') {
    console.error('[backupReclamacoesN1StatsJson] MONGO_ENV não definida no .env.');
    process.exit(1);
  }

  const backupsDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const fileName = `reclamacoes_n1Stats_${timestampFilePart()}.json`;
  const outPath = path.join(backupsDir, fileName);

  const client = new MongoClient(uri);
  await client.connect();
  const docs = await client.db(DB).collection(COLLECTION).find({}).toArray();
  await client.close();

  const json = EJSON.stringify(docs, { relaxed: true, legacy: false });
  fs.writeFileSync(outPath, json, 'utf8');

  console.log(`[backupReclamacoesN1StatsJson] ${docs.length} documento(s) → ${outPath}`);
}

main().catch((e) => {
  console.error('[backupReclamacoesN1StatsJson]', e.message);
  process.exit(1);
});
