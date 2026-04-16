/**
 * Excel — relatório base ouvidoria (paridade com scripts/relatorioOuvidoria4AbasTotaisExcel.js + aba Time Portabilidade).
 * VERSION: v1.0.2
 * v1.0.2: DateTime obtido via require('luxon').DateTime dentro de dataReferenciaLuxon (evita ReferenceError se o processo carregar módulo antigo).
 * v1.0.1: require luxon DateTime (correção ReferenceError no GET /relatorio-ouvidoria-base).
 */

const ExcelJS = require('exceljs');

const DB = 'hub_ouvidoria';

function requireStatsHelpers() {
  return require('../routes/stats');
}

const ABAS = [
  { sheet: 'n2pix', collection: 'reclamacoes_n2Pix' },
  { sheet: 'procon', collection: 'reclamacoes_procon' },
  { sheet: 'reclameAqui', collection: 'reclamacoes_reclameAqui' },
  { sheet: 'bacen', collection: 'reclamacoes_bacen' },
  { sheet: 'timePortabilidade', collection: 'reclamacoes_timePortabilidade' },
];

const CAMPO_DATA_REFERENCIA_POR_COLLECTION = {
  reclamacoes_bacen: 'dataEntrada',
  reclamacoes_n2Pix: 'dataEntradaN2',
  reclamacoes_reclameAqui: 'dataReclam',
  reclamacoes_procon: 'dataProcon',
  reclamacoes_timePortabilidade: 'dataEntrada',
};

const STATS_DATE_ZONE = process.env.STATS_TZ || 'America/Sao_Paulo';
const DATA_REF_EXCEL_ZONE = 'utc';

function montarFiltroMongoParaPainel(h, collectionName, dataInicio, dataFim, produtos, motivos) {
  const { criarFiltroDataPorCollection, criarFiltroProduto, criarFiltroMotivo, mesclarFiltros } = h;
  const partes = [];
  if (dataInicio || dataFim) {
    partes.push(criarFiltroDataPorCollection(collectionName, dataInicio, dataFim));
  }
  if (produtos?.length) partes.push(criarFiltroProduto(produtos));
  if (motivos?.length) partes.push(criarFiltroMotivo(motivos));
  return partes.length ? partes.reduce((acc, p) => mesclarFiltros(acc, p), {}) : {};
}

function fmtCpf(r) {
  const raw = r.cpf != null ? String(r.cpf).replace(/\D/g, '') : '';
  return raw || '(sem cpf)';
}

function statusChamadoAbertoResolvido(h, r) {
  return h.documentoResolvidoParaMetricas(r) ? 'Resolvido' : 'Em aberto';
}

function dataReferenciaLuxon(collectionName, r) {
  const DateTime = require('luxon').DateTime;
  const campo = CAMPO_DATA_REFERENCIA_POR_COLLECTION[collectionName];
  const raw = campo ? r[campo] : null;
  if (raw == null || raw === '') return null;
  const js = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(js.getTime())) return null;
  const dt = DateTime.fromJSDate(js, { zone: DATA_REF_EXCEL_ZONE });
  return dt.isValid ? dt : null;
}

function fmtDataReferencia(collectionName, r) {
  const dt = dataReferenciaLuxon(collectionName, r);
  if (!dt) return '(sem data)';
  return dt.toFormat('dd/MM/yyyy');
}

function fmtMesAnoReferencia(collectionName, r) {
  const dt = dataReferenciaLuxon(collectionName, r);
  if (!dt) return '(sem data)';
  return dt.toFormat('yyyy-MM');
}

function fmtProduto(r) {
  if (r.produto == null || String(r.produto).trim() === '') return '(sem produto)';
  return String(r.produto).trim();
}

function fmtMotivoReduzido(r) {
  const mr = r.motivoReduzido;
  if (Array.isArray(mr)) {
    const partes = mr
      .filter((x) => x != null && String(x).trim())
      .map((x) => String(x).trim());
    return partes.length ? partes.join(' | ') : '(sem motivo)';
  }
  if (mr != null && String(mr).trim()) return String(mr).trim();
  return '(sem motivo)';
}

function linhaParaPlanilha(h, collectionName, r) {
  const cls = h.classificacaoDesdobramentoOuvidoriaNaoN1(r);
  const pixRetirado = cls === 'liberado' ? 'Sim' : 'Não';
  const retido = cls === 'retido' ? 'Sim' : 'Não';
  return {
    cpf: fmtCpf(r),
    data_referencia: fmtDataReferencia(collectionName, r),
    mes: fmtMesAnoReferencia(collectionName, r),
    produto: fmtProduto(r),
    motivo: fmtMotivoReduzido(r),
    pix_foi_retirado: pixRetirado,
    status_chamado: statusChamadoAbertoResolvido(h, r),
    retido,
  };
}

/**
 * @param {object} opts
 * @param {import('mongodb').Db} opts.db hub_ouvidoria
 * @param {Date|null} opts.dataInicio
 * @param {Date|null} opts.dataFim
 * @param {string[]} opts.produtos
 * @param {string[]} opts.motivos
 * @returns {Promise<Buffer>}
 */
async function gerarRelatorioOuvidoriaBaseExcelBuffer(opts) {
  const { db, dataInicio, dataFim, produtos = [], motivos = [] } = opts;
  const h = requireStatsHelpers();

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Painel Tempo Real';
  wb.created = new Date();

  const contagens = [];

  for (const { sheet, collection } of ABAS) {
    const filtro = montarFiltroMongoParaPainel(h, collection, dataInicio, dataFim, produtos, motivos);
    const cursor = db.collection(collection).find(filtro);
    const ws = wb.addWorksheet(sheet, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'cpf', key: 'cpf', width: 14 },
      { header: 'data_referencia', key: 'data_referencia', width: 12 },
      { header: 'mes', key: 'mes', width: 10 },
      { header: 'produto', key: 'produto', width: 26 },
      { header: 'motivo', key: 'motivo', width: 40 },
      { header: 'pix_foi_retirado', key: 'pix_foi_retirado', width: 18 },
      { header: 'status_chamado', key: 'status_chamado', width: 14 },
      { header: 'retido', key: 'retido', width: 10 },
    ];
    let n = 0;
    for await (const doc of cursor) {
      ws.addRow(linhaParaPlanilha(h, collection, doc));
      n += 1;
    }
    ws.getRow(1).font = { bold: true };
    contagens.push({ sheet, collection, n });
  }

  const meta = wb.addWorksheet('Critérios');
  meta.getCell('A1').value = 'Critério';
  meta.getCell('B1').value = 'Detalhe';
  const metaRows = [
    [
      'status_chamado',
      'Em aberto | Resolvido — documentoResolvidoParaMetricas (LISTA_SCHEMAS: Finalizado.Resolvido === true nas coleções ouvidoria).',
    ],
    [
      'Filtro Mongo',
      'Paridade com GET /api/stats: dataInicio/dataFim + produto + motivo (query da exportação).',
    ],
    [
      'Período',
      dataInicio && dataFim
        ? `${dataInicio.toISOString()} — ${dataFim.toISOString()} (${STATS_DATE_ZONE})`
        : '(não aplicado)',
    ],
    [
      'data_referencia',
      'dd/MM/yyyy = calendário UTC do Date no Mongo. Campos: Bacen dataEntrada; N2 dataEntradaN2; RA dataReclam; Procon dataProcon; Time Portabilidade dataEntrada.',
    ],
    [
      'mes',
      'yyyy-MM no mesmo instante/calendário UTC que data_referencia. Ausente/inválido → (sem data).',
    ],
    ['produto', 'Campo produto do documento (LISTA_SCHEMAS hub_ouvidoria).'],
    [
      'motivo',
      'motivoReduzido: vários valores separados por " | " (array no Mongo; string legada exibida como está).',
    ],
    [
      'pix_foi_retirado',
      'Sim somente quando classificacaoDesdobramentoOuvidoriaNaoN1 === liberado (chave PIX no painel).',
    ],
    [
      'retido',
      'Sim somente quando classificacaoDesdobramentoOuvidoriaNaoN1 === retido (stats.js v1.21.x).',
    ],
    ['Abas', 'n2pix, procon, reclameAqui, bacen, timePortabilidade (Time Portabilidade = reclamacoes_timePortabilidade).'],
    ...contagens.map((c) => [`Linhas ${c.sheet}`, String(c.n)]),
  ];
  metaRows.forEach((r, i) => {
    meta.getCell(`A${i + 2}`).value = r[0];
    meta.getCell(`B${i + 2}`).value = r[1];
  });
  meta.getColumn(1).width = 26;
  meta.getColumn(2).width = 88;

  return wb.xlsx.writeBuffer();
}

module.exports = {
  gerarRelatorioOuvidoriaBaseExcelBuffer,
  DB,
};
