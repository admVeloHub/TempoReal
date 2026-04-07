/**
 * Painel Reclamações Tempo Real - Stats Route
 * VERSION: v1.19.1
 *
 * porTipo: emAberto em todos os canais (calcularStatsPorTipo). N1 no card exibe Em Aberto; RA/Bacen/Procon/N2 somam semResposta, opCancelada.
 *
 * GET /: dataInicio, dataFim (YYYY-MM-DD). Intervalo = início/fim do dia no fuso STATS_TZ (padrão America/Sao_Paulo), não meia-noite UTC. Default início 2026-01-01; fim omitido = fim do dia nesse fuso hoje.
 *
 * Campos de data para filtro (LISTA_SCHEMAS.rb):
 * - Bacen: dataEntrada (não usar createdAt)
 * - N2: dataEntradaN2
 * - Reclame Aqui: dataReclam
 * - Procon: dataProcon
 * - N1 Octadesk (card): período só em createdAt (LISTA_SCHEMAS). Sem filtro produto/motivo da UI: reclamações_n1Stats já é só tickets N1 elegíveis ao ingest.
 *
 * motivoReduzido: sempre tratado como array. Padrão exato: "Liberação Chave Pix".
 * percRetencao: pixRetido / solLiberacao × 100 (ocorrências = universo Liberação Chave Pix); 0 se solLiberacao = 0.
 * solLiberacao / docsLiberacaoChavePix: Liberação Chave Pix. N1: motivoN1ContaComoLiberacaoParaMetricas(motivoReduzido); outras: motivos_chave_pix se preenchido; senão detalhe_2026; senão motivoReduzido.
 * N1 resolvido / taxa resolução (card): currentStatusName “Resolvido” (normalizeTextOctadesk), não só Finalizado.Resolvido.
 * N1 (card): Ocorrências = docs após filtro Mongo; Escalado N2 = escalar_chamado “Casos Especiais - Ouvidoria”; Retidos = retido_no_atendimento === true; Em Aberto = currentStatusName ≠ Resolvido (vazio = aberto). JSON mantém pixLiberado/pixRetido/solLiberacao para o Dashboard; N1 solLiberacao = ocorrencias do filtro.
 * Filtro produto ouvidoria (Bacen, N2, RA, Procon): campo produto.
 * Parâmetro motivo (UI): ouvidoria (Bacen, N2, RA, Procon) usa criarFiltroMotivoItemOuvidoria. N1 ignora produto e motivo no find — o card reflete todos os documentos da collection no período.
 * emAberto ouvidoria: !Finalizado.Resolvido.
 */

const express = require('express');
const { DateTime } = require('luxon');
const router = express.Router();

/** Calendário YYYY-MM-DD para filtros (padrão Brasil). Sobrescreva com STATS_TZ se necessário. */
const STATS_DATE_ZONE = process.env.STATS_TZ || 'America/Sao_Paulo';
const {
  N1_STATS_COLLECTION,
  motivoN1ContaComoLiberacaoParaMetricas,
  normalizeTextOctadesk,
  expandMotivoLiberacaoChavePixParaMongoIn,
} = require('../services/octadeskIngestService');

const MOTIVO_LIBERACAO_CHAVE_PIX = 'liberação chave pix';
const MOTIVO_LIBERACAO_CHAVE_PIX_SEM_ACENTO = 'liberacao chave pix';

/**
 * motivoReduzido sempre tratado como array. Verifica se algum item é exatamente "Liberação Chave Pix".
 */
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

/** Normaliza motivo para comparar "Cancelamento 7 dias" vs "Cancelamento até 7 dias" (acentos irrelevantes). */
function canonMotivoOpCancelada7Dias(valor) {
  return String(valor)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ');
}

/** Grafias aceitas após normalização (até → ate). */
const MOTIVOS_OP_CANCELADA_CANON = new Set(['cancelamento 7 dias', 'cancelamento ate 7 dias']);

/** motivoReduzido como array ou string: contém item de operação cancelada 7 dias (vide formulário N2). */
function motivoContemCancelamento7Dias(motivoReduzido) {
  const itens = Array.isArray(motivoReduzido)
    ? motivoReduzido
    : motivoReduzido != null && motivoReduzido !== ''
      ? [String(motivoReduzido)]
      : [];
  return itens.some((item) => MOTIVOS_OP_CANCELADA_CANON.has(canonMotivoOpCancelada7Dias(item)));
}

/** Normalização alinhada a octadeskIngestService (campo detalhe_2026). */
function normalizarDetalheStats(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

const DETALHE_LIBERACAO_CHAVE_PIX_NORM = 'liberacao chave pix';
/** Motivos da UI que identificam linha de produto Antecipação; em ouvidoria o valor costuma estar em produto, não em motivoReduzido. */
const MOTIVO_PARAM_ALINHA_PRODUTO_OUVIDORIA = {
  'Antecipação - 2026': ['Antecipação - 2026', 'Antecipação 2026', 'Antecipação'],
  'Antecipação - Outros Anos': ['Antecipação - Outros Anos', 'Antecipacao'],
};

/** Rótulo do filtro “Motivo” = liberação chave Pix: no Octadesk também vem “Chave Pix” sem “Liberação”. */
const MOTIVO_UI_LIBERACAO_CHAVE_PIX = 'Liberação chave pix';

/**
 * YYYY-MM-DD → início/fim de dia no fuso STATS_DATE_ZONE (Luxon). Mongo compara instantes em UTC corretamente.
 */
function parseDataDiaLocalInicio(yyyyMmDd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(yyyyMmDd ?? '').trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const dt = DateTime.fromISO(iso, { zone: STATS_DATE_ZONE });
  if (!dt.isValid) return null;
  return dt.startOf('day').toJSDate();
}

function parseDataDiaLocalFim(yyyyMmDd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(yyyyMmDd ?? '').trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const dt = DateTime.fromISO(iso, { zone: STATS_DATE_ZONE });
  if (!dt.isValid) return null;
  return dt.endOf('day').toJSDate();
}

function hojeFimDiaLocal() {
  return DateTime.now().setZone(STATS_DATE_ZONE).endOf('day').toJSDate();
}

/** Rotas GET /api/stats: default início 2026-01-01; fim omitido = fim do dia no fuso STATS_DATE_ZONE. */
function normalizarIntervaloDatasQueryStats(dataInicioRaw, dataFimRaw) {
  const defaultInicio = '2026-01-01';
  const inRaw = (dataInicioRaw && String(dataInicioRaw).trim()) || defaultInicio;
  let dataInicio = parseDataDiaLocalInicio(inRaw);
  if (!dataInicio) dataInicio = parseDataDiaLocalInicio(defaultInicio);

  let dataFim;
  if (dataFimRaw && String(dataFimRaw).trim()) {
    dataFim = parseDataDiaLocalFim(String(dataFimRaw).trim());
    if (!dataFim) dataFim = hojeFimDiaLocal();
  } else {
    dataFim = hojeFimDiaLocal();
  }

  if (dataInicio.getTime() > dataFim.getTime()) {
    const di = DateTime.fromJSDate(dataInicio, { zone: STATS_DATE_ZONE });
    const df = DateTime.fromJSDate(dataFim, { zone: STATS_DATE_ZONE });
    dataInicio = df.startOf('day').toJSDate();
    dataFim = di.endOf('day').toJSDate();
  }

  return { dataInicio, dataFim };
}

function dataInicioOpcionalQueryLocal(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  return parseDataDiaLocalInicio(String(raw).trim());
}

function dataFimOpcionalQueryLocal(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  return parseDataDiaLocalFim(String(raw).trim());
}

/** Documento da coleção reclamações_n1Stats (Octadesk). */
function isDocN1Stats(r) {
  if (r == null) return false;
  const n = r.octadeskNumber;
  return n != null && String(n).trim() !== '' && !Number.isNaN(Number(n));
}

function documentoEscaladoN2ContagemN1(r) {
  const v = r?.escalar_chamado;
  if (v == null || String(v).trim() === '') return false;
  return normalizeTextOctadesk(String(v)) === normalizeTextOctadesk('Casos Especiais - Ouvidoria');
}

function documentoRetidoContagemN1(r) {
  return r != null && r.retido_no_atendimento === true;
}

/** Em aberto N1: status Octadesk ≠ Resolvido (mesma normalização do webhook). Ausente ou vazio = aberto. */
function documentoEmAbertoN1PorStatus(r) {
  const name = r?.currentStatusName;
  if (name == null || String(name).trim() === '') return true;
  return normalizeTextOctadesk(String(name)) !== normalizeTextOctadesk('Resolvido');
}

/**
 * Universo "Ocorrências" / Liberação Chave Pix.
 * N1 (octadeskNumber): motivoN1ContaComoLiberacaoParaMetricas(r.motivoReduzido).
 * Outras coleções: motivos_chave_pix se preenchido; senão detalhe_2026; senão motivoReduzido.
 */
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

/**
 * Campos de data por coleção (LISTA_SCHEMAS.rb). NÃO usar createdAt para Bacen/N2/RA/Procon.
 */
const CAMPOS_DATA_POR_COLLECTION = {
  reclamacoes_bacen: 'dataEntrada',
  reclamacoes_n2Pix: 'dataEntradaN2',
  reclamacoes_reclameAqui: 'dataReclam',
  reclamacoes_procon: 'dataProcon',
  reclamacoes_judicial: 'dataEntrada',
  reclamacoes_n1Stats: 'createdAt',
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

/**
 * N1 card: período só em createdAt (OpenDate no ingest). Limites = normalizarIntervaloDatasQueryStats.
 */
function criarFiltroPeriodoN1PorCreatedAt(dataInicio, dataFim) {
  if (!dataInicio && !dataFim) return {};
  let di = dataInicio ? new Date(dataInicio) : null;
  let df = dataFim ? new Date(dataFim) : null;
  if (di && Number.isNaN(di.getTime())) di = null;
  if (df && Number.isNaN(df.getTime())) df = null;
  if (di && df && di.getTime() > df.getTime()) {
    const t = di.getTime();
    di = new Date(df);
    df = new Date(t);
  }
  const condicoesDataInicio = di ? { $gte: di } : {};
  const condicoesDataFim = df ? { $lte: df } : {};
  const condicoesData = { ...condicoesDataInicio, ...condicoesDataFim };
  return {
    createdAt: { $exists: true, $ne: null, ...condicoesData },
  };
}

function criarFiltroProduto(produtos) {
  if (!produtos || !Array.isArray(produtos) || produtos.length === 0) return {};
  const valores = produtos.filter(p => p && String(p).trim());
  if (valores.length === 0) return {};
  return { produto: { $in: valores } };
}

/**
 * Dentro do mesmo filtro: aditivo (OR).
 * - Produtos: $in = casos com produto 1 OU produto 2.
 * - Motivos: $or = casos com motivo 1 OU motivo 2.
 * Entre produto e motivo: AND (caso deve ter produto E motivo selecionados).
 */
function mesclarFiltros(filtroData, filtroProduto, filtroMotivo = {}) {
  return { ...filtroData, ...filtroProduto, ...filtroMotivo };
}

/**
 * motivoReduzido: String (Bacen, N1) ou [String] (RA, Procon, N2).
 * Usa $regex para funcionar em ambos os tipos.
 */
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
    $or: [
      porMotivo,
      { produto: { $in: produtosLinha } },
    ],
  };
}

function criarFiltroMotivo(motivos) {
  if (!motivos || !Array.isArray(motivos) || motivos.length === 0) return {};
  const valores = motivos.filter(m => m && String(m).trim()).map(m => String(m).trim());
  if (valores.length === 0) return {};
  const condicoes = valores.map((m) => criarFiltroMotivoItemOuvidoria(m));
  return condicoes.length === 1 ? condicoes[0] : { $or: condicoes };
}

/** Chave única para agrupar variantes do mesmo motivo (caixa, acentos, espaços). */
function chaveCanonicaMotivo(display) {
  const s = String(display).trim().replace(/\s+/g, ' ');
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

/**
 * Para motivosPorDia: cada documento deve contar no máximo 1 vez por motivo lógico no dia.
 * motivoReduzido pode repetir entradas ou trazer variantes (espaços, caixa, acentuação).
 * Retorna rótulos únicos (por chave canônica) para agregação.
 */
function motivosUnicosParaTabelaPorDia(motivoReduzido) {
  const raw = Array.isArray(motivoReduzido)
    ? motivoReduzido.filter((m) => m != null && String(m).trim())
    : motivoReduzido != null && String(motivoReduzido).trim()
      ? [motivoReduzido]
      : [];
  const porCanon = new Map();
  raw.forEach((m) => {
    const display = String(m).trim().replace(/\s+/g, ' ');
    if (!display) return;
    const canon = chaveCanonicaMotivo(display);
    if (!porCanon.has(canon)) porCanon.set(canon, display);
  });
  return Array.from(porCanon.values());
}

/**
 * Agrega motivosPorDia por chave canônica entre todos os documentos/dias.
 * O rótulo exibido é a grafia mais frequente no período (empate: ordem pt-BR).
 */
function criarAgregadorMotivosPorDia() {
  const porCanon = new Map();
  return {
    add(dia, displayRaw) {
      const display = String(displayRaw).trim().replace(/\s+/g, ' ');
      if (!display) return;
      const canon = chaveCanonicaMotivo(display);
      let entry = porCanon.get(canon);
      if (!entry) {
        entry = { dias: {}, votosRotulo: new Map() };
        porCanon.set(canon, entry);
      }
      entry.votosRotulo.set(display, (entry.votosRotulo.get(display) || 0) + 1);
      entry.dias[dia] = (entry.dias[dia] || 0) + 1;
    },
    toMotivosPorDia() {
      const out = {};
      porCanon.forEach((entry) => {
        let melhor = '';
        let nMelhor = -1;
        entry.votosRotulo.forEach((n, lab) => {
          if (n > nMelhor || (n === nMelhor && lab.localeCompare(melhor, 'pt-BR') < 0)) {
            nMelhor = n;
            melhor = lab;
          }
        });
        out[melhor] = { ...entry.dias };
      });
      const sorted = {};
      Object.keys(out)
        .sort((a, b) => a.localeCompare(b, 'pt-BR'))
        .forEach((k) => {
          sorted[k] = out[k];
        });
      return sorted;
    },
  };
}

const PRODUTO_SEM_VALOR = '(Sem produto)';

function normalizarChaveProduto(produto) {
  if (produto == null || String(produto).trim() === '') return PRODUTO_SEM_VALOR;
  return String(produto).trim();
}

/**
 * Taxa de resolução e “resolvido”: N1 usa status Octadesk (currentStatusName); demais canais Finalizado.Resolvido === true.
 */
function documentoResolvidoParaMetricas(r) {
  if (r == null) return false;
  if (isDocN1Stats(r)) {
    const name = r.currentStatusName;
    if (name == null || String(name).trim() === '') return false;
    return normalizeTextOctadesk(String(name)) === normalizeTextOctadesk('Resolvido');
  }
  return r.Finalizado != null && r.Finalizado.Resolvido === true;
}

/** N1: só retido_no_atendimento === false. Ouvidoria: retido_no_atendimento ou legado pixLiberado. */
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

/**
 * Métricas do card N1 sobre o conjunto já filtrado (LISTA_SCHEMAS: escalar_chamado, retido_no_atendimento, currentStatusName).
 * Mantém chaves do JSON esperadas pelo Dashboard (pixLiberado = Escalado N2, pixRetido = Retidos).
 */
function calcularStatsCardN1(docs) {
  const ocorrencias = docs.length;
  const emAberto = docs.filter((r) => documentoEmAbertoN1PorStatus(r)).length;
  const resolvido = docs.filter((r) => documentoResolvidoParaMetricas(r)).length;
  const caEProtocolos = docs.filter((r) => (
    r.acionouCentral === true ||
    (r.protocolosCentral && Array.isArray(r.protocolosCentral) && r.protocolosCentral.length > 0) ||
    r.n2SegundoNivel === true ||
    (r.protocolosN2 && Array.isArray(r.protocolosN2) && r.protocolosN2.length > 0) ||
    r.reclameAqui === true ||
    (r.protocolosReclameAqui && Array.isArray(r.protocolosReclameAqui) && r.protocolosReclameAqui.length > 0) ||
    r.procon === true ||
    (r.protocolosProcon && Array.isArray(r.protocolosProcon) && r.protocolosProcon.length > 0)
  )).length;
  const pixLiberado = docs.filter((r) => documentoEscaladoN2ContagemN1(r)).length;
  const pixRetido = docs.filter((r) => documentoRetidoContagemN1(r)).length;
  const solLiberacao = ocorrencias;
  const percRetencao =
    solLiberacao > 0 ? Math.round((pixRetido / solLiberacao) * 1000) / 10 : 0;
  const taxaResolucao = ocorrencias > 0 ? Math.round((resolvido / ocorrencias) * 1000) / 10 : 0;
  return {
    ocorrencias,
    emAberto,
    resolvido,
    caEProtocolos,
    solLiberacao,
    pixLiberado,
    pixRetido,
    percRetencao,
    taxaResolucao,
  };
}

function calcularStatsPorTipo(docs) {
  const ocorrencias = docs.length;
  const emAberto = docs.filter((r) => (
    isDocN1Stats(r) ? documentoEmAbertoN1PorStatus(r) : !documentoResolvidoParaMetricas(r)
  )).length;
  const resolvido = docs.filter((r) => documentoResolvidoParaMetricas(r)).length;
  const caEProtocolos = docs.filter(r => (
    r.acionouCentral === true ||
    (r.protocolosCentral && Array.isArray(r.protocolosCentral) && r.protocolosCentral.length > 0) ||
    r.n2SegundoNivel === true ||
    (r.protocolosN2 && Array.isArray(r.protocolosN2) && r.protocolosN2.length > 0) ||
    r.reclameAqui === true ||
    (r.protocolosReclameAqui && Array.isArray(r.protocolosReclameAqui) && r.protocolosReclameAqui.length > 0) ||
    r.procon === true ||
    (r.protocolosProcon && Array.isArray(r.protocolosProcon) && r.protocolosProcon.length > 0)
  )).length;

  const docsLiberacaoChavePix = docs.filter((r) => documentoELiberacaoChavePixExclusivo(r));
  const solLiberacao = docsLiberacaoChavePix.length;

  /** N1: Escalado N2 e Retidos sobre todas as ocorrências; demais canais inalterados (só docs Liberação Chave Pix). */
  const somaEscaladoN2 =
    docs.filter((r) => isDocN1Stats(r) && documentoEscaladoN2ContagemN1(r)).length +
    docsLiberacaoChavePix.filter((r) => !isDocN1Stats(r) && documentoLiberadoChavePixParaMetricas(r)).length;
  const somaRetidos =
    docs.filter((r) => isDocN1Stats(r) && documentoRetidoContagemN1(r)).length +
    docsLiberacaoChavePix.filter(
      (r) => !isDocN1Stats(r) && documentoResolvidoParaMetricas(r) && !documentoLiberadoChavePixParaMetricas(r)
    ).length;

  const pixLiberado = somaEscaladoN2;
  const pixRetido = somaRetidos;
  const percRetencao =
    solLiberacao > 0 ? Math.round((pixRetido / solLiberacao) * 1000) / 10 : 0;

  const taxaResolucao = ocorrencias > 0 ? Math.round((resolvido / ocorrencias) * 1000) / 10 : 0;

  return {
    ocorrencias,
    emAberto,
    resolvido,
    caEProtocolos,
    solLiberacao,
    pixLiberado,
    pixRetido,
    percRetencao,
    taxaResolucao,
  };
}

/** Mostradores adicionais dos cards ouvidoria (Bacen, N2, RA, Procon): LISTA_SCHEMAS semRespostaCliente + motivo cancelamento 7 dias. */
function enrichComMostradoresOuvidoria(baseStats, docs) {
  const semResposta = docs.filter(
    (r) => documentoResolvidoParaMetricas(r) && r.semRespostaCliente === true
  ).length;
  const opCancelada = docs.filter((r) => motivoContemCancelamento7Dias(r.motivoReduzido)).length;
  return { ...baseStats, semResposta, opCancelada };
}

/**
 * GET /api/stats
 * Query params: dataInicio, dataFim, produto (array), motivo (array)
 * Defaults: dataInicio 2026-01-01, dataFim fim do dia em STATS_TZ. produto/motivo vazios: sem filtro nesse eixo nas ouvidorias. N1: só período em createdAt; ignora produto e motivo da query.
 */
function initStatsRoutes(connectToMongo) {
  router.get('/', async (req, res) => {
    console.log('[GET /api/stats]', req.query.dataInicio || '(default)', '| produto:', req.query.produto || '(nenhum)', '| motivo:', req.query.motivo || '(nenhum)');
    try {
      let client;
      try {
        client = await connectToMongo();
      } catch (err) {
        return res.status(503).json({
          success: false,
          message: 'MongoDB não configurado: ' + err.message,
          data: { porTipo: {} }
        });
      }
      const db = client.db('hub_ouvidoria');

      const dataInicioRaw = (req.query.dataInicio && String(req.query.dataInicio).trim()) || '2026-01-01';
      const dataFimRaw = req.query.dataFim;
      const { dataInicio, dataFim } = normalizarIntervaloDatasQueryStats(req.query.dataInicio, req.query.dataFim);

      const produtosRaw = req.query.produto;
      const produtos = typeof produtosRaw === 'string'
        ? produtosRaw.split(',').map((p) => p.trim()).filter(Boolean)
        : Array.isArray(produtosRaw)
          ? produtosRaw.filter((p) => p && String(p).trim()).map((p) => String(p).trim())
          : [];

      const motivosRaw = req.query.motivo;
      const motivos = typeof motivosRaw === 'string'
        ? motivosRaw.split(',').map((m) => m.trim()).filter(Boolean)
        : Array.isArray(motivosRaw)
          ? motivosRaw.filter((m) => m && String(m).trim()).map((m) => String(m).trim())
          : [];


      const filtroProduto = criarFiltroProduto(produtos);
      const filtroMotivo = criarFiltroMotivo(motivos);

      const filtroDataBacen = criarFiltroDataPorCollection('reclamacoes_bacen', dataInicio, dataFim);
      const filtroDataN2 = criarFiltroDataPorCollection('reclamacoes_n2Pix', dataInicio, dataFim);
      const filtroDataRA = criarFiltroDataPorCollection('reclamacoes_reclameAqui', dataInicio, dataFim);
      const filtroDataProcon = criarFiltroDataPorCollection('reclamacoes_procon', dataInicio, dataFim);
      const filtroDataN1 = criarFiltroPeriodoN1PorCreatedAt(dataInicio, dataFim);

      const filtroBacen = mesclarFiltros(filtroDataBacen, filtroProduto, filtroMotivo);
      const filtroN2 = mesclarFiltros(filtroDataN2, filtroProduto, filtroMotivo);
      const filtroReclameAqui = mesclarFiltros(filtroDataRA, filtroProduto, filtroMotivo);
      const filtroProcon = mesclarFiltros(filtroDataProcon, filtroProduto, filtroMotivo);
      const filtroN1 = { ...filtroDataN1 };

      console.log('[STATS_FILTROS]', {
        camposData: { bacen: 'dataEntrada', n2: 'dataEntradaN2', ra: 'dataReclam', procon: 'dataProcon', n1: 'createdAt' },
        campoMotivoFiltro: 'motivoReduzido',
        n1SemFiltroMotivoProduto: true,
        statsRoute: 'v1.19.1',
        statsTz: STATS_DATE_ZONE,
        dataInicio: dataInicioRaw,
        dataFim: dataFimRaw || '(hoje)',
        filtroBacen: JSON.stringify(filtroBacen),
        filtroN2: JSON.stringify(filtroN2),
        filtroRA: JSON.stringify(filtroReclameAqui),
        filtroProcon: JSON.stringify(filtroProcon),
        filtroN1: JSON.stringify(filtroN1),
      });

      const [bacen, n2Pix, reclameAquiDocs, proconDocs, n1Docs] = await Promise.all([
        db.collection('reclamacoes_bacen').find(filtroBacen).toArray(),
        db.collection('reclamacoes_n2Pix').find(filtroN2).toArray(),
        db.collection('reclamacoes_reclameAqui').find(filtroReclameAqui).toArray(),
        db.collection('reclamacoes_procon').find(filtroProcon).toArray(),
        db.collection(N1_STATS_COLLECTION).find(filtroN1).toArray(),
      ]);

      console.log('[GET /api/stats] stats v1.19.1 | n1Docs:', n1Docs.length, '| filtroN1 keys:', Object.keys(filtroN1));

      const todas = [...bacen, ...n2Pix, ...reclameAquiDocs, ...proconDocs, ...n1Docs];

      const porTipo = {
        N1: calcularStatsCardN1(n1Docs),
        N2: enrichComMostradoresOuvidoria(calcularStatsPorTipo(n2Pix), n2Pix),
        'Reclame Aqui': enrichComMostradoresOuvidoria(calcularStatsPorTipo(reclameAquiDocs), reclameAquiDocs),
        Bacen: enrichComMostradoresOuvidoria(calcularStatsPorTipo(bacen), bacen),
        Procon: enrichComMostradoresOuvidoria(calcularStatsPorTipo(proconDocs), proconDocs),
        Total: calcularStatsPorTipo(todas),
      };

      const pixLiberadoPorTipo = {
        bacen: bacen.filter((r) => documentoELiberacaoChavePixExclusivo(r) && documentoLiberadoChavePixParaMetricas(r)).length,
        n2: n2Pix.filter((r) => documentoELiberacaoChavePixExclusivo(r) && documentoLiberadoChavePixParaMetricas(r)).length,
        ra: reclameAquiDocs.filter((r) => documentoELiberacaoChavePixExclusivo(r) && documentoLiberadoChavePixParaMetricas(r)).length,
        procon: proconDocs.filter((r) => documentoELiberacaoChavePixExclusivo(r) && documentoLiberadoChavePixParaMetricas(r)).length,
        n1: n1Docs.filter((r) => documentoEscaladoN2ContagemN1(r)).length,
        total: todas.filter((r) => (
          isDocN1Stats(r)
            ? documentoEscaladoN2ContagemN1(r)
            : documentoELiberacaoChavePixExclusivo(r) && documentoLiberadoChavePixParaMetricas(r)
        )).length,
      };
      console.log('[STATS_RESULT]', JSON.stringify({
        filtros: { dataInicio: dataInicioRaw, dataFim: dataFimRaw || '(hoje)', produtos, motivos },
        docsRetornados: { bacen: bacen.length, n2: n2Pix.length, ra: reclameAquiDocs.length, procon: proconDocs.length, n1: n1Docs.length, total: todas.length },
        pixLiberadoNoPeriodo: pixLiberadoPorTipo,
        porTipo,
      }));

      res.json({
        success: true,
        data: { porTipo }
      });
    } catch (error) {
      console.error('Erro ao buscar estatísticas:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao buscar estatísticas',
        error: error.message,
        data: { porTipo: {} }
      });
    }
  });

  const CONFIG_AUXILIAR = {
    ra: { collection: 'reclamacoes_reclameAqui', dateField: CAMPOS_DATA_POR_COLLECTION.reclamacoes_reclameAqui },
    bacen: { collection: 'reclamacoes_bacen', dateField: CAMPOS_DATA_POR_COLLECTION.reclamacoes_bacen },
    procon: { collection: 'reclamacoes_procon', dateField: CAMPOS_DATA_POR_COLLECTION.reclamacoes_procon },
    n2: { collection: 'reclamacoes_n2Pix', dateField: CAMPOS_DATA_POR_COLLECTION.reclamacoes_n2Pix },
    judicial: { collection: 'reclamacoes_judicial', dateField: CAMPOS_DATA_POR_COLLECTION.reclamacoes_judicial },
  };

  // Valores de origem (Bacen) - NÃO usar como linhas da tabela Motivo
  const ORIGEM_BACEN = new Set(['Bacen Celcoin', 'Bacen Via Capital', 'Consumidor.Gov']);

  function isOrigemBacen(valor) {
    if (!valor || typeof valor !== 'string') return false;
    return ORIGEM_BACEN.has(valor.trim());
  }

  async function buscarStatsAuxiliar(db, tipo, dataInicio, dataFim, produtos, motivos) {
    const config = CONFIG_AUXILIAR[tipo];
    if (!config) return null;
    const { collection: collName, dateField } = config;
    const filtroData = criarFiltroDataPorCollection(collName, dataInicio, dataFim);
    const filtroProduto = criarFiltroProduto(produtos);
    const filtroMotivo = criarFiltroMotivo(motivos);
    const filtro = mesclarFiltros(filtroData, filtroProduto, filtroMotivo);
    const docs = await db.collection(collName).find(filtro).toArray();

    const diaStr = (d) => {
      if (!d) return null;
      const dt = new Date(d);
      return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
    };

    // Contagem de dias: dataEntrada (Bacen), dataProcon, dataEntradaN2, dataReclam
    const diasSet = new Set();
    docs.forEach((doc) => {
      const dia = diaStr(doc[dateField]);
      if (dia) diasSet.add(dia);
    });
    if (tipo === 'procon') {
      docs.forEach((doc) => {
        if (doc.processoEncerrado === true && doc.dataProcessoEncerrado) {
          const dia = diaStr(doc.dataProcessoEncerrado);
          if (dia) diasSet.add(dia);
        }
        if (doc.clienteDesistiu === true && doc.Finalizado?.dataResolucao) {
          const dia = diaStr(doc.Finalizado.dataResolucao);
          if (dia) diasSet.add(dia);
        }
        if (doc.encaminhadoJuridico === true && doc.processoEncaminhadoData) {
          const dia = diaStr(doc.processoEncaminhadoData);
          if (dia) diasSet.add(dia);
        }
      });
    }
    const diasOrdenados = Array.from(diasSet).sort();

    const reclamacoesPorDia = [];
    const agregadorMotivos = criarAgregadorMotivosPorDia();
    const totaisPorProdutoMap = new Map();
    const agregadoresPorProduto = new Map();
    const jornadaPorDia = {};

    diasOrdenados.forEach((dia) => {
      const docsDoDia = docs.filter((d) => diaStr(d[dateField]) === dia);
      const total = docsDoDia.length;
      let solicitadoAvaliacao;
      let avaliado;
      if (tipo === 'procon') {
        solicitadoAvaliacao = docs.filter((d) => d.clienteDesistiu === true && diaStr(d.Finalizado?.dataResolucao) === dia).length;
        avaliado = docs.filter((d) => d.processoEncerrado === true && diaStr(d.dataProcessoEncerrado) === dia).length;
      }
      let encaminhadoJuridico = 0;
      if (tipo === 'procon') {
        encaminhadoJuridico = docs.filter((d) => d.encaminhadoJuridico === true && diaStr(d.processoEncaminhadoData) === dia).length;
      }
      if (tipo !== 'procon') {
        solicitadoAvaliacao = docsDoDia.filter((d) => d.solicitadoAvaliacao === true).length;
        avaliado = docsDoDia.filter((d) => d.avaliado === true).length;
      }
      const acionouCentral = docsDoDia.filter((d) => d.acionouCentral === true).length;
      const n2SegundoNivel = docsDoDia.filter((d) => d.n2SegundoNivel === true).length;
      const procon = docsDoDia.filter((d) => d.procon === true).length;
      const reclameAqui = docsDoDia.filter((d) => d.reclameAqui === true).length;
      const bacen = tipo === 'bacen' ? total : 0;
      const itemDia = { dia, total, solicitadoAvaliacao, avaliado };
      if (tipo === 'procon') itemDia.encaminhadoJuridico = encaminhadoJuridico;
      reclamacoesPorDia.push(itemDia);
      jornadaPorDia[dia] = { total, reclameAqui, bacen, acionouCentral, n2SegundoNivel, procon };

      // Tabela Reclamações por Dia: linhas = motivoReduzido (excluir origem para Bacen)
      docsDoDia.forEach((d) => {
        const produtoKey = normalizarChaveProduto(d.produto);
        if (!totaisPorProdutoMap.has(produtoKey)) totaisPorProdutoMap.set(produtoKey, new Map());
        const porDiaProd = totaisPorProdutoMap.get(produtoKey);
        porDiaProd.set(dia, (porDiaProd.get(dia) || 0) + 1);

        if (!agregadoresPorProduto.has(produtoKey)) {
          agregadoresPorProduto.set(produtoKey, criarAgregadorMotivosPorDia());
        }
        const aggProd = agregadoresPorProduto.get(produtoKey);

        motivosUnicosParaTabelaPorDia(d.motivoReduzido).forEach((motivo) => {
          if (tipo === 'bacen' && isOrigemBacen(motivo)) return; // origem ≠ motivo
          agregadorMotivos.add(dia, motivo);
          aggProd.add(dia, motivo);
        });
      });
    });

    const motivosPorDia = agregadorMotivos.toMotivosPorDia();

    const chavesProdutoAux = Array.from(
      new Set([...totaisPorProdutoMap.keys(), ...agregadoresPorProduto.keys()])
    ).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const totaisPorProdutoPorDia = {};
    const motivosPorProdutoPorDia = {};
    chavesProdutoAux.forEach((pk) => {
      const porDia = totaisPorProdutoMap.get(pk);
      totaisPorProdutoPorDia[pk] = {};
      if (porDia) {
        Array.from(porDia.keys())
          .sort()
          .forEach((d) => {
            totaisPorProdutoPorDia[pk][d] = porDia.get(d);
          });
      }
      const agg = agregadoresPorProduto.get(pk);
      motivosPorProdutoPorDia[pk] = agg ? agg.toMotivosPorDia() : {};
    });

    return {
      stats: calcularStatsPorTipo(docs),
      reclamacoesPorDia,
      motivosPorDia,
      totaisPorProdutoPorDia,
      motivosPorProdutoPorDia,
      jornadaDoReclamante: jornadaPorDia,
      dias: diasOrdenados,
    };
  }

  /**
   * GET /api/stats/ra
   * Filtros via query: dataInicio, dataFim, produto, motivo
   * Retorna stats de Reclame Aqui filtrados
   */
  router.get('/ra', async (req, res) => {
    try {
      let client;
      try {
        client = await connectToMongo();
      } catch (err) {
        return res.status(503).json({
          success: false,
          message: 'MongoDB não configurado: ' + err.message,
          data: { 'Reclame Aqui': null }
        });
      }
      const db = client.db('hub_ouvidoria');

      const dataInicio = dataInicioOpcionalQueryLocal(req.query.dataInicio);
      const dataFim = dataFimOpcionalQueryLocal(req.query.dataFim);

      const produtosRaw = req.query.produto;
      const produtos = Array.isArray(produtosRaw)
        ? produtosRaw.filter(p => p && String(p).trim()).map(p => String(p).trim())
        : (produtosRaw && String(produtosRaw).trim() ? [String(produtosRaw).trim()] : []);

      const motivosRaw = req.query.motivo;
      const motivos = Array.isArray(motivosRaw)
        ? motivosRaw.filter(m => m && String(m).trim()).map(m => String(m).trim())
        : (motivosRaw && String(motivosRaw).trim() ? [String(motivosRaw).trim()] : []);

      const filtroData = criarFiltroDataPorCollection('reclamacoes_reclameAqui', dataInicio, dataFim);
      const filtroProduto = criarFiltroProduto(produtos);
      const filtroMotivo = criarFiltroMotivo(motivos);
      const filtro = mesclarFiltros(filtroData, filtroProduto, filtroMotivo);

      const reclameAquiDocs = await db.collection('reclamacoes_reclameAqui').find(filtro).toArray();
      const stats = calcularStatsPorTipo(reclameAquiDocs);

      const reclamacoesPorDia = [];
      const agregadorMotivos = criarAgregadorMotivosPorDia();
      const totaisPorProdutoMap = new Map();
      const agregadoresPorProduto = new Map();
      const jornadaPorDia = {};

      const diaStr = (d) => {
        if (!d) return null;
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return null;
        return dt.toISOString().slice(0, 10);
      };

      const diasSet = new Set();
      reclameAquiDocs.forEach((doc) => {
        const dia = diaStr(doc.dataReclam);
        if (!dia) return;
        diasSet.add(dia);
      });

      const diasOrdenados = Array.from(diasSet).sort();

      diasOrdenados.forEach((dia) => {
        const docsDoDia = reclameAquiDocs.filter((d) => diaStr(d.dataReclam) === dia);
        const total = docsDoDia.length;
        const solicitadoAvaliacao = docsDoDia.filter((d) => d.solicitadoAvaliacao === true).length;
        const avaliado = docsDoDia.filter((d) => d.avaliado === true).length;
        const acionouCentral = docsDoDia.filter((d) => d.acionouCentral === true).length;
        const n2SegundoNivel = docsDoDia.filter((d) => d.n2SegundoNivel === true).length;
        const procon = docsDoDia.filter((d) => d.procon === true).length;
        const reclameAqui = docsDoDia.filter((d) => d.reclameAqui === true).length;
        const bacen = 0;
        reclamacoesPorDia.push({ dia, total, solicitadoAvaliacao, avaliado });
        jornadaPorDia[dia] = { total, reclameAqui, bacen, acionouCentral, n2SegundoNivel, procon };

        docsDoDia.forEach((d) => {
          const produtoKey = normalizarChaveProduto(d.produto);
          if (!totaisPorProdutoMap.has(produtoKey)) totaisPorProdutoMap.set(produtoKey, new Map());
          const porDiaProd = totaisPorProdutoMap.get(produtoKey);
          porDiaProd.set(dia, (porDiaProd.get(dia) || 0) + 1);

          if (!agregadoresPorProduto.has(produtoKey)) {
            agregadoresPorProduto.set(produtoKey, criarAgregadorMotivosPorDia());
          }
          const aggProd = agregadoresPorProduto.get(produtoKey);
          motivosUnicosParaTabelaPorDia(d.motivoReduzido).forEach((motivo) => {
            agregadorMotivos.add(dia, motivo);
            aggProd.add(dia, motivo);
          });
        });
      });

      const motivosPorDia = agregadorMotivos.toMotivosPorDia();

      const chavesProduto = Array.from(
        new Set([...totaisPorProdutoMap.keys(), ...agregadoresPorProduto.keys()])
      ).sort((a, b) => a.localeCompare(b, 'pt-BR'));
      const totaisPorProdutoPorDia = {};
      const motivosPorProdutoPorDia = {};
      chavesProduto.forEach((pk) => {
        const porDia = totaisPorProdutoMap.get(pk);
        totaisPorProdutoPorDia[pk] = {};
        if (porDia) {
          Array.from(porDia.keys())
            .sort()
            .forEach((d) => {
              totaisPorProdutoPorDia[pk][d] = porDia.get(d);
            });
        }
        const agg = agregadoresPorProduto.get(pk);
        motivosPorProdutoPorDia[pk] = agg ? agg.toMotivosPorDia() : {};
      });

      res.json({
        success: true,
        data: {
          'Reclame Aqui': stats,
          reclamacoesPorDia,
          motivosPorDia,
          totaisPorProdutoPorDia,
          motivosPorProdutoPorDia,
          jornadaDoReclamante: jornadaPorDia,
          dias: diasOrdenados,
        }
      });
    } catch (error) {
      console.error('Erro ao buscar stats RA:', error);
    }
  });

  ['bacen', 'procon', 'n2', 'judicial'].forEach((tipo) => {
    router.get(`/${tipo}`, async (req, res) => {
      try {
        let client;
        try {
          client = await connectToMongo();
        } catch (err) {
          return res.status(503).json({
            success: false,
            message: 'MongoDB não configurado: ' + err.message,
            data: null
          });
        }
        const db = client.db('hub_ouvidoria');
        const dataInicio = dataInicioOpcionalQueryLocal(req.query.dataInicio);
        const dataFim = dataFimOpcionalQueryLocal(req.query.dataFim);
        const produtosRaw = req.query.produto;
        const produtos = Array.isArray(produtosRaw)
          ? produtosRaw.filter((p) => p && String(p).trim()).map((p) => String(p).trim())
          : (produtosRaw && String(produtosRaw).trim() ? [String(produtosRaw).trim()] : []);
        const motivosRaw = req.query.motivo;
        const motivos = Array.isArray(motivosRaw)
          ? motivosRaw.filter((m) => m && String(m).trim()).map((m) => String(m).trim())
          : (motivosRaw && String(motivosRaw).trim() ? [String(motivosRaw).trim()] : []);

        const result = await buscarStatsAuxiliar(db, tipo, dataInicio, dataFim, produtos, motivos);
        if (!result) {
          return res.status(400).json({ success: false, message: 'Tipo inválido', data: null });
        }
        const label =
          tipo === 'bacen' ? 'Bacen' : tipo === 'procon' ? 'Procon' : tipo === 'n2' ? 'N2' : 'Judicial';
        res.json({
          success: true,
          data: {
            [label]: result.stats,
            reclamacoesPorDia: result.reclamacoesPorDia,
            motivosPorDia: result.motivosPorDia,
            totaisPorProdutoPorDia: result.totaisPorProdutoPorDia,
            motivosPorProdutoPorDia: result.motivosPorProdutoPorDia,
            jornadaDoReclamante: result.jornadaDoReclamante,
            dias: result.dias,
          }
        });
      } catch (error) {
        console.error(`Erro ao buscar stats ${tipo}:`, error);
        res.status(500).json({
          success: false,
          message: `Erro ao buscar estatísticas ${tipo}`,
          error: error.message,
          data: null
        });
      }
    });
  });

  router.get('/debug', async (req, res) => {
    try {
      let client;
      try {
        client = await connectToMongo();
      } catch (err) {
        return res.status(503).json({ success: false, message: err.message });
      }
      const db = client.db('hub_ouvidoria');

      const { dataInicio, dataFim } = normalizarIntervaloDatasQueryStats('2026-01-01', null);

      const filtroSóDataBacen = criarFiltroDataPorCollection('reclamacoes_bacen', dataInicio, dataFim);
      const filtroSóDataN2 = criarFiltroDataPorCollection('reclamacoes_n2Pix', dataInicio, dataFim);
      const filtroComProduto = criarFiltroProduto(['Credito Pessoal']);

      const [totalBacen, totalN2, totalRA, totalProcon, comDataBacen, comDataN2, comDataProdutoBacen, comDataProdutoN2, amostraProdutos] = await Promise.all([
        db.collection('reclamacoes_bacen').countDocuments({}),
        db.collection('reclamacoes_n2Pix').countDocuments({}),
        db.collection('reclamacoes_reclameAqui').countDocuments({}),
        db.collection('reclamacoes_procon').countDocuments({}),
        db.collection('reclamacoes_bacen').countDocuments(filtroSóDataBacen),
        db.collection('reclamacoes_n2Pix').countDocuments(filtroSóDataN2),
        db.collection('reclamacoes_bacen').countDocuments(mesclarFiltros(filtroSóDataBacen, filtroComProduto)),
        db.collection('reclamacoes_n2Pix').countDocuments(mesclarFiltros(filtroSóDataN2, filtroComProduto)),
        db.collection('reclamacoes_bacen').distinct('produto'),
      ]);

      res.json({
        success: true,
        debug: {
          totalPorCollection: { bacen: totalBacen, n2: totalN2, reclameAqui: totalRA, procon: totalProcon },
          comFiltroData2026: { bacen: comDataBacen, n2: comDataN2 },
          comFiltroDataMaisProduto: { bacen: comDataProdutoBacen, n2: comDataProdutoN2 },
          produtosDistintosBacen: amostraProdutos,
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = initStatsRoutes;
/** Diagnóstico / scripts: mesmo predicado de período N1 do GET /. */
module.exports.criarFiltroPeriodoN1PorCreatedAt = criarFiltroPeriodoN1PorCreatedAt;
