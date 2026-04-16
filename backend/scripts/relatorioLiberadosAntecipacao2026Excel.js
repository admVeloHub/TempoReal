/**
 * Relatório Excel (.xlsx) — CPFs contados como "Liberados" no painel (stats.js v1.21.x)
 * nas coleções reclamacoes_bacen, reclamacoes_n2Pix, reclamacoes_reclameAqui, reclamacoes_procon.
 *
 * Filtro de negócio (AND):
 * - produto ∈ { Antecipação - 2026, Antecipação 2026 }
 * - universo Liberação Chave Pix (documentoELiberacaoChavePixExclusivo — motivos_chave_pix / detalhe_2026 / motivoReduzido)
 * - classificacaoDesdobramentoOuvidoriaNaoN1 === 'liberado'
 *
 * Colunas: cpf, tipo (rótulo da coleção), motivo, produto, data de resolvido (Finalizado.dataResolucao)
 *
 * VERSION: v1.4.0
 * v1.0.0: primeira versão; planilha Liberados + aba Critérios.
 * v1.1.0: inclusão reclamacoes_bacen (tipo Bacen; filtro de data = dataEntrada).
 * v1.1.1: bootstrap loadFrom(__dirname do backend) — alinha server.js para carregar MONGO_ENV.
 * v1.2.0: coluna data de resolvido (Finalizado.dataResolucao; exibição em STATS_TZ).
 * v1.2.1: fallback dotenv direto em FONTE DA VERDADE/.env se MONGO_ENV ainda vazio após bootstrap.
 * v1.2.2: coluna data de resolvido só com data (yyyy-MM-dd), sem hora.
 * v1.3.0: Mongo = mesmos mesclarFiltros do GET /api/stats (produto + motivo + data) — paridade com o painel
 *   quando MOTIVO_RELATORIO inclui «Liberação chave pix» (padrão). Antes o find só tinha produto e o JS
 *   incluía motivo só em motivos_chave_pix/detalhe_2026, invisíveis ao filtro Mongo do dashboard (+linhas).
 * v1.4.0: aba «Auditoria fora filtro Mongo» — liberados + produto 2026 (critério JS) que o find com motivo
 *   do painel não retorna (documentos existentes; não são «apagados», ficam fora do recorte do filtro).
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
  documentoELiberacaoChavePixExclusivo,
} = require('../routes/stats');

const DB = 'hub_ouvidoria';
const COLLECTIONS = [
  { name: 'reclamacoes_bacen', tipo: 'Bacen' },
  { name: 'reclamacoes_n2Pix', tipo: 'N2 Pix' },
  { name: 'reclamacoes_reclameAqui', tipo: 'Reclame Aqui' },
  { name: 'reclamacoes_procon', tipo: 'Procon' },
];

const PRODUTOS_2026 = ['Antecipação - 2026', 'Antecipação 2026'];
/** Mesmo rótulo que FiltrosAuxiliar.MOTIVOS → query motivo= do GET /api/stats */
const MOTIVO_PADRAO_PARIDADE_DASHBOARD = 'Liberação chave pix';
const STATS_DATE_ZONE = process.env.STATS_TZ || 'America/Sao_Paulo';

/** Motivos no Mongo (criarFiltroMotivo). Padrão = paridade com painel (Antecipação 2026 + Liberação chave pix). */
function motivosRelatorioParaMongo() {
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
  return [MOTIVO_PADRAO_PARIDADE_DASHBOARD];
}

function intervaloOpcional() {
  if (process.env.TODOS_OS_PERIODOS === '1' || String(process.env.TODOS_OS_PERIODOS || '').toLowerCase() === 'true') {
    return { dataInicio: null, dataFim: null };
  }
  const inRaw =
    process.env.DATA_INICIO && String(process.env.DATA_INICIO).trim()
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

function filtroDataOuVazio(collectionName, dataInicio, dataFim) {
  if (!dataInicio && !dataFim) return {};
  return criarFiltroDataPorCollection(collectionName, dataInicio, dataFim);
}

function produtoNoGrupo2026(p) {
  if (p == null) return false;
  const s = String(p).trim();
  return PRODUTOS_2026.includes(s);
}

/** Alinhado à ordem de documentoELiberacaoChavePixExclusivo em stats.js (ouvidoria). */
function ondeMotivoLiberacaoArmazenado(r) {
  if (r.motivos_chave_pix != null && String(r.motivos_chave_pix).trim() !== '') {
    return 'motivos_chave_pix';
  }
  if (r.detalhe_2026 != null && String(r.detalhe_2026).trim() !== '') {
    return 'detalhe_2026';
  }
  return 'motivoReduzido';
}

function docEhLiberadoProduto2026(r) {
  if (!produtoNoGrupo2026(r.produto)) return false;
  if (!documentoELiberacaoChavePixExclusivo(r)) return false;
  if (classificacaoDesdobramentoOuvidoriaNaoN1(r) !== 'liberado') return false;
  return true;
}

function keyDoc(collectionName, r) {
  return `${collectionName}\t${r._id.toString()}`;
}

function extrairTextoMotivoLib(r) {
  const fallback = 'Liberação chave pix';
  const arr = Array.isArray(r.motivoReduzido)
    ? r.motivoReduzido
    : r.motivoReduzido != null && String(r.motivoReduzido).trim()
      ? [String(r.motivoReduzido)]
      : [];
  const low = (x) => String(x).trim().toLowerCase();
  const hit = arr.find(
    (item) => low(item) === 'liberação chave pix' || low(item) === 'liberacao chave pix'
  );
  if (hit) return String(hit).trim();
  if (r.motivos_chave_pix != null && String(r.motivos_chave_pix).trim() !== '') {
    return String(r.motivos_chave_pix).trim();
  }
  if (r.detalhe_2026 != null && String(r.detalhe_2026).trim() !== '') {
    return String(r.detalhe_2026).trim();
  }
  return fallback;
}

/** Data em STATS_TZ; apenas calendário (sem hora). */
function fmtDataResolucao(d) {
  if (d == null || d === '') return '(sem data)';
  const js = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(js.getTime())) return '(sem data)';
  const dt = DateTime.fromJSDate(js).setZone(STATS_DATE_ZONE);
  if (!dt.isValid) return '(sem data)';
  return dt.toFormat('yyyy-MM-dd');
}

async function main() {
  const uri = process.env.MONGO_ENV;
  if (!uri || typeof uri !== 'string') {
    console.error('[relatorioLiberadosAntecipacao2026Excel] MONGO_ENV ausente.');
    process.exit(1);
  }

  const { dataInicio, dataFim } = intervaloOpcional();
  const filtroProduto = criarFiltroProduto(PRODUTOS_2026);
  const motivosMongo = motivosRelatorioParaMongo();
  const filtroMotivo = criarFiltroMotivo(motivosMongo);

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB);

  const linhas = [];
  /** Documentos que entram na aba Liberados (mesmo recorte do painel com filtro motivo). */
  const idsAlinhadosPainel = new Set();
  const linhasAuditoriaForaFiltroMongo = [];

  for (const { name, tipo } of COLLECTIONS) {
    const filtroData = filtroDataOuVazio(name, dataInicio, dataFim);
    const filtroMongo = mesclarFiltros(filtroData, filtroProduto, filtroMotivo);
    const docs = await db.collection(name).find(filtroMongo).toArray();

    for (const r of docs) {
      if (!docEhLiberadoProduto2026(r)) continue;
      idsAlinhadosPainel.add(keyDoc(name, r));

      const cpfRaw = r.cpf != null ? String(r.cpf).replace(/\D/g, '') : '';
      linhas.push({
        cpf: cpfRaw || '(sem cpf)',
        tipo,
        motivo: extrairTextoMotivoLib(r),
        produto: r.produto != null ? String(r.produto).trim() : '',
        dataResolucao: fmtDataResolucao(r.Finalizado?.dataResolucao),
      });
    }
  }

  if (motivosMongo.length > 0) {
    for (const { name, tipo } of COLLECTIONS) {
      const filtroData = filtroDataOuVazio(name, dataInicio, dataFim);
      const filtroSemMotivo = mesclarFiltros(filtroData, filtroProduto, {});
      const docsLargo = await db.collection(name).find(filtroSemMotivo).toArray();

      for (const r of docsLargo) {
        if (!docEhLiberadoProduto2026(r)) continue;
        if (idsAlinhadosPainel.has(keyDoc(name, r))) continue;

        const cpfRaw = r.cpf != null ? String(r.cpf).replace(/\D/g, '') : '';
        linhasAuditoriaForaFiltroMongo.push({
          cpf: cpfRaw || '(sem cpf)',
          tipo,
          motivo: extrairTextoMotivoLib(r),
          produto: r.produto != null ? String(r.produto).trim() : '',
          dataResolucao: fmtDataResolucao(r.Finalizado?.dataResolucao),
          onde_motivo: ondeMotivoLiberacaoArmazenado(r),
          id_documento: r._id != null ? String(r._id) : '',
        });
      }
    }
    linhasAuditoriaForaFiltroMongo.sort((a, b) => {
      const t = a.tipo.localeCompare(b.tipo, 'pt-BR');
      if (t !== 0) return t;
      return a.cpf.localeCompare(b.cpf, 'pt-BR');
    });
  }

  linhas.sort((a, b) => {
    const t = a.tipo.localeCompare(b.tipo, 'pt-BR');
    if (t !== 0) return t;
    return a.cpf.localeCompare(b.cpf, 'pt-BR');
  });

  const dirOut =
    process.env.OUT_DIR && String(process.env.OUT_DIR).trim()
      ? path.resolve(String(process.env.OUT_DIR).trim())
      : path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(dirOut)) {
    fs.mkdirSync(dirOut, { recursive: true });
  }
  const stamp = DateTime.now().setZone(STATS_DATE_ZONE).toFormat('yyyyMMdd_HHmmss');
  const arquivo = path.join(dirOut, `relatorio_liberados_antecipacao2026_${stamp}.xlsx`);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Painel Tempo Real';
  wb.created = new Date();

  const ws = wb.addWorksheet('Liberados', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = [
    { header: 'cpf', key: 'cpf', width: 14 },
    { header: 'tipo', key: 'tipo', width: 16 },
    { header: 'motivo', key: 'motivo', width: 28 },
    { header: 'produto', key: 'produto', width: 22 },
    { header: 'data de resolvido', key: 'dataResolucao', width: 22 },
  ];
  for (const row of linhas) {
    ws.addRow(row);
  }
  ws.getRow(1).font = { bold: true };

  if (motivosMongo.length > 0) {
    const wsAud = wb.addWorksheet('Auditoria fora filtro Mongo', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    wsAud.columns = [
      { header: 'cpf', key: 'cpf', width: 14 },
      { header: 'tipo', key: 'tipo', width: 16 },
      { header: 'motivo', key: 'motivo', width: 28 },
      { header: 'produto', key: 'produto', width: 22 },
      { header: 'data de resolvido', key: 'dataResolucao', width: 22 },
      { header: 'onde_motivo', key: 'onde_motivo', width: 22 },
      { header: 'id_documento', key: 'id_documento', width: 28 },
    ];
    for (const row of linhasAuditoriaForaFiltroMongo) {
      wsAud.addRow(row);
    }
    wsAud.getRow(1).font = { bold: true };
  }

  const meta = wb.addWorksheet('Critérios');
  meta.getCell('A1').value = 'Critério';
  meta.getCell('B1').value = 'Detalhe';
  const metaRows = [
    ['Produto', PRODUTOS_2026.join(' | ')],
    [
      'Motivo (Mongo)',
      motivosMongo.length
        ? `criarFiltroMotivo(${motivosMongo.join(' | ')}) — mesmo GET /api/stats; linhas ainda exigem documentoELiberacaoChavePixExclusivo + liberado`
        : 'SEM_FILTRO_MOTIVO=1 — sem filtro de motivo no find (não confundir com paridade do painel)',
    ],
    ['Classificação (linhas)', 'classificacaoDesdobramentoOuvidoriaNaoN1 === liberado'],
    [
      'Período (campo de data por coleção)',
      dataInicio && dataFim
        ? `${dataInicio.toISOString()} — ${dataFim.toISOString()} (${STATS_DATE_ZONE}); DATA_INICIO/DATA_FIM`
        : 'TODOS_OS_PERIODOS=1 — sem filtro de data',
    ],
    ['Coleções', COLLECTIONS.map((c) => c.name).join(', ')],
    ['Data resolvido', `Finalizado.dataResolucao — só data (yyyy-MM-dd) em ${STATS_DATE_ZONE} (LISTA_SCHEMAS)`],
    [
      'Aba Auditoria fora filtro Mongo',
      motivosMongo.length
        ? `Casos com mesmo critério liberado (JS) + produto 2026 que o find com motivo do GET / não retorna — existem no banco; contagem ${linhasAuditoriaForaFiltroMongo.length}. Não são omissão arbitrária: o filtro Mongo de motivo não cobre motivos_chave_pix/detalhe_2026 como o predicado JS.`
        : '(desativada — SEM_FILTRO_MOTIVO ou sem motivo no Mongo)',
    ],
    ['Total linhas Liberados', String(linhas.length)],
    ...(motivosMongo.length
      ? [['Total linhas só auditoria', String(linhasAuditoriaForaFiltroMongo.length)]]
      : []),
  ];
  metaRows.forEach((r, i) => {
    meta.getCell(`A${i + 2}`).value = r[0];
    meta.getCell(`B${i + 2}`).value = r[1];
  });
  meta.getColumn(1).width = 28;
  meta.getColumn(2).width = 72;

  await wb.xlsx.writeFile(arquivo);

  console.log(
    `[relatorioLiberadosAntecipacao2026Excel] Paridade GET /api/stats (ouvidoria): produto 2026 + motivo Mongo:`,
    motivosMongo.length ? motivosMongo.join(', ') : '(SEM_FILTRO_MOTIVO)'
  );
  console.log(`[relatorioLiberadosAntecipacao2026Excel] Arquivo: ${arquivo}`);
  console.log(`[relatorioLiberadosAntecipacao2026Excel] Registros (aba Liberados): ${linhas.length}`);
  if (motivosMongo.length > 0) {
    console.log(
      `[relatorioLiberadosAntecipacao2026Excel] Registros (aba Auditoria fora filtro Mongo): ${linhasAuditoriaForaFiltroMongo.length}`
    );
  }

  await client.close();
}

main().catch((e) => {
  console.error('[relatorioLiberadosAntecipacao2026Excel]', e);
  process.exit(1);
});
