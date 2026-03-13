/**
 * Painel Reclamações Tempo Real - Stats Route
 * VERSION: v1.7.1
 *
 * GET /: query params dataInicio, dataFim, produto, motivo. Defaults: dataInicio 2026-01-01, dataFim hoje.
 *
 * Campos de data para filtro (LISTA_SCHEMAS.rb):
 * - Bacen: dataEntrada (não usar createdAt)
 * - N2: dataEntradaN2
 * - Reclame Aqui: dataReclam
 * - Procon: dataProcon
 *
 * motivoReduzido: sempre tratado como array. Padrão exato: "Liberação Chave Pix".
 */

const express = require('express');
const router = express.Router();

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

/**
 * Campos de data por coleção (LISTA_SCHEMAS.rb). NÃO usar createdAt para Bacen/N2/RA/Procon.
 */
const CAMPOS_DATA_POR_COLLECTION = {
  reclamacoes_bacen: 'dataEntrada',
  reclamacoes_n2Pix: 'dataEntradaN2',
  reclamacoes_reclameAqui: 'dataReclam',
  reclamacoes_procon: 'dataProcon',
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

function calcularStatsPorTipo(docs) {
  const ocorrencias = docs.length;
  const emAberto = docs.filter(r => !r.Finalizado || r.Finalizado.Resolvido !== true).length;
  const resolvido = docs.filter(r => r.Finalizado?.Resolvido === true).length;
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

  const solLiberacao = docs.filter((r) => motivoContemLiberacaoChavePix(r.motivoReduzido)).length;

  const docsLiberacaoChavePix = docs.filter((r) => motivoContemLiberacaoChavePix(r.motivoReduzido));
  const pixLiberado = docs.filter((r) => r.pixLiberado === true).length;
  const pixRetido = docsLiberacaoChavePix.filter(
    (r) => r.Finalizado?.Resolvido === true && r.pixLiberado === false
  ).length;
  const percRetencao =
    docsLiberacaoChavePix.length > 0
      ? Math.round((pixRetido / docsLiberacaoChavePix.length) * 1000) / 10
      : 0;

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

      const filtroBacen = mesclarFiltros(filtroDataBacen, filtroProduto, filtroMotivo);
      const filtroN2 = mesclarFiltros(filtroDataN2, filtroProduto, filtroMotivo);
      const filtroReclameAqui = mesclarFiltros(filtroDataRA, filtroProduto, filtroMotivo);
      const filtroProcon = mesclarFiltros(filtroDataProcon, filtroProduto, filtroMotivo);

      console.log('[STATS_FILTROS]', {
        camposData: { bacen: 'dataEntrada', n2: 'dataEntradaN2', ra: 'dataReclam', procon: 'dataProcon' },
        dataInicio: dataInicioRaw,
        dataFim: dataFimRaw || '(hoje)',
        filtroBacen: JSON.stringify(filtroBacen),
        filtroN2: JSON.stringify(filtroN2),
        filtroRA: JSON.stringify(filtroReclameAqui),
        filtroProcon: JSON.stringify(filtroProcon),
      });

      const [bacen, n2Pix, reclameAquiDocs, proconDocs] = await Promise.all([
        db.collection('reclamacoes_bacen').find(filtroBacen).toArray(),
        db.collection('reclamacoes_n2Pix').find(filtroN2).toArray(),
        db.collection('reclamacoes_reclameAqui').find(filtroReclameAqui).toArray(),
        db.collection('reclamacoes_procon').find(filtroProcon).toArray()
      ]);

      const todas = [...bacen, ...n2Pix, ...reclameAquiDocs, ...proconDocs];

      const porTipo = {
        N2: calcularStatsPorTipo(n2Pix),
        'Reclame Aqui': calcularStatsPorTipo(reclameAquiDocs),
        Bacen: calcularStatsPorTipo(bacen),
        Procon: calcularStatsPorTipo(proconDocs),
        Total: calcularStatsPorTipo(todas),
      };

      const pixLiberadoPorTipo = {
        bacen: bacen.filter((r) => r.pixLiberado === true).length,
        n2: n2Pix.filter((r) => r.pixLiberado === true).length,
        ra: reclameAquiDocs.filter((r) => r.pixLiberado === true).length,
        procon: proconDocs.filter((r) => r.pixLiberado === true).length,
        total: todas.filter((r) => r.pixLiberado === true).length,
      };
      console.log('[STATS_RESULT]', JSON.stringify({
        filtros: { dataInicio: dataInicioRaw, dataFim: dataFimRaw || '(hoje)', produtos, motivos },
        docsRetornados: { bacen: bacen.length, n2: n2Pix.length, ra: reclameAquiDocs.length, procon: proconDocs.length, total: todas.length },
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
    const motivosPorDiaMap = {};
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
        const motivosArr = Array.isArray(d.motivoReduzido)
          ? d.motivoReduzido.filter((m) => m && String(m).trim())
          : d.motivoReduzido ? [String(d.motivoReduzido).trim()] : [];
        motivosArr.forEach((m) => {
          const motivo = String(m).trim();
          if (!motivo) return;
          if (tipo === 'bacen' && isOrigemBacen(motivo)) return; // origem ≠ motivo
          if (!motivosPorDiaMap[motivo]) motivosPorDiaMap[motivo] = {};
          motivosPorDiaMap[motivo][dia] = (motivosPorDiaMap[motivo][dia] || 0) + 1;
        });
      });
    });

    const motivosPorDia = {};
    Object.keys(motivosPorDiaMap).sort().forEach((motivo) => {
      motivosPorDia[motivo] = motivosPorDiaMap[motivo];
    });

    return {
      stats: calcularStatsPorTipo(docs),
      reclamacoesPorDia,
      motivosPorDia,
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
      const motivosPorDiaMap = {};
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
          const motivos = Array.isArray(d.motivoReduzido)
            ? d.motivoReduzido.filter((m) => m && String(m).trim())
            : d.motivoReduzido
              ? [String(d.motivoReduzido).trim()]
              : [];
          motivos.forEach((m) => {
            const motivo = String(m).trim();
            if (!motivo) return;
            if (!motivosPorDiaMap[motivo]) motivosPorDiaMap[motivo] = {};
            motivosPorDiaMap[motivo][dia] = (motivosPorDiaMap[motivo][dia] || 0) + 1;
          });
        });
      });

      const motivosPorDia = {};
      Object.keys(motivosPorDiaMap).sort().forEach((motivo) => {
        motivosPorDia[motivo] = motivosPorDiaMap[motivo];
      });

      res.json({
        success: true,
        data: {
          'Reclame Aqui': stats,
          reclamacoesPorDia,
          motivosPorDia,
          jornadaDoReclamante: jornadaPorDia,
          dias: diasOrdenados,
        }
      });
    } catch (error) {
      console.error('Erro ao buscar stats RA:', error);
    }
  });

  ['bacen', 'procon', 'n2'].forEach((tipo) => {
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
        const label = tipo === 'bacen' ? 'Bacen' : tipo === 'procon' ? 'Procon' : 'N2';
        res.json({
          success: true,
          data: {
            [label]: result.stats,
            reclamacoesPorDia: result.reclamacoesPorDia,
            motivosPorDia: result.motivosPorDia,
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
