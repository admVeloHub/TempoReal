/**
 * Reset operacional do ingest Octadesk (logs e opcionalmente N1 no Mongo).
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
 * Uso (na pasta backend, com .env carregado):
 *   RESET_OCTADESK_INGEST=1 node scripts/resetOctadeskIngest.js
 *
 * Opcional — também apaga documentos em reclamações_n1Stats (métricas N1):
 *   RESET_OCTADESK_INGEST=1 RESET_N1_STATS=1 node scripts/resetOctadeskIngest.js
 *
 * Irreversível no banco apontado por MONGO_ENV. Não executar em produção sem intenção explícita.
 */


const { MongoClient } = require('mongodb');

const DB = 'hub_ouvidoria';
const INGEST_LOG = 'octadesk_ingest_log';
const N1_STATS = 'reclamações_n1Stats';

async function main() {
  if (process.env.RESET_OCTADESK_INGEST !== '1') {
    console.error(
      '[resetOctadeskIngest] Para confirmar, defina RESET_OCTADESK_INGEST=1 (apaga dados no Mongo de MONGO_ENV).'
    );
    process.exit(1);
  }
  const uri = process.env.MONGO_ENV;
  if (!uri || typeof uri !== 'string') {
    console.error('[resetOctadeskIngest] MONGO_ENV não definida no .env.');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB);

  const logDel = await db.collection(INGEST_LOG).deleteMany({});
  console.log(`[resetOctadeskIngest] ${INGEST_LOG}: removidos ${logDel.deletedCount} documento(s).`);

  if (process.env.RESET_N1_STATS === '1') {
    const n1Del = await db.collection(N1_STATS).deleteMany({});
    console.log(`[resetOctadeskIngest] ${N1_STATS}: removidos ${n1Del.deletedCount} documento(s).`);
  } else {
    console.log(`[resetOctadeskIngest] ${N1_STATS}: não alterado (defina RESET_N1_STATS=1 para apagar também).`);
  }

  await client.close();
  console.log('[resetOctadeskIngest] Concluído. Reinicie o backend (npm start) se estiver rodando.');
}

main().catch((e) => {
  console.error('[resetOctadeskIngest]', e.message);
  process.exit(1);
});
