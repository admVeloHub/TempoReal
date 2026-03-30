/**
 * Painel Reclamações Tempo Real - Stats Route
 * VERSION: v1.8.6
 *
 * GET /: query params dataInicio, dataFim, produto, motivo. Defaults: dataInicio 2026-01-01, dataFim hoje.
 *
 * Campos de data para filtro (LISTA_SCHEMAS.rb):
 * - Bacen: dataEntrada (não usar createdAt)
 * - N2: dataEntradaN2
 * - Reclame Aqui: dataReclam
 * - Procon: dataProcon
 * - N1 Octadesk: dataEntradaN1 (reclamações_n1Stats)
 *
 * motivoReduzido: sempre tratado como array. Padrão exato: "Liberação Chave Pix".
 * % Retenção (literal): TOTAL = soma(retidos) + soma(escalado N2); percRetencao = retidos / TOTAL × 100 (Liberação Chave Pix).
 * solLiberacao / docsLiberacaoChavePix: exclusivamente Liberação Chave Pix; com detalhe_2026 preenchido usa só esse campo (N1 Octadesk).
 */

const express = require('express');
const router = express.Router();
const { N1_STATS_COLLECTION } = require('../services/octadeskIngestService');

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

/** Normalização alinhada a octadeskIngestService (campo detalhe_2026). */
function normalizarDetalheStats(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

const DETALHE_LIBERACAO_CHAVE_PIX_NORM = 'liberacao chave pix';

/**
 * Universo "Ocorrências" / Liberação Chave Pix: apenas casos de liberação.
 * Se detalhe_2026 existir e não for vazio, só conta com detalhe normalizado = liberação chave pix (N1).
 * Caso contrário, match exato em motivoReduzido (demais coleções / legado sem detalhe).
 */
function documentoELiberacaoChavePixExclusivo(r) {
  if (r == null) return false;
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
  reclamacoes_n1Stats: 'dataEntradaN1',
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
 * motivoReduzido: String (Bacen) ou [String] (RA, Procon, N2).
 * Usa $regex para funcionar em ambos os tipos.
 */
function criarFiltroMotivo(motivos) {
  if (!motivos || !Array.isArray(motivos) || motivos.length === 0) return {};
  const valores = motivos.filter(m => m && String(m).trim()).map(m => String(m).trim());
  if (valores.length === 0) return {};
  const condicoes = valores.map(m => {
    const escaped = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { motivoReduzido: { $regex: escaped, $options: 'i' } };
  });
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
 * Taxa de resolução e “resolvido”: somente com Finalizado.Resolvido === true (estrito).
 * Qualquer outro caso (ausente, false, null) = não resolvido para as métricas.
 */
function documentoResolvidoParaMetricas(r) {
  return r != null && r.Finalizado != null && r.Finalizado.Resolvido === true;
}

function calcularStatsPorTipo(docs) {
  const ocorrencias = docs.length;
  const emAberto = docs.filter((r) => !documentoResolvidoParaMetricas(r)).length;
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

  /* % Retenção — conta literal (só Liberação Chave Pix):
   * TOTAL = soma(retidos) + soma(escalado N2)
   * percRetencao = (retidos / TOTAL) × 100  → quanto % do TOTAL é retido */
  const somaEscaladoN2 = docsLiberacaoChavePix.filter((r) => r.pixLiberado === true).length;
  const somaRetidos = docsLiberacaoChavePix.filter(
    (r) => documentoResolvidoParaMetricas(r) && r.pixLiberado === false
  ).length;

  const totalRetidosMaisEscaladoN2 = somaRetidos + somaEscaladoN2;
  const percRetencao =
    totalRetidosMaisEscaladoN2 > 0
      ? Math.round((somaRetidos / totalRetidosMaisEscaladoN2) * 1000) / 10
      : 0;

  const pixLiberado = somaEscaladoN2;
  const pixRetido = somaRetidos;

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

/**
 * GET /api/stats
 * Query params: dataInicio, dataFim, produto (array), motivo (array)
 * Defaults: dataInicio 2026-01-01, dataFim hoje. Se produto/motivo vazios, não aplica filtro.
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

      const dataInicioRaw = req.query.dataInicio || '2026-01-01';
      const dataFimRaw = req.query.dataFim;
      const dataInicio = new Date(dataInicioRaw);
      dataInicio.setUTCHours(0, 0, 0, 0);
      const dataFim = dataFimRaw ? new Date(dataFimRaw) : new Date();
      dataFim.setUTCHours(23, 59, 59, 999);

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
      const filtroDataN1 = criarFiltroDataPorCollection('reclamacoes_n1Stats', dataInicio, dataFim);

      const filtroBacen = mesclarFiltros(filtroDataBacen, filtroProduto, filtroMotivo);
      const filtroN2 = mesclarFiltros(filtroDataN2, filtroProduto, filtroMotivo);
      const filtroReclameAqui = mesclarFiltros(filtroDataRA, filtroProduto, filtroMotivo);
      const filtroProcon = mesclarFiltros(filtroDataProcon, filtroProduto, filtroMotivo);
      const filtroN1 = mesclarFiltros(filtroDataN1, filtroProduto, filtroMotivo);

      console.log('[STATS_FILTROS]', {
        camposData: { bacen: 'dataEntrada', n2: 'dataEntradaN2', ra: 'dataReclam', procon: 'dataProcon', n1: 'dataEntradaN1' },
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

      const todas = [...bacen, ...n2Pix, ...reclameAquiDocs, ...proconDocs, ...n1Docs];

      const porTipo = {
        N1: calcularStatsPorTipo(n1Docs),
        N2: calcularStatsPorTipo(n2Pix),
        'Reclame Aqui': calcularStatsPorTipo(reclameAquiDocs),
        Bacen: calcularStatsPorTipo(bacen),
        Procon: calcularStatsPorTipo(proconDocs),
        Total: calcularStatsPorTipo(todas),
      };

      const pixLiberadoPorTipo = {
        bacen: bacen.filter((r) => documentoELiberacaoChavePixExclusivo(r) && r.pixLiberado === true).length,
        n2: n2Pix.filter((r) => documentoELiberacaoChavePixExclusivo(r) && r.pixLiberado === true).length,
        ra: reclameAquiDocs.filter((r) => documentoELiberacaoChavePixExclusivo(r) && r.pixLiberado === true).length,
        procon: proconDocs.filter((r) => documentoELiberacaoChavePixExclusivo(r) && r.pixLiberado === true).length,
        n1: n1Docs.filter((r) => documentoELiberacaoChavePixExclusivo(r) && r.pixLiberado === true).length,
        total: todas.filter((r) => documentoELiberacaoChavePixExclusivo(r) && r.pixLiberado === true).length,
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

      const dataInicio = req.query.dataInicio ? new Date(req.query.dataInicio) : null;
      const dataFim = req.query.dataFim ? new Date(req.query.dataFim) : null;
      if (dataInicio) dataInicio.setUTCHours(0, 0, 0, 0);
      if (dataFim) dataFim.setUTCHours(23, 59, 59, 999);

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
        const dataInicio = req.query.dataInicio ? new Date(req.query.dataInicio) : null;
        const dataFim = req.query.dataFim ? new Date(req.query.dataFim) : null;
        if (dataInicio) dataInicio.setUTCHours(0, 0, 0, 0);
        if (dataFim) dataFim.setUTCHours(23, 59, 59, 999);
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

      const dataInicio = new Date('2026-01-01');
      dataInicio.setUTCHours(0, 0, 0, 0);
      const dataFim = new Date();
      dataFim.setUTCHours(23, 59, 59, 999);

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
