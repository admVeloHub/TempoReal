/**
 * Auditoria: impacto de duplicidade (mesmo CPF em várias coleções/docs) na contagem de Liberados.
 * Usa os mesmos filtros e predicados que GET /api/stats (auditoriaPainelPredicatesPorDoc.contribuiPixLiberadoCard).
 *
 * VERSION: v1.0.0
 *
 * Uso (pasta backend, MONGO_ENV na FONTE DA VERDADE):
 *   node scripts/auditoriaDuplicidadeLiberadosCpfs.js
 *
 * Filtros (iguais auditoriaCardsStats.js):
 *   DATA_INICIO, DATA_FIM, FILTRO_VAZIO=1, PRODUTO=csv, MOTIVO=csv
 */

/** Node no Windows pode falhar querySrv com DNS do sistema; nslookup/Google resolve o SRV do Atlas. */
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

const COLLECTIONS = {
  bacen: 'reclamacoes_bacen',
  n2: 'reclamacoes_n2Pix',
  ra: 'reclamacoes_reclameAqui',
  procon: 'reclamacoes_procon',
  timePortabilidade: 'reclamacoes_timePortabilidade',
};

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

function docContribuiLiberados(r) {
  const p = statsRoute.auditoriaPainelPredicatesPorDoc(r);
  return Boolean(p && p.contribuiPixLiberadoCard);
}

function keyDoc(collectionName, r) {
  return `${collectionName}:${r._id != null ? String(r._id) : ''}`;
}

function analisarConjuntoLiberados(entradas) {
  /** @type {Map<string, { cpf: string, canal: string, collection: string, id: string }[]>} */
  const porCpf = new Map();
  const semCpf = [];

  for (const e of entradas) {
    const cpf = normalizarCpf(e.doc.cpf);
    if (!cpf) {
      semCpf.push(e);
      continue;
    }
    if (!porCpf.has(cpf)) porCpf.set(cpf, []);
    porCpf.get(cpf).push({
      cpf,
      canal: e.canal,
      collection: e.collection,
      id: e.doc._id != null ? String(e.doc._id) : '',
    });
  }

  const docs = entradas.length;
  const cpfsUnicos = porCpf.size + semCpf.length;
  const inflacaoDocs = docs - cpfsUnicos;

  let intraCanalExtra = 0;
  let crossCanalCpfs = 0;
  let crossCanalExtraDocs = 0;

  porCpf.forEach((lista) => {
    if (lista.length <= 1) return;

    const porCanal = new Map();
    lista.forEach((item) => {
      porCanal.set(item.canal, (porCanal.get(item.canal) || 0) + 1);
    });
    let intraCpf = 0;
    porCanal.forEach((n) => {
      if (n > 1) intraCpf += n - 1;
    });
    intraCanalExtra += intraCpf;

    const numCanais = porCanal.size;
    const inflacaoCpf = lista.length - 1;
    const crossCpf = inflacaoCpf - intraCpf;
    if (numCanais > 1) crossCanalCpfs += 1;
    crossCanalExtraDocs += crossCpf;
  });

  return {
    docs,
    cpfsUnicos,
    semCpfDocs: semCpf.length,
    inflacaoDocs,
    intraCanalExtra,
    crossCanalCpfs,
    crossCanalExtraDocs,
    porCpf,
  };
}

function pct(parte, total) {
  if (!total) return '0.0';
  return ((parte / total) * 100).toFixed(1);
}

function matrizPares(entradas) {
  const canais = ['N1', 'N2', 'Reclame Aqui', 'Bacen', 'Procon'];
  const porCpfCanais = new Map();

  for (const e of entradas) {
    const cpf = normalizarCpf(e.doc.cpf);
    if (!cpf) continue;
    if (!porCpfCanais.has(cpf)) porCpfCanais.set(cpf, new Set());
    porCpfCanais.get(cpf).add(e.canal);
  }

  const pares = {};
  for (let i = 0; i < canais.length; i++) {
    for (let j = i + 1; j < canais.length; j++) {
      const a = canais[i];
      const b = canais[j];
      const chave = `${a} × ${b}`;
      pares[chave] = 0;
    }
  }

  porCpfCanais.forEach((setCanais) => {
    if (setCanais.size < 2) return;
    const arr = [...setCanais].sort();
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const chave = `${arr[i]} × ${arr[j]}`;
        if (pares[chave] != null) pares[chave] += 1;
      }
    }
  });

  return pares;
}

async function main() {
  const uri = process.env.MONGO_ENV;
  if (!uri || typeof uri !== 'string') {
    console.error('[auditoriaDuplicidadeLiberadosCpfs] MONGO_ENV ausente.');
    process.exit(1);
  }

  const dataInicioRaw = (process.env.DATA_INICIO && String(process.env.DATA_INICIO).trim()) || undefined;
  const dataFimRaw = process.env.DATA_FIM;
  const { dataInicio, dataFim } = statsRoute.normalizarIntervaloDatasQueryStats(dataInicioRaw, dataFimRaw);

  const produtos = produtosParaAuditoria();
  const motivos = motivosParaAuditoria();
  const filtroProduto = statsRoute.criarFiltroProduto(produtos);
  const filtroMotivo = statsRoute.criarFiltroMotivo(motivos);

  const filtroDataBacen = statsRoute.criarFiltroDataPorCollection('reclamacoes_bacen', dataInicio, dataFim);
  const filtroDataN2 = statsRoute.criarFiltroDataPorCollection('reclamacoes_n2Pix', dataInicio, dataFim);
  const filtroDataRA = statsRoute.criarFiltroDataPorCollection('reclamacoes_reclameAqui', dataInicio, dataFim);
  const filtroDataProcon = statsRoute.criarFiltroDataPorCollection('reclamacoes_procon', dataInicio, dataFim);
  const filtroDataTimePort = statsRoute.criarFiltroDataPorCollection('reclamacoes_timePortabilidade', dataInicio, dataFim);

  const filtroBacen = statsRoute.mesclarFiltros(filtroDataBacen, filtroProduto, filtroMotivo);
  const filtroN2 = statsRoute.mesclarFiltros(filtroDataN2, filtroProduto, filtroMotivo);
  const filtroRA = statsRoute.mesclarFiltros(filtroDataRA, filtroProduto, filtroMotivo);
  const filtroProcon = statsRoute.mesclarFiltros(filtroDataProcon, filtroProduto, filtroMotivo);
  const filtroTimePortabilidade = statsRoute.mesclarFiltros(filtroDataTimePort, filtroProduto, filtroMotivo);

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB);

  const [bacen, n2Pix, reclameAquiDocs, proconDocs, timePortabilidadeDocs] = await Promise.all([
    db.collection(COLLECTIONS.bacen).find(filtroBacen).toArray(),
    db.collection(COLLECTIONS.n2).find(filtroN2).toArray(),
    db.collection(COLLECTIONS.ra).find(filtroRA).toArray(),
    db.collection(COLLECTIONS.procon).find(filtroProcon).toArray(),
    db.collection(COLLECTIONS.timePortabilidade).find(filtroTimePortabilidade).toArray(),
  ]);

  await client.close();

  const canaisConfig = [
    { canal: 'N1', collection: COLLECTIONS.timePortabilidade, docs: timePortabilidadeDocs },
    { canal: 'N2', collection: COLLECTIONS.n2, docs: n2Pix },
    { canal: 'Reclame Aqui', collection: COLLECTIONS.ra, docs: reclameAquiDocs },
    { canal: 'Bacen', collection: COLLECTIONS.bacen, docs: bacen },
    { canal: 'Procon', collection: COLLECTIONS.procon, docs: proconDocs },
  ];

  const todas = [...bacen, ...n2Pix, ...reclameAquiDocs, ...proconDocs, ...timePortabilidadeDocs];
  const porTipo = {
    N1: statsRoute.calcularStatsPorTipo(timePortabilidadeDocs),
    N2: statsRoute.calcularStatsPorTipo(n2Pix),
    'Reclame Aqui': statsRoute.calcularStatsPorTipo(reclameAquiDocs),
    Bacen: statsRoute.calcularStatsPorTipo(bacen),
    Procon: statsRoute.calcularStatsPorTipo(proconDocs),
    Total: statsRoute.calcularStatsPorTipo(todas),
  };

  const liberadosPorCanal = [];
  const todasEntradasLiberados = [];

  for (const { canal, collection, docs } of canaisConfig) {
    const liberados = docs.filter(docContribuiLiberados);
    const entradas = liberados.map((doc) => ({ canal, collection, doc }));
    todasEntradasLiberados.push(...entradas);
    const analise = analisarConjuntoLiberados(entradas);
    liberadosPorCanal.push({
      canal,
      collection,
      painelLiberados: porTipo[canal === 'N1' ? 'N1' : canal]?.pixLiberado ?? liberados.length,
      docsLiberados: liberados.length,
      cpfsUnicos: analise.cpfsUnicos,
      semCpfDocs: analise.semCpfDocs,
      inflacaoDocs: analise.inflacaoDocs,
      intraCanalExtra: analise.intraCanalExtra,
      crossCanalExtraDocs: analise.crossCanalExtraDocs,
    });
  }

  const analiseTotal = analisarConjuntoLiberados(todasEntradasLiberados);
  const pares = matrizPares(todasEntradasLiberados);

  let pixTrueNaoLiberado = 0;
  for (const doc of todas) {
    if (doc.pixLiberado === true && !docContribuiLiberados(doc)) pixTrueNaoLiberado += 1;
  }

  const topCpfsMulti = [];
  analiseTotal.porCpf.forEach((lista, cpf) => {
    if (lista.length < 2) return;
    const canaisSet = [...new Set(lista.map((x) => x.canal))];
    topCpfsMulti.push({
      cpf,
      docs: lista.length,
      canais: canaisSet.join(', '),
    });
  });
  topCpfsMulti.sort((a, b) => b.docs - a.docs);
  const top20 = topCpfsMulti.slice(0, 20);

  const agora = DateTime.now().setZone(STATS_DATE_ZONE);
  const stamp = agora.toFormat('yyyy-MM-dd_HHmmss');
  const dirOut = path.join(__dirname, '..', 'reports');
  const arquivo = path.join(dirOut, `auditoria_duplicidade_liberados_${stamp}.txt`);

  const linhas = [
    'AUDITORIA — DUPLICIDADE NA CONTAGEM DE LIBERADOS (PAINEL)',
    '==========================================================',
    `Gerado: ${agora.toFormat('yyyy-MM-dd HH:mm:ss')} (${STATS_DATE_ZONE})`,
    'Script: backend/scripts/auditoriaDuplicidadeLiberadosCpfs.js v1.0.0',
    'Critério Liberados: auditoriaPainelPredicatesPorDoc.contribuiPixLiberadoCard (paridade GET /api/stats)',
    '',
    'FILTROS',
    '-------',
    `dataInicio: ${dataInicioRaw ?? '(padrão 2026-01-01)'}`,
    `dataFim:    ${dataFimRaw ?? '(padrão hoje)'}`,
    `produtos:   ${JSON.stringify(produtos)}`,
    `motivos:    ${JSON.stringify(motivos)}`,
    '',
    'RESUMO EXECUTIVO — IMPACTO NA CONTAGEM',
    '--------------------------------------',
    `Liberados no painel (Total.pixLiberado):     ${porTipo.Total.pixLiberado}`,
    `Documentos classificados como liberados:    ${analiseTotal.docs}`,
    `CPFs únicos (entre docs com CPF):           ${analiseTotal.cpfsUnicos}`,
    `Documentos liberados sem CPF:              ${analiseTotal.semCpfDocs}`,
    `Inflação total (docs − CPFs únicos):         ${analiseTotal.inflacaoDocs} (${pct(analiseTotal.inflacaoDocs, analiseTotal.docs)}% a mais que contagem por CPF)`,
    `  └ extra por mesmo CPF em vários canais:   ${analiseTotal.crossCanalExtraDocs} docs (${analiseTotal.crossCanalCpfs} CPFs em 2+ canais)`,
    `  └ extra no mesmo canal (mesmo CPF 2+ docs): ${analiseTotal.intraCanalExtra} docs`,
    '',
    'Se o painel contasse 1 liberado por CPF (hipotético), Total seria:',
    `  ${analiseTotal.cpfsUnicos} (redução de ${analiseTotal.inflacaoDocs} em relação ao atual)`,
    '',
    'pixLiberado=true mas NÃO entra em Liberados (regra resolvido/universo):',
    `  ${pixTrueNaoLiberado} documentos no recorte filtrado`,
    '',
    'POR CANAL — PAINEL vs CPF ÚNICO',
    '-------------------------------',
  ];

  for (const c of liberadosPorCanal) {
    linhas.push(
      '',
      `--- ${c.canal} (${c.collection}) ---`,
      `  Liberados painel (pixLiberado card): ${c.painelLiberados}`,
      `  Docs liberados (auditoria):        ${c.docsLiberados}`,
      `  CPFs únicos:                       ${c.cpfsUnicos}`,
      `  Inflação (docs − CPFs):            ${c.inflacaoDocs} (${pct(c.inflacaoDocs, c.docsLiberados)}%)`,
      `  Extra mesmo CPF, mesmo canal:      ${c.intraCanalExtra} docs`,
    );
  }

  linhas.push(
    '',
    'CPFs LIBERADOS EM MAIS DE UM CANAL (pares com contagem ≥ 1)',
    '-----------------------------------------------------------',
  );
  Object.entries(pares)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .forEach(([par, n]) => {
      linhas.push(`  ${par}: ${n} CPF(s)`);
    });
  const nenhumPar = Object.values(pares).every((n) => n === 0);
  if (nenhumPar) linhas.push('  (nenhum CPF liberado em dois canais distintos no período/filtro)');

  linhas.push(
    '',
    'TOP 20 CPFs — MAIS DOCUMENTOS LIBERADOS (cross ou intra canal)',
    '--------------------------------------------------------------',
  );
  if (top20.length === 0) {
    linhas.push('  (nenhum CPF com 2+ documentos liberados)');
  } else {
    top20.forEach((t, i) => {
      linhas.push(`  ${i + 1}. CPF ${t.cpf} — ${t.docs} docs — canais: ${t.canais}`);
    });
  }

  linhas.push('', '— Fim —');

  fs.mkdirSync(dirOut, { recursive: true });
  fs.writeFileSync(arquivo, linhas.join('\n'), 'utf8');

  console.log('[auditoriaDuplicidadeLiberadosCpfs] Arquivo:', arquivo);
  console.log('[auditoriaDuplicidadeLiberadosCpfs] RESUMO:');
  console.log(`  Total Liberados painel: ${porTipo.Total.pixLiberado}`);
  console.log(`  Docs liberados:         ${analiseTotal.docs}`);
  console.log(`  CPFs únicos:            ${analiseTotal.cpfsUnicos}`);
  console.log(`  Inflação total:         ${analiseTotal.inflacaoDocs} (${pct(analiseTotal.inflacaoDocs, analiseTotal.docs)}%)`);
  console.log(`  Cross-canal (CPFs):     ${analiseTotal.crossCanalCpfs} | docs extras: ${analiseTotal.crossCanalExtraDocs}`);
  liberadosPorCanal.forEach((c) => {
    console.log(
      `  ${c.canal}: painel=${c.painelLiberados} docs=${c.docsLiberados} cpfs=${c.cpfsUnicos} inflação=${c.inflacaoDocs}`
    );
  });
}

main().catch((e) => {
  console.error('[auditoriaDuplicidadeLiberadosCpfs]', e);
  process.exit(1);
});
