/**
 * Relatório administrativo — hub_ouvidoria.reclamacoes_n2Pix
 * VERSION: v1.2.2
 *
 * Gera arquivo em backend/reports/ com: total geral, totais por faixa de produto
 * Antecipação alinhados a FiltrosAuxiliar.PRODUTO_GRUPOS_PARA_API (mesmo $in do GET /api/stats),
 * bloco de conferência = período stats (dataEntradaN2) + produto grupo 2026 + motivo padrão App,
 * e totais liberados/retidos (stats.js).
 *
 * v1.0.0 — release inicial.
 * v1.1.0 — bucket produto = API (grupo 2026 inclui "Antecipação"); seção conferência data + produto.
 * v1.1.1 — conferência inclui motivo padrão App (Liberação chave pix).
 * v1.1.2 — conferência usa find Mongo com stats.js (mesmo predicado do GET /api/stats).
 * v1.1.3 — notas: n2Pix sem octadeskNumber; contagens por string exata de produto.
 * v1.2.0 — produto "Antecipação" = grupo Outros Anos (regra de negócio); grupo 2026 só hífen + "Antecipação 2026".
 * v1.2.1 — retido ouvidoria não conta se semRespostaCliente === true (stats.js v1.20.5).
 * v1.2.2 — Liberados/Retidos/Sem resposta/Op. cancelada alinhados à classificação excludente stats v1.21.0.
 *
 * Uso (pasta backend, .env com MONGO_ENV):
 *   node scripts/relatorioAdministrativoN2Pix.js
 *
 * Opcional: DATA_INICIO=, DATA_FIM= (YYYY-MM-DD) — período da seção conferência (padrão = stats).
 *   SEM_FILTRO_MOTIVO=1 — conferência só com produto + data (não replica motivo padrão do App).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const { MongoClient } = require('mongodb');
const {
  normalizeTextOctadesk,
  motivoN1ContaComoLiberacaoParaMetricas,
} = require('../services/octadeskIngestService');
const statsRoute = require('../routes/stats');

const DB = 'hub_ouvidoria';
const COLL = 'reclamacoes_n2Pix';
const STATS_DATE_ZONE = process.env.STATS_TZ || 'America/Sao_Paulo';

const MOTIVO_LIBERACAO_CHAVE_PIX = 'liberação chave pix';
const MOTIVO_LIBERACAO_CHAVE_PIX_SEM_ACENTO = 'liberacao chave pix';

/** Expansão enviada ao Mongo quando o usuário escolhe "Antecipação - 2026" no dash (FiltrosAuxiliar). */
const API_PRODUTO_GRUPO_2026_EXATO = new Set(['Antecipação - 2026', 'Antecipação 2026']);

function produtoNoGrupoApiAntecipacao2026(produto) {
  if (produto == null || String(produto).trim() === '') return false;
  return API_PRODUTO_GRUPO_2026_EXATO.has(String(produto).trim());
}

/** Grupo "Outros Anos" na API — inclui produto literal "Antecipação" (sem ano no rótulo). */
function produtoEhGrupoApiOutrosAnos(produto) {
  if (produto == null || String(produto).trim() === '') return false;
  const s = String(produto).trim();
  if (s === 'Antecipação - Outros Anos' || s === 'Antecipacao' || s === 'Antecipação') return true;
  const n = normalizeTextOctadesk(s);
  return n === normalizeTextOctadesk('Antecipação - Outros Anos');
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

/**
 * Bucket inventário: mesmo critério que o filtro de produto na API (grupos 2026 / Outros).
 * Outros primeiro por literais explícitos; depois expansão 2026; depois heurística "antecipação" + 2026.
 */
function bucketProdutoRelatorio(produto) {
  if (produto == null || String(produto).trim() === '') return 'Demais / sem produto';
  const s = String(produto).trim();
  if (produtoEhGrupoApiOutrosAnos(produto)) return 'Antecipação - Outros Anos';
  if (produtoNoGrupoApiAntecipacao2026(produto)) return 'Antecipação - 2026';

  const lower = s.toLowerCase();
  if (lower === 'antecipação 2026') return 'Antecipação - 2026';
  const semDiac = s.normalize('NFD').replace(/\p{M}/gu, '');
  if (/^antecipacao\s+2026$/i.test(semDiac.trim())) return 'Antecipação - 2026';

  const n = normalizeTextOctadesk(s);
  for (const lit of ['Antecipação - 2026', 'Antecipação 2026']) {
    if (normalizeTextOctadesk(lit) === n) return 'Antecipação - 2026';
  }

  const compact = semDiac.toLowerCase().replace(/\s+/g, '');
  if (/\d/.test(s) && /2026/.test(s) && compact.includes('antecipacao')) {
    return 'Antecipação - 2026';
  }
  return 'Demais / sem produto';
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

/** Igual somaRetidos em stats.js calcularStatsPorTipo (v1.21.0). */
function documentoContaComoRetidoPorTipoOuvidoria(r) {
  if (isDocN1Stats(r) && documentoRetidoContagemN1(r)) return true;
  return statsRoute.classificacaoDesdobramentoOuvidoriaNaoN1(r) === 'retido';
}

const ESCALADO_N2_LABELS_NORMALIZADOS = new Set(
  ['Casos Especiais - Ouvidoria', 'Devolutiva', '-'].map((lab) => normalizeTextOctadesk(lab))
);

function documentoEscaladoN2ContagemN1(r) {
  const v = r?.escalar_chamado;
  if (v == null || String(v).trim() === '') return false;
  return ESCALADO_N2_LABELS_NORMALIZADOS.has(normalizeTextOctadesk(String(v)));
}

function documentoEmAbertoN1PorStatus(r) {
  const name = r?.currentStatusName;
  if (name == null || String(name).trim() === '') return true;
  return normalizeTextOctadesk(String(name)) !== normalizeTextOctadesk('Resolvido');
}

function canonMotivoOpCancelada7Dias(valor) {
  return String(valor)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ');
}

const MOTIVOS_OP_CANCELADA_CANON = new Set(['cancelamento 7 dias', 'cancelamento ate 7 dias']);

function motivoContemCancelamento7Dias(motivoReduzido) {
  const itens = Array.isArray(motivoReduzido)
    ? motivoReduzido
    : motivoReduzido != null && motivoReduzido !== ''
      ? [String(motivoReduzido)]
      : [];
  return itens.some((item) => MOTIVOS_OP_CANCELADA_CANON.has(canonMotivoOpCancelada7Dias(item)));
}

/** Igual calcularStatsPorTipo + enrichComMostradoresOuvidoria em stats.js. */
function metricasCardN2ComoApi(docs) {
  const ocorrencias = docs.length;
  const emAberto = docs.filter((r) => (
    isDocN1Stats(r) ? documentoEmAbertoN1PorStatus(r) : !documentoResolvidoParaMetricas(r)
  )).length;
  const resolvido = docs.filter((r) => documentoResolvidoParaMetricas(r)).length;

  const docsLiberacaoChavePix = docs.filter((r) => documentoELiberacaoChavePixExclusivo(r));
  const solLiberacao = docsLiberacaoChavePix.length;

  const somaEscaladoN2 =
    docs.filter((r) => isDocN1Stats(r) && documentoEscaladoN2ContagemN1(r)).length +
    docs.filter((r) => statsRoute.classificacaoDesdobramentoOuvidoriaNaoN1(r) === 'liberado').length;
  const somaRetidos =
    docs.filter((r) => isDocN1Stats(r) && documentoRetidoContagemN1(r)).length +
    docs.filter((r) => statsRoute.classificacaoDesdobramentoOuvidoriaNaoN1(r) === 'retido').length;

  const pixLiberado = somaEscaladoN2;
  const pixRetido = somaRetidos;
  const percRetencao =
    solLiberacao > 0 ? Math.round((pixRetido / solLiberacao) * 1000) / 10 : 0;
  const taxaResolucao = ocorrencias > 0 ? Math.round((resolvido / ocorrencias) * 1000) / 10 : 0;

  const semResposta = docs.filter(
    (r) => statsRoute.classificacaoDesdobramentoOuvidoriaNaoN1(r) === 'semResposta'
  ).length;
  const opCancelada = docs.filter(
    (r) => statsRoute.classificacaoDesdobramentoOuvidoriaNaoN1(r) === 'opCancelada'
  ).length;

  return {
    ocorrencias,
    emAberto,
    resolvido,
    solLiberacao,
    pixLiberado,
    pixRetido,
    percRetencao,
    taxaResolucao,
    semResposta,
    opCancelada,
  };
}

async function main() {
  const uri = process.env.MONGO_ENV;
  if (!uri || typeof uri !== 'string') {
    console.error('[relatorioAdministrativoN2Pix] MONGO_ENV ausente.');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const coll = client.db(DB).collection(COLL);
  const estimated = await coll.estimatedDocumentCount();
  const docs = await coll.find({}).toArray();

  let periodoDash;
  let subsetDashAntecipacao2026;
  let metricasDash;
  try {
    const dataInicioRaw = (process.env.DATA_INICIO && String(process.env.DATA_INICIO).trim()) || undefined;
    const dataFimRaw = process.env.DATA_FIM;
    periodoDash = statsRoute.normalizarIntervaloDatasQueryStats(dataInicioRaw, dataFimRaw);
    const filtroData = statsRoute.criarFiltroDataPorCollection(
      'reclamacoes_n2Pix',
      periodoDash.dataInicio,
      periodoDash.dataFim
    );
    const filtroProd = statsRoute.criarFiltroProduto(['Antecipação - 2026', 'Antecipação 2026']);
    const semFiltroMotivo =
      process.env.SEM_FILTRO_MOTIVO === '1' ||
      String(process.env.SEM_FILTRO_MOTIVO || '').toLowerCase() === 'true';
    const filtroMot = semFiltroMotivo ? {} : statsRoute.criarFiltroMotivo(['Liberação chave pix']);
    const filtroN2Conferencia = statsRoute.mesclarFiltros(filtroData, filtroProd, filtroMot);
    subsetDashAntecipacao2026 = await coll.find(filtroN2Conferencia).toArray();
    metricasDash = metricasCardN2ComoApi(subsetDashAntecipacao2026);
  } catch (e) {
    periodoDash = { dataInicio: null, dataFim: null };
    subsetDashAntecipacao2026 = [];
    metricasDash = null;
  }

  const porProduto = {
    'Antecipação - 2026': 0,
    'Antecipação - Outros Anos': 0,
    'Demais / sem produto': 0,
  };

  let liberados = 0;
  let retidos = 0;
  let ambosMetrica = 0;
  let nemLiberadoNemRetido = 0;

  /** Partição exclusiva por produto (cada doc conta uma vez). */
  const cruz = {
    'Antecipação - 2026': { apenasLiberado: 0, apenasRetido: 0, ambos: 0, nenhum: 0 },
    'Antecipação - Outros Anos': { apenasLiberado: 0, apenasRetido: 0, ambos: 0, nenhum: 0 },
    'Demais / sem produto': { apenasLiberado: 0, apenasRetido: 0, ambos: 0, nenhum: 0 },
  };

  /** Por string exata armazenada em produto (só linhas Antecipação API 2026 / Outros). */
  const contagemProdutoLiteral = new Map();
  for (const r of docs) {
    const b = bucketProdutoRelatorio(r.produto);
    porProduto[b] += 1;

    const pRaw = r.produto == null ? '' : String(r.produto).trim();
    if (b === 'Antecipação - 2026' || b === 'Antecipação - Outros Anos') {
      const k = pRaw || '(vazio)';
      contagemProdutoLiteral.set(k, (contagemProdutoLiteral.get(k) || 0) + 1);
    }

    const lib = documentoLiberadoChavePixParaMetricas(r);
    const ret = documentoContaComoRetidoPorTipoOuvidoria(r);
    if (lib) liberados += 1;
    if (ret) retidos += 1;
    if (lib && ret) ambosMetrica += 1;

    if (lib && ret) cruz[b].ambos += 1;
    else if (lib) cruz[b].apenasLiberado += 1;
    else if (ret) cruz[b].apenasRetido += 1;
    else {
      cruz[b].nenhum += 1;
      nemLiberadoNemRetido += 1;
    }
  }

  const agora = DateTime.now().setZone(STATS_DATE_ZONE);
  const stamp = agora.toFormat('yyyy-MM-dd_HHmmss');
  const dirOut = path.join(__dirname, '..', 'reports');
  const arquivo = path.join(dirOut, `relatorio_administrativo_n2Pix_${stamp}.txt`);

  const texto = [
    `RELATÓRIO ADMINISTRATIVO — ${DB}.${COLL}`,
    '=============================================',
    `Gerado em: ${agora.toFormat('yyyy-MM-dd HH:mm:ss')} (${STATS_DATE_ZONE})`,
    'Script: backend/scripts/relatorioAdministrativoN2Pix.js v1.2.0',
    '',
    'NOTAS DE CLASSIFICAÇÃO',
    '----------------------',
    '• reclamacoes_n2Pix: não há octadeskNumber. As métricas usam as mesmas funções do stats.js;',
    '  aqui o ramo “N1 + retido_no_atendimento” de documentoContaComoRetidoPorTipoOuvidoria nunca aplica.',
    '  Na prática, retido = universo Liberação Chave Pix + resolvido + não liberado (métrica ouvidoria).',
    '• Regra de negócio N2: produto "Antecipação" (sozinho) = Outros Anos; linha 2026 = "Antecipação - 2026" ou "Antecipação 2026".',
    '• Filtro UI “Antecipação - 2026” expande $in em duas strings; Outros inclui "Antecipação" — ver tabela por literal.',
    '• Liberados no card N2 = pixLiberado; Retidos = pixRetido (calcularStatsPorTipo + enrich).',
    '',
    ...(metricasDash && periodoDash.dataInicio
      ? [
          'CONFERÊNCIA COM O CARD N2 DO PAINEL',
          '-----------------------------------',
          `Período dataEntradaN2: ${periodoDash.dataInicio.toISOString()} — ${periodoDash.dataFim.toISOString()}`,
          'Filtro produto: grupo "Antecipação - 2026" = $in [ Antecipação - 2026, Antecipação 2026 ].',
          process.env.SEM_FILTRO_MOTIVO === '1' ||
          String(process.env.SEM_FILTRO_MOTIVO || '').toLowerCase() === 'true'
            ? 'Filtro motivo: (desligado — SEM_FILTRO_MOTIVO).'
            : 'Filtro motivo: Liberação chave pix — criarFiltroMotivo + mesclarFiltros como no GET /api/stats.',
          'Subconjunto obtido com coll.find(filtro) idêntico ao da rota de estatísticas.',
          `Documentos no subconjunto: ${subsetDashAntecipacao2026.length}`,
          `Ocorrências:     ${metricasDash.ocorrencias}`,
          `Liberados:       ${metricasDash.pixLiberado}`,
          `Retidos:         ${metricasDash.pixRetido}`,
          `Sem Resposta:    ${metricasDash.semResposta}`,
          `Op. Cancelada:   ${metricasDash.opCancelada}`,
          `Em Aberto:       ${metricasDash.emAberto}`,
          `% Retenção:      ${metricasDash.percRetencao} (base solLiberacao Chave Pix: ${metricasDash.solLiberacao})`,
          '',
        ]
      : ['ERRO ao montar subconjunto do painel — revisar DATA_INICIO / DATA_FIM.', '']),
    'COLEÇÃO COMPLETA (sem filtro de data no agrupamento abaixo)',
    '-------------------------------------------------------------',
    'TOTAL DE REGISTROS',
    '------------------',
    `estimatedDocumentCount (aprox.): ${estimated}`,
    `Total lido nesta execução (find):  ${docs.length}`,
    '',
    'TOTAIS POR PRODUTO (ANTECIPAÇÃO)',
    '--------------------------------',
    `Antecipação - 2026:           ${porProduto['Antecipação - 2026']}`,
    `Antecipação - Outros Anos:    ${porProduto['Antecipação - Outros Anos']}`,
    `Demais / sem produto:         ${porProduto['Demais / sem produto']}`,
    `--- SOMA (conferência):       ${porProduto['Antecipação - 2026'] + porProduto['Antecipação - Outros Anos'] + porProduto['Demais / sem produto']}`,
    '',
    'CONTAGEM POR VALOR EXATO DO CAMPO produto (só Antecipação 2026 + Outros Anos na taxonomia API)',
    '------------------------------------------------------------------',
    '(cada linha é a string gravada no documento — «Antecipação» e «Antecipação 2026» aparecem separadas se existirem)',
    ...(contagemProdutoLiteral.size === 0
      ? ['  (nenhum)']
      : Array.from(contagemProdutoLiteral.entries())
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
          .map(([valor, n]) => `  ${n}\t${valor}`)),
    '',
    'LIBERADOS E RETIDOS (MÉTRICAS PAINEL / STATS)',
    '---------------------------------------------',
    '(Contagens globais: um mesmo documento pode entrar em liberado E em retido se ambas as funções retornarem true.)',
    `Total classificado como liberado (documentoLiberadoChavePixParaMetricas): ${liberados}`,
    `Total classificado como retido (documentoContaComoRetidoPorTipoOuvidoria; só ramo ouvidoria nesta coleção): ${retidos}`,
    `Documentos em que ambas as condições são verdadeiras (revisar dado):        ${ambosMetrica}`,
    `Documentos nem liberado nem retido pela métrica acima:                      ${nemLiberadoNemRetido}`,
    '',
    'CRUZAMENTO PRODUTO × CLASSIFICAÇÃO EXCLUSIVA',
    '--------------------------------------------',
    '(cada documento em exatamente uma linha: apenas liberado | apenas retido | ambos | nenhum)',
    ...Object.keys(cruz).flatMap((k) => [
      '',
      k,
      `  apenas liberado (só métrica liberado): ${cruz[k].apenasLiberado}`,
      `  apenas retido (só métrica retido):     ${cruz[k].apenasRetido}`,
      `  ambos (liberado e retido):             ${cruz[k].ambos}`,
      `  nenhum (nem liberado nem retido):     ${cruz[k].nenhum}`,
    ]),
    '',
    '— Fim do relatório —',
    '',
  ].join('\n');

  fs.mkdirSync(dirOut, { recursive: true });
  fs.writeFileSync(arquivo, texto, 'utf8');

  console.log('[relatorioAdministrativoN2Pix] Arquivo gerado:', arquivo);
  console.log('[relatorioAdministrativoN2Pix] Total registros:', docs.length);
  await client.close();
}

main().catch((e) => {
  console.error('[relatorioAdministrativoN2Pix]', e);
  process.exit(1);
});
