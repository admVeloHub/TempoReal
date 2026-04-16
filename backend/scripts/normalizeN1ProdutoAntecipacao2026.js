/**
 * hub_ouvidoria.reclamações_n1Stats — normalizar campo produto para o rótulo único da linha N1.
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
 * Regra: todo documento N1 deve ter produto === "Antecipação - 2026" (alinhado à UI FiltrosAuxiliar).
 *
 * Relatório (somente leitura):
 *   DRY_RUN=1 node scripts/normalizeN1ProdutoAntecipacao2026.js
 *
 * Aplicar updates (irreversível sem backup):
 *   N1_NORMALIZE_PRODUTO_2026=1 node scripts/normalizeN1ProdutoAntecipacao2026.js
 *
 * Pasta backend; .env com MONGO_ENV. Preferir backup antes (ex.: backupReclamacoesN1StatsJson.js).
 */


const { MongoClient } = require('mongodb');

const DB = 'hub_ouvidoria';
const COLLECTION = 'reclamações_n1Stats';
const PRODUTO_ALVO = 'Antecipação - 2026';

/** Documentos que precisam $set (diferente do alvo, ausente, null ou string vazia). */
const filtroPrecisaAtualizar = {
  $or: [
    { produto: { $exists: false } },
    { produto: null },
    { produto: '' },
    { produto: { $ne: PRODUTO_ALVO } },
  ],
};

async function main() {
  const dry = process.env.DRY_RUN === '1';
  const apply = process.env.N1_NORMALIZE_PRODUTO_2026 === '1';

  if (!dry && !apply) {
    console.error(
      '[normalizeN1ProdutoAntecipacao2026] Defina DRY_RUN=1 (relatório) ou N1_NORMALIZE_PRODUTO_2026=1 (gravar).'
    );
    process.exit(1);
  }
  if (dry && apply) {
    console.log('[normalizeN1ProdutoAntecipacao2026] DRY_RUN=1 tem precedência; nada será gravado.');
  }

  const uri = process.env.MONGO_ENV;
  if (!uri || typeof uri !== 'string') {
    console.error('[normalizeN1ProdutoAntecipacao2026] MONGO_ENV ausente no .env.');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const coll = client.db(DB).collection(COLLECTION);

  const total = await coll.countDocuments({});
  const precisa = await coll.countDocuments(filtroPrecisaAtualizar);
  const jaOk = total - precisa;

  const amostra = await coll
    .aggregate([
      { $match: filtroPrecisaAtualizar },
      { $group: { _id: '$produto', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 15 },
    ])
    .toArray();

  console.log('[normalizeN1ProdutoAntecipacao2026] Coleção:', `${DB}.${COLLECTION}`);
  console.log(`  produto alvo: "${PRODUTO_ALVO}"`);
  console.log(`  total documentos: ${total}`);
  console.log(`  já com produto alvo: ${jaOk}`);
  console.log(`  a atualizar: ${precisa}`);
  if (amostra.length) {
    console.log('  amostra valores atuais (top):');
    for (const row of amostra) {
      const key = row._id === undefined ? '(sem campo)' : row._id === null ? '(null)' : JSON.stringify(row._id);
      console.log(`    ${key}: ${row.n}`);
    }
  }

  if (dry || precisa === 0) {
    await client.close();
    if (dry) console.log('[normalizeN1ProdutoAntecipacao2026] DRY_RUN: nada gravado.');
    if (!dry && precisa === 0) console.log('[normalizeN1ProdutoAntecipacao2026] Nada a fazer.');
    return;
  }

  const now = new Date();
  const res = await coll.updateMany(filtroPrecisaAtualizar, {
    $set: { produto: PRODUTO_ALVO, updatedAt: now },
  });

  console.log('[normalizeN1ProdutoAntecipacao2026] updateMany concluído:');
  console.log(`  matched: ${res.matchedCount}, modified: ${res.modifiedCount}`);

  const restantes = await coll.countDocuments(filtroPrecisaAtualizar);
  if (restantes > 0) {
    console.warn(`[normalizeN1ProdutoAntecipacao2026] Ainda ${restantes} documento(s) fora do alvo (revisar).`);
  }

  await client.close();
}

main().catch((e) => {
  console.error('[normalizeN1ProdutoAntecipacao2026]', e);
  process.exit(1);
});
