/**
 * Lista documentos N1 no mesmo período do GET /api/stats que não entram em nenhum dos três mostradores:
 * Escalado N2, Retidos, Em aberto (critérios idênticos a stats.js calcularStatsCardN1).
 * VERSION: v1.1.0
 *
 * Uso (pasta backend, .env com MONGO_ENV):
 *   node scripts/listN1CardSemClassificacao.js
 *
 * Opcional: DATA_INICIO=2026-01-01 DATA_FIM=2026-04-30 (YYYY-MM-DD) para outro intervalo.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { DateTime } = require('luxon');
const { MongoClient } = require('mongodb');
const {
  normalizeTextOctadesk,
  N1_STATS_COLLECTION,
} = require('../services/octadeskIngestService');
const { criarFiltroPeriodoN1PorCreatedAt } = require('../routes/stats');

const DB = 'hub_ouvidoria';
const STATS_DATE_ZONE = process.env.STATS_TZ || 'America/Sao_Paulo';

const ESCALADO_N2_LABELS_NORMALIZADOS = new Set(
  ['Casos Especiais - Ouvidoria', 'Devolutiva', '-'].map((lab) => normalizeTextOctadesk(lab))
);

function documentoEscaladoN2ContagemN1(r) {
  const v = r?.escalar_chamado;
  if (v == null || String(v).trim() === '') return false;
  return ESCALADO_N2_LABELS_NORMALIZADOS.has(normalizeTextOctadesk(String(v)));
}

function documentoRetidoContagemN1(r) {
  return r != null && r.retido_no_atendimento === true;
}

function documentoEmAbertoN1PorStatus(r) {
  const name = r?.currentStatusName;
  if (name == null || String(name).trim() === '') return true;
  return normalizeTextOctadesk(String(name)) !== normalizeTextOctadesk('Resolvido');
}

/** Não incrementa nenhuma das três linhas do card (soma esc+ret+abr por doc seria 0). */
function emNenhumDosTresMostradores(r) {
  return (
    !documentoEscaladoN2ContagemN1(r) &&
    !documentoRetidoContagemN1(r) &&
    !documentoEmAbertoN1PorStatus(r)
  );
}

function intervaloComoStatsDefault() {
  const inRaw = process.env.DATA_INICIO && String(process.env.DATA_INICIO).trim()
    ? String(process.env.DATA_INICIO).trim()
    : '2026-01-01';
  const dataInicio = DateTime.fromISO(inRaw, { zone: STATS_DATE_ZONE }).startOf('day').toJSDate();
  let dataFim;
  if (process.env.DATA_FIM && String(process.env.DATA_FIM).trim()) {
    dataFim = DateTime.fromISO(String(process.env.DATA_FIM).trim(), { zone: STATS_DATE_ZONE })
      .endOf('day')
      .toJSDate();
  } else {
    dataFim = DateTime.now().setZone(STATS_DATE_ZONE).endOf('day').toJSDate();
  }
  if (dataInicio.getTime() > dataFim.getTime()) {
    throw new Error('DATA_INICIO > DATA_FIM');
  }
  return { dataInicio, dataFim };
}

async function main() {
  const uri = process.env.MONGO_ENV;
  if (!uri || typeof uri !== 'string') {
    console.error('[listN1CardSemClassificacao] MONGO_ENV ausente.');
    process.exit(1);
  }

  const { dataInicio, dataFim } = intervaloComoStatsDefault();
  const filtroN1 = { ...criarFiltroPeriodoN1PorCreatedAt(dataInicio, dataFim) };

  const client = new MongoClient(uri);
  await client.connect();
  const coll = client.db(DB).collection(N1_STATS_COLLECTION);

  const docs = await coll.find(filtroN1).toArray();
  const fora = docs.filter((r) => emNenhumDosTresMostradores(r));

  const esc = docs.filter(documentoEscaladoN2ContagemN1).length;
  const ret = docs.filter(documentoRetidoContagemN1).length;
  const abr = docs.filter(documentoEmAbertoN1PorStatus).length;

  console.log('[listN1CardSemClassificacao] Collection:', `${DB}.${N1_STATS_COLLECTION}`);
  console.log('[listN1CardSemClassificacao] Fuso:', STATS_DATE_ZONE);
  console.log('[listN1CardSemClassificacao] Intervalo createdAt:', dataInicio.toISOString(), '—', dataFim.toISOString());
  console.log('[listN1CardSemClassificacao] Total no período (ocorrências):', docs.length);
  console.log('[listN1CardSemClassificacao] Contagens card (podem sobrepor): Escalado N2=', esc, ' Retidos=', ret, ' Em aberto=', abr);
  console.log('[listN1CardSemClassificacao] Soma esc+ret+abr (não é partição):', esc + ret + abr);
  console.log('[listN1CardSemClassificacao] Docs em nenhum dos três:', fora.length);
  console.log('---');

  for (const r of fora) {
    console.log(
      JSON.stringify(
        {
          octadeskNumber: r.octadeskNumber,
          currentStatusName: r.currentStatusName ?? null,
          retido_no_atendimento: r.retido_no_atendimento,
          escalar_chamado: r.escalar_chamado ?? null,
          motivoReduzido: r.motivoReduzido ?? null,
          createdAt: r.createdAt,
        },
        null,
        2
      )
    );
    console.log('---');
  }

  await client.close();
}

main().catch((e) => {
  console.error('[listN1CardSemClassificacao]', e);
  process.exit(1);
});
