/**
 * Excel (.xlsx) — uma aba por canal (n2pix, procon, reclameAqui, bacen, timePortabilidade), com TODOS os documentos
 * das coleções hub_ouvidoria correspondentes (incl. reclamacoes_timePortabilidade = Time Portabilidade / card N1 no painel).
 *
 * Colunas:
 * - cpf
 * - criado_em_sp — só quando filtro de hora ativo: data/hora do createdAt em America/Sao_Paulo (dd/MM/yyyy HH:mm:ss)
 * - data_referencia — calendário UTC do instante armazenado (dd/MM/yyyy); ex. 2026-04-07T00:00:00.000Z → 07/04/2026 (sem conversão STATS_TZ)
 * - mes — ano-mês (yyyy-MM) no mesmo calendário UTC da data_referencia
 * - produto — campo produto (LISTA_SCHEMAS)
 * - motivo — motivoReduzido ([String] ou legado string); múltiplos valores unidos com " | "
 * - pix_foi_retirado — Sim quando classificacaoDesdobramentoOuvidoriaNaoN1 === 'liberado' (chave PIX liberada, mesmo critério do painel)
 * - status_chamado — Em aberto ou Resolvido (documentoResolvidoParaMetricas / Finalizado.Resolvido, stats.js)
 * - retido — Sim quando classificacaoDesdobramentoOuvidoriaNaoN1 === 'retido'
 *
 * Filtro Mongo opcional (paridade período com GET /api/stats): defina DATA_INICIO (e opcionalmente DATA_FIM).
 * Sem DATA_INICIO: find({}) na coleção (totalidade bruta).
 *
 * Filtro por hora de criação (versão "após N h em São Paulo"):
 *   CREATED_AT_HORA_MINIMA_SAO_PAULO=14 — só entram linhas com createdAt >= 14:00:00.000
 *   no relógio de America/Sao_Paulo naquele dia; documentos sem createdAt são excluídos.
 *   Inclui coluna criado_em_sp. Sufixo no arquivo: _criadasApos14hSP. Omita a env para planilha sem esse filtro.
 *
 * VERSION: v1.8.0
 * v1.6.0: relatorioOuvidoriaBaseExcel.js (GET) alinhado a este script.
 * v1.7.0: filtro opcional createdAt a partir de hora em America/Sao_Paulo (env CREATED_AT_HORA_MINIMA_SAO_PAULO) + coluna criado_em_sp.
 * v1.8.0: aba timePortabilidade (reclamacoes_timePortabilidade, dataEntrada); arquivo relatorio_ouvidoria_5canais_totais_*.xlsx.
 * v1.0.0: primeira versão; classificação via require('../routes/stats').
 * v1.1.0: coluna mes (mês/ano da data de referência por coleção, fuso STATS_TZ).
 * v1.2.0: coluna data_referencia (data completa) + mes (adicional, não substitui a data).
 * v1.3.0: status_chamado = Em aberto | Resolvido (documentoResolvidoParaMetricas); pix/retido seguem classificacaoDesdobramentoOuvidoriaNaoN1.
 * v1.4.0: colunas produto e motivo (motivoReduzido).
 * v1.5.0: data_referencia e mes pelo calendário UTC do BSON Date (dd/MM/yyyy e yyyy-MM), evitando mudança de dia por STATS_TZ.
 */
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
})(require('path').join(__dirname, '..'));

(function ensureEnvFromFonteIfNeeded() {
  if (process.env.MONGO_ENV && String(process.env.MONGO_ENV).trim() !== '') return;
  const path = require('path');
  const fs = require('fs');
  let d = path.resolve(__dirname, '..');
  for (let i = 0; i < 16; i++) {
    const envPath = path.join(d, 'FONTE DA VERDADE', '.env');
    if (fs.existsSync(envPath)) {
      try {
        require('dotenv').config({ path: envPath });
      } catch (_e) {
        /* ignore */
      }
      return;
    }
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
})();

const path = require('path');
const fs = require('fs');
const { DateTime } = require('luxon');
const ExcelJS = require('exceljs');
const { MongoClient } = require('mongodb');
const {
  criarFiltroDataPorCollection,
  criarFiltroProduto,
  criarFiltroMotivo,
  mesclarFiltros,
  classificacaoDesdobramentoOuvidoriaNaoN1,
  documentoResolvidoParaMetricas,
} = require('../routes/stats');

const DB = 'hub_ouvidoria';
const ABAS = [
  { sheet: 'n2pix', collection: 'reclamacoes_n2Pix' },
  { sheet: 'procon', collection: 'reclamacoes_procon' },
  { sheet: 'reclameAqui', collection: 'reclamacoes_reclameAqui' },
  { sheet: 'bacen', collection: 'reclamacoes_bacen' },
  { sheet: 'timePortabilidade', collection: 'reclamacoes_timePortabilidade' },
];

/** Mesmo eixo de data do filtro GET /api/stats (backend/routes/stats.js CAMPOS_DATA_POR_COLLECTION). */
const CAMPO_DATA_REFERENCIA_POR_COLLECTION = {
  reclamacoes_bacen: 'dataEntrada',
  reclamacoes_n2Pix: 'dataEntradaN2',
  reclamacoes_reclameAqui: 'dataReclam',
  reclamacoes_procon: 'dataProcon',
  reclamacoes_timePortabilidade: 'dataEntrada',
};

const STATS_DATE_ZONE = process.env.STATS_TZ || 'America/Sao_Paulo';
/** Exibição na planilha: dia/mês/ano do instante gravado no Mongo (UTC), alinhado a ISO tipo 2026-04-07T00:00:00.000Z → 07/04/2026. */
const DATA_REF_EXCEL_ZONE = 'utc';

/**
 * 0–23: só linhas cujo createdAt, no relógio de STATS_TZ, é naquele dia a partir de HH:00:00.000.
 * null = sem filtro de createdAt.
 */
function horaMinimaCreatedAtSaoPaulo() {
  const raw = process.env.CREATED_AT_HORA_MINIMA_SAO_PAULO;
  if (raw == null || String(raw).trim() === '') return null;
  const h = parseInt(String(raw).trim(), 10);
  if (Number.isNaN(h) || h < 0 || h > 23) {
    throw new Error('CREATED_AT_HORA_MINIMA_SAO_PAULO deve ser inteiro 0..23');
  }
  return h;
}

function createdAtSaoPaulo(r) {
  if (r == null || r.createdAt == null) return null;
  const js = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
  if (Number.isNaN(js.getTime())) return null;
  return DateTime.fromMillis(js.getTime(), { zone: 'utc' }).setZone(STATS_DATE_ZONE);
}

function passaFiltroCreatedAposHoraSaoPaulo(r, horaMin) {
  if (horaMin == null) return true;
  const sp = createdAtSaoPaulo(r);
  if (sp == null || !sp.isValid) return false;
  const corte = sp.startOf('day').set({ hour: horaMin, minute: 0, second: 0, millisecond: 0 });
  return sp.toMillis() >= corte.toMillis();
}

function fmtCriadoEmSaoPaulo(r) {
  const sp = createdAtSaoPaulo(r);
  if (sp == null || !sp.isValid) return '(sem createdAt)';
  return sp.toFormat('dd/MM/yyyy HH:mm:ss');
}

function motivosRelatorioParaMongoOpcional() {
  if (process.env.SEM_FILTRO_MOTIVO === '1' || String(process.env.SEM_FILTRO_MOTIVO || '').toLowerCase() === 'true') {
    return [];
  }
  const raw = process.env.MOTIVO_RELATORIO;
  if (raw != null && String(raw).trim() !== '') {
    return String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function produtosRelatorioOpcional() {
  const raw = process.env.PRODUTO_RELATORIO;
  if (raw != null && String(raw).trim() !== '') {
    return String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/** Só aplica quando DATA_INICIO está definido (trim não vazio). */
function intervaloPainelOpcional() {
  const inRaw = process.env.DATA_INICIO && String(process.env.DATA_INICIO).trim();
  if (!inRaw) return { dataInicio: null, dataFim: null };
  const dataInicio = DateTime.fromISO(String(inRaw).trim(), { zone: STATS_DATE_ZONE }).startOf('day').toJSDate();
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

function montarFiltroMongo(collectionName) {
  const { dataInicio, dataFim } = intervaloPainelOpcional();
  const produtos = produtosRelatorioOpcional();
  const motivos = motivosRelatorioParaMongoOpcional();
  if (!dataInicio && !dataFim && produtos.length === 0 && motivos.length === 0) {
    return {};
  }
  const partes = [];
  if (dataInicio || dataFim) {
    partes.push(criarFiltroDataPorCollection(collectionName, dataInicio, dataFim));
  }
  if (produtos.length) partes.push(criarFiltroProduto(produtos));
  if (motivos.length) partes.push(criarFiltroMotivo(motivos));
  return partes.length ? partes.reduce((acc, p) => mesclarFiltros(acc, p), {}) : {};
}

function fmtCpf(r) {
  const raw = r.cpf != null ? String(r.cpf).replace(/\D/g, '') : '';
  return raw || '(sem cpf)';
}

/** Ouvidoria (estas coleções): Resolvido = Finalizado.Resolvido === true (stats documentoResolvidoParaMetricas). */
function statusChamadoAbertoResolvido(r) {
  return documentoResolvidoParaMetricas(r) ? 'Resolvido' : 'Em aberto';
}

/** Instantâneo do campo de data do canal em UTC (calendário da célula = UTC, não STATS_TZ). */
function dataReferenciaLuxon(collectionName, r) {
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

/** Mês/ano (yyyy-MM) no mesmo calendário UTC que data_referencia. */
function fmtMesAnoReferencia(collectionName, r) {
  const dt = dataReferenciaLuxon(collectionName, r);
  if (!dt) return '(sem data)';
  return dt.toFormat('yyyy-MM');
}

function fmtProduto(r) {
  if (r.produto == null || String(r.produto).trim() === '') return '(sem produto)';
  return String(r.produto).trim();
}

/** LISTA_SCHEMAS: motivoReduzido [String]; legado pode ser string única. */
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

function linhaParaPlanilha(collectionName, r, opts) {
  const { incluirCriadoEmSp } = opts || {};
  const cls = classificacaoDesdobramentoOuvidoriaNaoN1(r);
  const pixRetirado = cls === 'liberado' ? 'Sim' : 'Não';
  const retido = cls === 'retido' ? 'Sim' : 'Não';
  const out = { cpf: fmtCpf(r) };
  if (incluirCriadoEmSp) {
    out.criado_em_sp = fmtCriadoEmSaoPaulo(r);
  }
  out.data_referencia = fmtDataReferencia(collectionName, r);
  out.mes = fmtMesAnoReferencia(collectionName, r);
  out.produto = fmtProduto(r);
  out.motivo = fmtMotivoReduzido(r);
  out.pix_foi_retirado = pixRetirado;
  out.status_chamado = statusChamadoAbertoResolvido(r);
  out.retido = retido;
  return out;
}

async function main() {
  const uri = process.env.MONGO_ENV;
  if (!uri || typeof uri !== 'string') {
    console.error('[relatorioOuvidoria4AbasTotaisExcel] MONGO_ENV ausente.');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB);

  const horaMinCri = horaMinimaCreatedAtSaoPaulo();
  const comFiltroCriadoHora = horaMinCri != null;
  const incluirCriadoEmSp = comFiltroCriadoHora;

  const dirOut =
    process.env.OUT_DIR && String(process.env.OUT_DIR).trim()
      ? path.resolve(String(process.env.OUT_DIR).trim())
      : path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(dirOut)) {
    fs.mkdirSync(dirOut, { recursive: true });
  }
  const stamp = DateTime.now().setZone(STATS_DATE_ZONE).toFormat('yyyyMMdd_HHmmss');
  const sufixoFiltroHora = comFiltroCriadoHora ? `_criadasApos${horaMinCri}hSP` : '';
  const arquivo = path.join(
    dirOut,
    `relatorio_ouvidoria_5canais_totais_${stamp}${sufixoFiltroHora}.xlsx`
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Painel Tempo Real';
  wb.created = new Date();

  const contagens = [];

  for (const { sheet, collection } of ABAS) {
    const filtro = montarFiltroMongo(collection);
    const cursor = db.collection(collection).find(filtro);
    const ws = wb.addWorksheet(sheet, { views: [{ state: 'frozen', ySplit: 1 }] });
    const colunas = [
      { header: 'cpf', key: 'cpf', width: 14 },
    ];
    if (incluirCriadoEmSp) {
      colunas.push({ header: 'criado_em_sp', key: 'criado_em_sp', width: 20 });
    }
    colunas.push(
      { header: 'data_referencia', key: 'data_referencia', width: 12 },
      { header: 'mes', key: 'mes', width: 10 },
      { header: 'produto', key: 'produto', width: 26 },
      { header: 'motivo', key: 'motivo', width: 40 },
      { header: 'pix_foi_retirado', key: 'pix_foi_retirado', width: 18 },
      { header: 'status_chamado', key: 'status_chamado', width: 14 },
      { header: 'retido', key: 'retido', width: 10 }
    );
    ws.columns = colunas;
    const optsLinha = { incluirCriadoEmSp };
    let n = 0;
    for await (const doc of cursor) {
      if (!passaFiltroCreatedAposHoraSaoPaulo(doc, horaMinCri)) {
        continue;
      }
      ws.addRow(linhaParaPlanilha(collection, doc, optsLinha));
      n += 1;
    }
    ws.getRow(1).font = { bold: true };
    contagens.push({ sheet, collection, n });
    console.log(`[relatorioOuvidoria4AbasTotaisExcel] ${collection} → aba "${sheet}": ${n} linhas`);
  }

  const meta = wb.addWorksheet('Critérios');
  meta.getCell('A1').value = 'Critério';
  meta.getCell('B1').value = 'Detalhe';
  const { dataInicio, dataFim } = intervaloPainelOpcional();
  const metaRows = [
    [
      'status_chamado',
      'Em aberto | Resolvido — documentoResolvidoParaMetricas (LISTA_SCHEMAS: Finalizado.Resolvido === true nas coleções ouvidoria).',
    ],
    [
      'Filtro Mongo',
      dataInicio
        ? `DATA_INICIO/DATA_FIM + opcional PRODUTO_RELATORIO (lista separada por vírgula) + MOTIVO_RELATORIO / SEM_FILTRO_MOTIVO`
        : 'Sem DATA_INICIO — todos os documentos da coleção (find sem intervalo)',
    ],
    [
      'Período',
      dataInicio && dataFim
        ? `${dataInicio.toISOString()} — ${dataFim.toISOString()} (${STATS_DATE_ZONE})`
        : '(não aplicado)',
    ],
    [
      'data_referencia',
      'dd/MM/yyyy = calendário UTC do Date no Mongo (ex.: 2026-04-07T00:00:00.000+00:00 → 07/04/2026). Campos: Bacen/Time Port. dataEntrada; N2 dataEntradaN2; RA dataReclam; Procon dataProcon. Não usa STATS_TZ na célula.',
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
    [
      'Filtro createdAt (hora São Paulo)',
      comFiltroCriadoHora
        ? `CREATED_AT_HORA_MINIMA_SAO_PAULO=${horaMinCri} — documentos com createdAt >= ${horaMinCri}:00 nesse dia em ${STATS_DATE_ZONE}. Sem createdAt: excluído. Coluna criado_em_sp.`
        : 'Não aplicado (defina CREATED_AT_HORA_MINIMA_SAO_PAULO=0..23, ex. 14, para a versão após 14h).',
    ],
    ...contagens.map((c) => [`Linhas ${c.sheet}`, String(c.n)]),
  ];
  metaRows.forEach((r, i) => {
    meta.getCell(`A${i + 2}`).value = r[0];
    meta.getCell(`B${i + 2}`).value = r[1];
  });
  meta.getColumn(1).width = 26;
  meta.getColumn(2).width = 88;

  await wb.xlsx.writeFile(arquivo);
  if (comFiltroCriadoHora) {
    console.log(
      `[relatorioOuvidoria4AbasTotaisExcel] Filtro createdAt: a partir de ${horaMinCri}:00 em ${STATS_DATE_ZONE} (sufixo: ${sufixoFiltroHora})`
    );
  }
  console.log(`[relatorioOuvidoria4AbasTotaisExcel] Arquivo: ${arquivo}`);

  await client.close();
}

main().catch((e) => {
  console.error('[relatorioOuvidoria4AbasTotaisExcel]', e);
  process.exit(1);
});
