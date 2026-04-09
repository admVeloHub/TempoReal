/**
 * Lista CPFs dos casos N2 (reclamacoes_n2Pix) contados como "Retidos" no card/métricas
 * do Dashboard — mesma lógica que stats.js calcularStatsPorTipo (somaRetidos).
 * VERSION: v1.3.2
 * v1.1.0: tabela CPF + Finalizado.dataResolucao + pixLiberado (fuso STATS_TZ).
 * v1.2.0: exclusão opcional grupo API Outros.
 * v1.3.0: exclusão grupo API Outros (literais).
 * v1.3.1: "Antecipação" = Outros Anos (produto); grupo 2026 só dois literais — MOTIVO_PARAM alinhado a stats.
 * v1.3.2: retido ouvidoria não conta se semRespostaCliente === true (stats.js v1.20.5).
 *
 * Uso (pasta backend, .env com MONGO_ENV):
 *   node scripts/listN2RetidosCpfs.js
 *
 * Opcional:
 *   DATA_INICIO=2026-01-01 DATA_FIM=2026-04-30
 *   PRODUTO=a,b  MOTIVO=c,d  (mesma semântica que GET /api/stats — CSV)
 *   INCLUIR_OUTROS_ANOS=1  — inclui retidos com produto do grupo API Outros (rótulos no header v1.3); padrão: excluídos
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { DateTime } = require('luxon');
const { MongoClient } = require('mongodb');
const {
  normalizeTextOctadesk,
  motivoN1ContaComoLiberacaoParaMetricas,
  expandMotivoLiberacaoChavePixParaMongoIn,
} = require('../services/octadeskIngestService');

const DB = 'hub_ouvidoria';
const COLL_N2 = 'reclamacoes_n2Pix';
const STATS_DATE_ZONE = process.env.STATS_TZ || 'America/Sao_Paulo';

const MOTIVO_LIBERACAO_CHAVE_PIX = 'liberação chave pix';
const MOTIVO_LIBERACAO_CHAVE_PIX_SEM_ACENTO = 'liberacao chave pix';
const MOTIVO_UI_LIBERACAO_CHAVE_PIX = 'Liberação chave pix';

const MOTIVO_PARAM_ALINHA_PRODUTO_OUVIDORIA = {
  'Antecipação - 2026': ['Antecipação - 2026', 'Antecipação 2026'],
  'Antecipação - Outros Anos': ['Antecipação - Outros Anos', 'Antecipacao', 'Antecipação'],
};

/**
 * Grupo API "Outros Anos" — inclui produto literal "Antecipação" (alinhado FiltrosAuxiliar / stats v1.20.2).
 */
function produtoEhGrupoApiOutrosAnos(produto) {
  if (produto == null || String(produto).trim() === '') return false;
  const s = String(produto).trim();
  if (s === 'Antecipação - Outros Anos' || s === 'Antecipacao' || s === 'Antecipação') return true;
  const n = normalizeTextOctadesk(s);
  if (n === normalizeTextOctadesk('Antecipação - Outros Anos')) return true;
  return false;
}

function normalizarDetalheStats(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

const DETALHE_LIBERACAO_CHAVE_PIX_NORM = 'liberacao chave pix';

function motivoContemLiberacaoChavePix(motivoReduzido) {
  const itens = Array.isArray(motivoReduzido)
    ? motivoReduzido
    : motivoReduzido != null && motivoReduzido !== ''
      ? [String(motivoReduzido)]
      : [];
  return itens.some(
    (item) =>
      String(item).trim().toLowerCase() === MOTIVO_LIBERACAO_CHAVE_PIX ||
      String(item).trim().toLowerCase() === MOTIVO_LIBERACAO_CHAVE_PIX_SEM_ACENTO
  );
}

function isDocN1Stats(r) {
  if (r == null) return false;
  const n = r.octadeskNumber;
  return n != null && String(n).trim() !== '' && !Number.isNaN(Number(n));
}

function documentoRetidoContagemN1(r) {
  return r != null && r.retido_no_atendimento === true;
}

function documentoELiberacaoChavePixExclusivo(r) {
  if (r == null) return false;
  const n1 =
    r.octadeskNumber != null &&
    String(r.octadeskNumber).trim() !== '' &&
    !Number.isNaN(Number(r.octadeskNumber));
  if (n1) {
    return motivoN1ContaComoLiberacaoParaMetricas(r.motivoReduzido);
  }
  const mcp = r.motivos_chave_pix;
  if (mcp != null && String(mcp).trim() !== '') {
    return normalizarDetalheStats(mcp) === DETALHE_LIBERACAO_CHAVE_PIX_NORM;
  }
  const det = r.detalhe_2026;
  if (det != null && String(det).trim() !== '') {
    return normalizarDetalheStats(det) === DETALHE_LIBERACAO_CHAVE_PIX_NORM;
  }
  return motivoContemLiberacaoChavePix(r.motivoReduzido);
}

function documentoResolvidoParaMetricas(r) {
  if (r == null) return false;
  if (isDocN1Stats(r)) {
    const name = r.currentStatusName;
    if (name == null || String(name).trim() === '') return false;
    return normalizeTextOctadesk(String(name)) === normalizeTextOctadesk('Resolvido');
  }
  return r.Finalizado != null && r.Finalizado.Resolvido === true;
}

function documentoLiberadoChavePixParaMetricas(r) {
  if (r == null) return false;
  if (isDocN1Stats(r)) {
    return r.retido_no_atendimento === false;
  }
  if (typeof r.retido_no_atendimento === 'boolean') {
    return r.retido_no_atendimento === false;
  }
  if (typeof r.pixLiberado === 'boolean') {
    return r.pixLiberado === true;
  }
  return false;
}

/** Igual somaRetidos em calcularStatsPorTipo (stats.js). */
function documentoContaComoRetidoPorTipoOuvidoria(r) {
  if (isDocN1Stats(r) && documentoRetidoContagemN1(r)) return true;
  if (!documentoELiberacaoChavePixExclusivo(r)) return false;
  if (isDocN1Stats(r)) return false;
  if (r.semRespostaCliente === true) return false;
  return documentoResolvidoParaMetricas(r) && !documentoLiberadoChavePixParaMetricas(r);
}

const CAMPOS_DATA_POR_COLLECTION = {
  reclamacoes_n2Pix: 'dataEntradaN2',
};

function criarFiltroDataPorCollection(collectionName, dataInicio, dataFim) {
  if (!dataInicio && !dataFim) return {};
  const dataInicioDate = dataInicio ? new Date(dataInicio) : null;
  const dataFimDate = dataFim ? new Date(dataFim) : null;
  const condicoesDataInicio = dataInicioDate ? { $gte: dataInicioDate } : {};
  const condicoesDataFim = dataFimDate ? { $lte: dataFimDate } : {};
  const condicoesData = { ...condicoesDataInicio, ...condicoesDataFim };
  const campoData = CAMPOS_DATA_POR_COLLECTION[collectionName];
  if (campoData) {
    return { [campoData]: { $exists: true, $ne: null, ...condicoesData } };
  }
  return { createdAt: condicoesData };
}

function criarFiltroProduto(produtos) {
  if (!produtos || !Array.isArray(produtos) || produtos.length === 0) return {};
  const valores = produtos.filter((p) => p && String(p).trim());
  if (valores.length === 0) return {};
  return { produto: { $in: valores } };
}

function mesclarFiltros(filtroData, filtroProduto, filtroMotivo = {}) {
  return { ...filtroData, ...filtroProduto, ...filtroMotivo };
}

function criarFiltroMotivoItemOuvidoria(m) {
  const t = String(m).trim();
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const produtosLinha = MOTIVO_PARAM_ALINHA_PRODUTO_OUVIDORIA[t];

  if (normalizeTextOctadesk(t) === normalizeTextOctadesk(MOTIVO_UI_LIBERACAO_CHAVE_PIX)) {
    const literaisMongo = expandMotivoLiberacaoChavePixParaMongoIn();
    const porMotivo = {
      $or: [
        { motivoReduzido: { $in: literaisMongo } },
        { motivoReduzido: { $regex: escaped, $options: 'i' } },
        { motivoReduzido: /chave\s*pix/i },
      ],
    };
    if (!produtosLinha) return porMotivo;
    return { $or: [porMotivo, { produto: { $in: produtosLinha } }] };
  }

  const porMotivo = { motivoReduzido: { $regex: escaped, $options: 'i' } };
  if (!produtosLinha) return porMotivo;
  return {
    $or: [porMotivo, { produto: { $in: produtosLinha } }],
  };
}

function criarFiltroMotivo(motivos) {
  if (!motivos || !Array.isArray(motivos) || motivos.length === 0) return {};
  const valores = motivos.filter((m) => m && String(m).trim()).map((m) => String(m).trim());
  if (valores.length === 0) return {};
  const condicoes = valores.map((m) => criarFiltroMotivoItemOuvidoria(m));
  return condicoes.length === 1 ? condicoes[0] : { $or: condicoes };
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

function parseEnvCsv(name) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const uri = process.env.MONGO_ENV;
  if (!uri || typeof uri !== 'string') {
    console.error('[listN2RetidosCpfs] MONGO_ENV ausente.');
    process.exit(1);
  }

  const { dataInicio, dataFim } = intervaloComoStatsDefault();
  const produtos = parseEnvCsv('PRODUTO');
  const motivos = parseEnvCsv('MOTIVO');

  const filtroDataN2 = criarFiltroDataPorCollection('reclamacoes_n2Pix', dataInicio, dataFim);
  const filtroProduto = criarFiltroProduto(produtos);
  const filtroMotivo = criarFiltroMotivo(motivos);
  const filtroN2 = mesclarFiltros(filtroDataN2, filtroProduto, filtroMotivo);

  const client = new MongoClient(uri);
  await client.connect();
  const coll = client.db(DB).collection(COLL_N2);

  const docs = await coll.find(filtroN2).toArray();
  const retidosBrutos = docs.filter(documentoContaComoRetidoPorTipoOuvidoria);
  const incluirOutrosAnos =
    process.env.INCLUIR_OUTROS_ANOS === '1' || String(process.env.INCLUIR_OUTROS_ANOS || '').toLowerCase() === 'true';
  const retidosExclOutros = retidosBrutos.filter((r) => !produtoEhGrupoApiOutrosAnos(r.produto));
  const retidos = incluirOutrosAnos ? retidosBrutos : retidosExclOutros;
  const qtdExclOutros = retidosBrutos.length - retidosExclOutros.length;

  function fmtDataResolucao(d) {
    if (d == null || d === '') return '(sem data)';
    const js = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(js.getTime())) return String(d);
    const dt = DateTime.fromJSDate(js).setZone(STATS_DATE_ZONE);
    if (!dt.isValid) return String(d);
    return dt.toFormat('yyyy-MM-dd HH:mm:ss');
  }

  function fmtPixLiberado(v) {
    if (v === true) return 'true';
    if (v === false) return 'false';
    return 'null';
  }

  retidos.sort((a, b) => {
    const da = a.Finalizado?.dataResolucao != null
      ? new Date(a.Finalizado.dataResolucao).getTime()
      : 0;
    const dbt = b.Finalizado?.dataResolucao != null
      ? new Date(b.Finalizado.dataResolucao).getTime()
      : 0;
    if (da !== dbt) return da - dbt;
    const ca = a.cpf != null ? String(a.cpf).replace(/\D/g, '') : '';
    const cb = b.cpf != null ? String(b.cpf).replace(/\D/g, '') : '';
    return ca.localeCompare(cb, 'pt-BR');
  });

  const linhasTabela = retidos.map((r) => {
    const cpf = r.cpf != null ? String(r.cpf).replace(/\D/g, '') : '(sem cpf)';
    return {
      cpf,
      dataResolucao: fmtDataResolucao(r.Finalizado?.dataResolucao),
      pixLiberado: fmtPixLiberado(r.pixLiberado),
    };
  });

  const wCpf = Math.max(11, ...linhasTabela.map((l) => l.cpf.length), 3);
  const wData = Math.max(10, 'dataResolucao (SP)'.length, ...linhasTabela.map((l) => l.dataResolucao.length));
  const wPix = Math.max('pixLiberado'.length, ...linhasTabela.map((l) => l.pixLiberado.length));

  console.log('[listN2RetidosCpfs] Critério: stats.js calcularStatsPorTipo → somaRetidos (Liberação Chave Pix + resolvido + não liberado + semRespostaCliente≠true; ou N1-stats com retido_no_atendimento).');
  console.log('[listN2RetidosCpfs] Collection:', `${DB}.${COLL_N2}`);
  console.log('[listN2RetidosCpfs] Fuso:', STATS_DATE_ZONE);
  console.log('[listN2RetidosCpfs] Intervalo dataEntradaN2:', dataInicio.toISOString(), '—', dataFim.toISOString());
  console.log('[listN2RetidosCpfs] Filtro Mongo:', JSON.stringify(filtroN2));
  console.log('[listN2RetidosCpfs] Total docs no período (com filtros):', docs.length);
  console.log('[listN2RetidosCpfs] Retidos (critério painel), antes de excl. Outros Anos:', retidosBrutos.length);
  if (!incluirOutrosAnos) {
    console.log(
      '[listN2RetidosCpfs] Excluídos produto Antecipação - Outros Anos (e só "Antecipação" sem ano):',
      qtdExclOutros
    );
  } else {
    console.log('[listN2RetidosCpfs] INCLUIR_OUTROS_ANOS ativo — sem exclusão por produto Outros Anos.');
  }
  console.log('[listN2RetidosCpfs] Contagem na tabela abaixo:', retidos.length);
  console.log('');
  console.log('[listN2RetidosCpfs] Tabela (data = Finalizado.dataResolucao exibida em ' + STATS_DATE_ZONE + '):');
  const sep = `+-${'-'.repeat(wCpf)}-+-${'-'.repeat(wData)}-+-${'-'.repeat(wPix)}-+`;
  const head = `| ${'CPF'.padEnd(wCpf)} | ${'dataResolucao (SP)'.padEnd(wData)} | ${'pixLiberado'.padEnd(wPix)} |`;
  console.log(sep);
  console.log(head);
  console.log(sep);
  for (const l of linhasTabela) {
    console.log(`| ${l.cpf.padEnd(wCpf)} | ${l.dataResolucao.padEnd(wData)} | ${l.pixLiberado.padEnd(wPix)} |`);
  }
  console.log(sep);
  console.log('');
  console.log('[listN2RetidosCpfs] Mesmo conteúdo em TSV (copiar para planilha):');
  console.log('CPF\tdataResolucao_SP\tpixLiberado');
  for (const l of linhasTabela) {
    console.log(`${l.cpf}\t${l.dataResolucao}\t${l.pixLiberado}`);
  }

  await client.close();
}

main().catch((e) => {
  console.error('[listN2RetidosCpfs]', e);
  process.exit(1);
});
