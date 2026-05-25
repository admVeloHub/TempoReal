/**
 * Painel Reclamações Tempo Real - Stats Route
 * VERSION: v1.22.0
 * v1.22.0: liberacaoAnterior === true — conta em ocorrencias (docs.length); exclui de pixLiberado, pixRetido e solLiberacao; classe excludente liberacaoAnterior (LISTA_SCHEMAS.rb).
 * v1.21.9: tabela-liberacao — matriz dia×tipo (UI transposta); casosSemFechamento (pixLiberado=true && !resolvido); Excel 2 abas; fmtDiaComSemanaUtc.
 * v1.21.8: tabela-liberacao — colunas dia = cada dia UTC entre dataInicio e dataFim (inclusive); conta só registros cuja data do canal cai no intervalo ISO; Total = soma só desse período (alinhado às colunas).
 * v1.21.7: GET /api/stats/tabela-liberacao/export (Excel visão tabela), GET /api/stats/relatorio-ouvidoria-base (5 abas + timePortabilidade); tabela JSON com totais por card.
 * v1.21.6: GET /api/stats/tabela-liberacao — segundo eixo por dia = liberados (pixLiberado / Escalado N2), não retidos.
 * v1.21.5: GET /api/stats/tabela-liberacao — por canal/dia: ocorrências (Liberação Chave Pix) e retirados (regras do painel); mesmos filtros que GET /.
 * v1.21.4: filtro de período por dia ISO literal em UTC (horário ignorado) para GET /api/stats e rotas auxiliares (/ra, /bacen, /procon, /n2, /judicial).
 * v1.21.3: card porTipo.N1 alimentado por hub_ouvidoria.reclamacoes_timePortabilidade (dataEntrada + produto/motivo; calcularStatsPorTipo + enrich); Total inclui Time Portabilidade; Octadesk n1Stats só em scripts/ingest.
 * v1.20.1: exports de helpers de filtro para scripts (relatório N2 = mesmo predicado Mongo do GET /).
 * v1.20.2: produto literal "Antecipação" alinhado a Outros Anos; MOTIVO_PARAM idem.
 * v1.20.3: exports calcularStatsPorTipo, calcularStatsCardN1, enrichComMostradoresOuvidoria (auditoria cards = GET /).
 * v1.20.4: auditoriaPainelPredicatesPorDoc (scripts backup N2Pix / reconciliação com calcularStatsPorTipo).
 * v1.20.5: ouvidoria → pixRetido/somaRetidos exclui caso com semRespostaCliente === true (excludente com mostrador Sem resposta).
 * v1.21.0: ouvidoria não‑N1 — desdobramento excludente (classificacaoDesdobramentoOuvidoriaNaoN1): Em aberto → Sem resposta → Op. cancelada → Liberado/Retido (só Liberação Chave Pix); Liberado só se resolvido.
 * v1.21.1: export documentoELiberacaoChavePixExclusivo para scripts de relatório (sem alteração de rotas).
 * v1.21.2: export documentoResolvidoParaMetricas para scripts (Em aberto / Resolvido; sem alteração de rotas).
 *
 * porTipo: emAberto em todos os canais (calcularStatsPorTipo). Chave JSON N1 = Time Portabilidade (reclamacoes_timePortabilidade), mesmos mostradores excludentes que RA/Bacen/Procon/N2.
 *
 * GET /: dataInicio, dataFim (YYYY-MM-DD). Intervalo = início/fim do dia ISO literal em UTC (00:00:00.000Z → 23:59:59.999Z), ignorando horário local. Default início 2026-01-01; fim omitido = fim do dia UTC hoje.
 *
 * Campos de data para filtro (LISTA_SCHEMAS.rb):
 * - Bacen: dataEntrada (não usar createdAt)
 * - N2: dataEntradaN2
 * - Reclame Aqui: dataReclam
 * - Procon: dataProcon
 * - Time Portabilidade (porTipo.N1): dataEntrada + filtro produto/motivo (igual demais ouvidorias).
 *
 * motivoReduzido: sempre tratado como array. Padrão exato: "Liberação Chave Pix".
 * percRetencao: pixRetido / solLiberacao × 100 (ocorrências = universo Liberação Chave Pix); 0 se solLiberacao = 0. Ouvidoria (não-N1): pixLiberado/pixRetido e mostradores enrich seguem classificação excludente (v1.21.0).
 * solLiberacao / docsLiberacaoChavePix: Liberação Chave Pix. Docs com octadeskNumber (n1Stats): motivoN1ContaComoLiberacaoParaMetricas(motivoReduzido); outras: motivos_chave_pix se preenchido; senão detalhe_2026; senão motivoReduzido.
 * Docs Octadesk em n1Stats (fora do GET /): resolução por currentStatusName “Resolvido”. Time Portabilidade e demais ouvidorias: Finalizado.Resolvido.
 * Filtro produto ouvidoria (Bacen, N2, RA, Procon, Time Portabilidade): campo produto.
 * Parâmetro motivo (UI): ouvidoria usa criarFiltroMotivoItemOuvidoria (inclui porTipo.N1 / Time Portabilidade).
 * emAberto ouvidoria: !Finalizado.Resolvido.
 * liberacaoAnterior (LISTA_SCHEMAS.rb): ocorrencias sim; pixLiberado/pixRetido/solLiberacao não; resolvido ou em aberto irrelevante para liberados/retidos.
 */

const express = require('express');
const { DateTime } = require('luxon');
const ExcelJS = require('exceljs');
const router = express.Router();

/** Mantido para compatibilidade de logs/config; filtro de stats usa dia ISO literal em UTC (v1.21.4). */
const STATS_DATE_ZONE = process.env.STATS_TZ || 'America/Sao_Paulo';
const {
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
  'Antecipação - 2026': ['Antecipação - 2026', 'Antecipação 2026'],
  'Antecipação - Outros Anos': ['Antecipação - Outros Anos', 'Antecipacao', 'Antecipação'],
};

/** Rótulo do filtro “Motivo” = liberação chave Pix: no Octadesk também vem “Chave Pix” sem “Liberação”. */
const MOTIVO_UI_LIBERACAO_CHAVE_PIX = 'Liberação chave pix';

/**
 * YYYY-MM-DD → início/fim do dia ISO literal em UTC.
 * Regra de negócio: horário é irrelevante para stats; filtra pelo dia "de calendário" do campo Date.
 */
function parseDataDiaLocalInicio(yyyyMmDd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(yyyyMmDd ?? '').trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const dt = DateTime.fromISO(iso, { zone: 'utc' });
  if (!dt.isValid) return null;
  return dt.startOf('day').toJSDate();
}

function parseDataDiaLocalFim(yyyyMmDd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(yyyyMmDd ?? '').trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const dt = DateTime.fromISO(iso, { zone: 'utc' });
  if (!dt.isValid) return null;
  return dt.endOf('day').toJSDate();
}

function hojeFimDiaLocal() {
  return DateTime.now().setZone('utc').endOf('day').toJSDate();
}

/** Rotas GET /api/stats: default início 2026-01-01; fim omitido = fim do dia UTC (dia ISO literal). */
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
    const di = DateTime.fromJSDate(dataInicio, { zone: 'utc' });
    const df = DateTime.fromJSDate(dataFim, { zone: 'utc' });
    dataInicio = df.startOf('day').toJSDate();
    dataFim = di.endOf('day').toJSDate();
  }

  return { dataInicio, dataFim };
}

/**
 * Lista YYYY-MM-DD de cada dia de calendário em UTC entre os limites inclusivos do filtro GET /api/stats.
 * Igual semanticamente a parseDataDiaLocalInicio/Fim — colunas da pivot = período inteiro; Total = soma desses dias.
 */
function enumerarDiasIsoUtcIntervaloInclusive(dataInicioDt, dataFimDt) {
  const start = DateTime.fromJSDate(dataInicioDt, { zone: 'utc' }).startOf('day');
  const end = DateTime.fromJSDate(dataFimDt, { zone: 'utc' }).startOf('day');
  if (!start.isValid || !end.isValid || start > end) return [];
  const out = [];
  for (let d = start; d <= end; d = d.plus({ days: 1 })) {
    out.push(d.toISODate());
  }
  return out;
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

/** Rótulos Octadesk que alimentam pixLiberado (Escalado N2) no card N1 após normalizeTextOctadesk. */
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
  reclamacoes_timePortabilidade: 'dataEntrada',
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
 * motivoReduzido: String (Bacen) ou [String] (RA, Procon, N2, Time Portabilidade).
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

/** LISTA_SCHEMAS.rb — Liberação anterior (Canais/Protocolos); fora de Liberados/Retidos/solLiberacao; permanece em ocorrencias. */
function documentoLiberacaoAnterior(r) {
  return r != null && r.liberacaoAnterior === true;
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
 * Desdobramento excludente nos cards ouvidoria (não‑N1): cada documento em no máximo uma classe exibida —
 * emAberto | semResposta | opCancelada | liberacaoAnterior | liberado | retido | outros.
 * Prioridade: não resolvido → semRespostaCliente → motivo cancelamento 7 dias → liberacaoAnterior → (universo Lib. Chave Pix) liberado vs retido.
 * "Liberado" no painel só após resolvido; pixLiberado legado sem Resolvido cai em Em aberto, não em Liberados.
 */
function classificacaoDesdobramentoOuvidoriaNaoN1(r) {
  if (r == null || isDocN1Stats(r)) return null;
  if (!documentoResolvidoParaMetricas(r)) return 'emAberto';
  if (r.semRespostaCliente === true) return 'semResposta';
  if (motivoContemCancelamento7Dias(r.motivoReduzido)) return 'opCancelada';
  if (documentoLiberacaoAnterior(r)) return 'liberacaoAnterior';
  if (!documentoELiberacaoChavePixExclusivo(r)) return 'outros';
  if (documentoLiberadoChavePixParaMetricas(r)) return 'liberado';
  return 'retido';
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

  const docsLiberacaoChavePix = docs.filter(
    (r) => documentoELiberacaoChavePixExclusivo(r) && !documentoLiberacaoAnterior(r)
  );
  const solLiberacao = docsLiberacaoChavePix.length;

  /** N1: Escalado N2 e Retidos sobre todas as ocorrências; ouvidoria: Liberados/Retidos = classes excludentes (v1.21.0). */
  const somaEscaladoN2 =
    docs.filter((r) => isDocN1Stats(r) && documentoEscaladoN2ContagemN1(r)).length +
    docs.filter((r) => classificacaoDesdobramentoOuvidoriaNaoN1(r) === 'liberado').length;
  const somaRetidos =
    docs.filter((r) => isDocN1Stats(r) && documentoRetidoContagemN1(r)).length +
    docs.filter((r) => classificacaoDesdobramentoOuvidoriaNaoN1(r) === 'retido').length;

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
  const semResposta = docs.filter((r) => classificacaoDesdobramentoOuvidoriaNaoN1(r) === 'semResposta').length;
  const opCancelada = docs.filter((r) => classificacaoDesdobramentoOuvidoriaNaoN1(r) === 'opCancelada').length;
  return { ...baseStats, semResposta, opCancelada };
}

/**
 * Predicados do card porTipo (calcularStatsPorTipo + enrich) por documento — só para scripts de auditoria/backup.
 * Não altera GET /api/stats nem estruturas de resposta.
 */
function auditoriaPainelPredicatesPorDoc(r) {
  if (r == null) return null;
  const n1 = isDocN1Stats(r);
  const libExclusivo = documentoELiberacaoChavePixExclusivo(r);
  const resolvido = documentoResolvidoParaMetricas(r);
  const liberadoPix = documentoLiberadoChavePixParaMetricas(r);
  const retidoN1 = documentoRetidoContagemN1(r);
  const escaladoN2N1 = documentoEscaladoN2ContagemN1(r);
  const emAbertoCard = n1 ? documentoEmAbertoN1PorStatus(r) : !resolvido;
  const caEProtocolos = (
    r.acionouCentral === true ||
    (r.protocolosCentral && Array.isArray(r.protocolosCentral) && r.protocolosCentral.length > 0) ||
    r.n2SegundoNivel === true ||
    (r.protocolosN2 && Array.isArray(r.protocolosN2) && r.protocolosN2.length > 0) ||
    r.reclameAqui === true ||
    (r.protocolosReclameAqui && Array.isArray(r.protocolosReclameAqui) && r.protocolosReclameAqui.length > 0) ||
    r.procon === true ||
    (r.protocolosProcon && Array.isArray(r.protocolosProcon) && r.protocolosProcon.length > 0)
  );
  const libAnterior = documentoLiberacaoAnterior(r);
  const cls = n1 ? null : classificacaoDesdobramentoOuvidoriaNaoN1(r);
  return {
    isDocN1Stats: n1,
    liberacaoChavePixExclusivo: libExclusivo,
    liberacaoAnterior: libAnterior,
    resolvidoParaMetricas: resolvido,
    liberadoChavePixParaMetricas: liberadoPix,
    emAbertoCard,
    contribuiCaEProtocolos: caEProtocolos,
    contribuiSolLiberacao: libExclusivo && !libAnterior,
    contribuiPixLiberadoCard: n1 ? escaladoN2N1 : cls === 'liberado',
    contribuiPixRetidoCard: n1 ? retidoN1 : cls === 'retido',
    semRespostaClienteAposResolvido: n1 ? resolvido && r.semRespostaCliente === true : cls === 'semResposta',
    opCanceladaMotivo7Dias: n1 ? motivoContemCancelamento7Dias(r.motivoReduzido) : cls === 'opCancelada',
  };
}

/**
 * GET /api/stats
 * Query params: dataInicio, dataFim, produto (array), motivo (array)
 * Defaults: dataInicio 2026-01-01, dataFim fim do dia UTC. produto/motivo vazios: sem filtro nesse eixo nas ouvidorias. porTipo.N1 (Time Portabilidade): dataEntrada + produto + motivo.
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
      const filtroDataTimePort = criarFiltroDataPorCollection('reclamacoes_timePortabilidade', dataInicio, dataFim);

      const filtroBacen = mesclarFiltros(filtroDataBacen, filtroProduto, filtroMotivo);
      const filtroN2 = mesclarFiltros(filtroDataN2, filtroProduto, filtroMotivo);
      const filtroReclameAqui = mesclarFiltros(filtroDataRA, filtroProduto, filtroMotivo);
      const filtroProcon = mesclarFiltros(filtroDataProcon, filtroProduto, filtroMotivo);
      const filtroTimePortabilidade = mesclarFiltros(filtroDataTimePort, filtroProduto, filtroMotivo);

      console.log('[STATS_FILTROS]', {
        camposData: {
          bacen: 'dataEntrada',
          n2: 'dataEntradaN2',
          ra: 'dataReclam',
          procon: 'dataProcon',
          timePortabilidade: 'dataEntrada',
        },
        campoMotivoFiltro: 'motivoReduzido',
        porTipoN1Card: 'Time Portabilidade → reclamacoes_timePortabilidade',
        statsRoute: 'v1.21.4',
        statsTz: STATS_DATE_ZONE,
        dataInicio: dataInicioRaw,
        dataFim: dataFimRaw || '(hoje)',
        filtroBacen: JSON.stringify(filtroBacen),
        filtroN2: JSON.stringify(filtroN2),
        filtroRA: JSON.stringify(filtroReclameAqui),
        filtroProcon: JSON.stringify(filtroProcon),
        filtroTimePortabilidade: JSON.stringify(filtroTimePortabilidade),
      });

      const [bacen, n2Pix, reclameAquiDocs, proconDocs, timePortabilidadeDocs] = await Promise.all([
        db.collection('reclamacoes_bacen').find(filtroBacen).toArray(),
        db.collection('reclamacoes_n2Pix').find(filtroN2).toArray(),
        db.collection('reclamacoes_reclameAqui').find(filtroReclameAqui).toArray(),
        db.collection('reclamacoes_procon').find(filtroProcon).toArray(),
        db.collection('reclamacoes_timePortabilidade').find(filtroTimePortabilidade).toArray(),
      ]);

      console.log('[GET /api/stats] stats v1.21.3 | timePortabilidadeDocs:', timePortabilidadeDocs.length, '| filtro keys:', Object.keys(filtroTimePortabilidade));

      const todas = [...bacen, ...n2Pix, ...reclameAquiDocs, ...proconDocs, ...timePortabilidadeDocs];

      const porTipo = {
        N1: enrichComMostradoresOuvidoria(calcularStatsPorTipo(timePortabilidadeDocs), timePortabilidadeDocs),
        N2: enrichComMostradoresOuvidoria(calcularStatsPorTipo(n2Pix), n2Pix),
        'Reclame Aqui': enrichComMostradoresOuvidoria(calcularStatsPorTipo(reclameAquiDocs), reclameAquiDocs),
        Bacen: enrichComMostradoresOuvidoria(calcularStatsPorTipo(bacen), bacen),
        Procon: enrichComMostradoresOuvidoria(calcularStatsPorTipo(proconDocs), proconDocs),
        Total: calcularStatsPorTipo(todas),
      };

      const pixLiberadoPorTipo = {
        bacen: bacen.filter((r) => classificacaoDesdobramentoOuvidoriaNaoN1(r) === 'liberado').length,
        n2: n2Pix.filter((r) => classificacaoDesdobramentoOuvidoriaNaoN1(r) === 'liberado').length,
        ra: reclameAquiDocs.filter((r) => classificacaoDesdobramentoOuvidoriaNaoN1(r) === 'liberado').length,
        procon: proconDocs.filter((r) => classificacaoDesdobramentoOuvidoriaNaoN1(r) === 'liberado').length,
        timePortabilidade: timePortabilidadeDocs.filter((r) => classificacaoDesdobramentoOuvidoriaNaoN1(r) === 'liberado').length,
        total: todas.filter((r) => (
          isDocN1Stats(r)
            ? documentoEscaladoN2ContagemN1(r)
            : classificacaoDesdobramentoOuvidoriaNaoN1(r) === 'liberado'
        )).length,
      };
      console.log('[STATS_RESULT]', JSON.stringify({
        filtros: { dataInicio: dataInicioRaw, dataFim: dataFimRaw || '(hoje)', produtos, motivos },
        docsRetornados: {
          bacen: bacen.length,
          n2: n2Pix.length,
          ra: reclameAquiDocs.length,
          procon: proconDocs.length,
          timePortabilidade: timePortabilidadeDocs.length,
          total: todas.length,
        },
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

  /** Liberados no painel: N1 = Escalado N2 (escalar_chamado); ouvidoria = classificação excludente "liberado". */
  function documentoContribuiLiberadosPainel(r) {
    if (r == null) return false;
    if (isDocN1Stats(r)) return documentoEscaladoN2ContagemN1(r);
    return classificacaoDesdobramentoOuvidoriaNaoN1(r) === 'liberado';
  }

  /** Casos sem Fechamento (Conciliação): pixLiberado literal true e ainda não resolvido. */
  function documentoCasosSemFechamentoConciliacao(r) {
    return r != null && r.pixLiberado === true && !documentoResolvidoParaMetricas(r);
  }

  const DIAS_SEMANA_PT = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

  function fmtDiaExcelHeader(yyyyMmDd) {
    const [y, m, d] = String(yyyyMmDd).split('-');
    return d && m ? `${d}/${m}` : yyyyMmDd;
  }

  function fmtDiaComSemanaUtc(yyyyMmDd) {
    const dt = DateTime.fromISO(String(yyyyMmDd), { zone: 'utc' });
    if (!dt.isValid) return fmtDiaExcelHeader(yyyyMmDd);
    return `${dt.toFormat('dd/MM')} ${DIAS_SEMANA_PT[dt.weekday % 7]}`;
  }

  function emptyTabelaLiberacaoPayload() {
    return {
      dias: [],
      cards: [],
      matriz: {},
      totaisPorDia: {},
      totaisPorCard: {},
      casosSemFechamento: { matriz: {}, totaisPorDia: {}, totaisPorCard: {} },
    };
  }

  function parseProdutoMotivoQuery(req) {
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
    return { produtos, motivos };
  }

  /**
   * Agregação tabela conciliação (JSON + export Excel).
   */
  async function buildTabelaLiberacaoData(db, req) {
    const { dataInicio, dataFim } = normalizarIntervaloDatasQueryStats(req.query.dataInicio, req.query.dataFim);
    const { produtos, motivos } = parseProdutoMotivoQuery(req);

    const filtroProduto = criarFiltroProduto(produtos);
    const filtroMotivo = criarFiltroMotivo(motivos);

    const filtroDataBacen = criarFiltroDataPorCollection('reclamacoes_bacen', dataInicio, dataFim);
    const filtroDataN2 = criarFiltroDataPorCollection('reclamacoes_n2Pix', dataInicio, dataFim);
    const filtroDataRA = criarFiltroDataPorCollection('reclamacoes_reclameAqui', dataInicio, dataFim);
    const filtroDataProcon = criarFiltroDataPorCollection('reclamacoes_procon', dataInicio, dataFim);
    const filtroDataTimePort = criarFiltroDataPorCollection('reclamacoes_timePortabilidade', dataInicio, dataFim);

    const filtroBacen = mesclarFiltros(filtroDataBacen, filtroProduto, filtroMotivo);
    const filtroN2 = mesclarFiltros(filtroDataN2, filtroProduto, filtroMotivo);
    const filtroReclameAqui = mesclarFiltros(filtroDataRA, filtroProduto, filtroMotivo);
    const filtroProcon = mesclarFiltros(filtroDataProcon, filtroProduto, filtroMotivo);
    const filtroTimePortabilidade = mesclarFiltros(filtroDataTimePort, filtroProduto, filtroMotivo);

    const [bacen, n2Pix, reclameAquiDocs, proconDocs, timePortabilidadeDocs] = await Promise.all([
      db.collection('reclamacoes_bacen').find(filtroBacen).toArray(),
      db.collection('reclamacoes_n2Pix').find(filtroN2).toArray(),
      db.collection('reclamacoes_reclameAqui').find(filtroReclameAqui).toArray(),
      db.collection('reclamacoes_procon').find(filtroProcon).toArray(),
      db.collection('reclamacoes_timePortabilidade').find(filtroTimePortabilidade).toArray(),
    ]);

    const diaStr = (dtVal) => {
      if (!dtVal) return null;
      const dt = new Date(dtVal);
      return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
    };

    const diaMinIso = DateTime.fromJSDate(dataInicio, { zone: 'utc' }).toISODate();
    const diaMaxIso = DateTime.fromJSDate(dataFim, { zone: 'utc' }).toISODate();

    /** Colunas por dia de calendário no período do filtro (UTC); não só dias com registros — Total = soma dessas colunas. */
    const dias = enumerarDiasIsoUtcIntervaloInclusive(dataInicio, dataFim);

    const docsNoPeriodoPorCampo = (docList, dateFieldName) =>
      docList.filter((doc) => {
        const dia = diaStr(doc[dateFieldName]);
        if (!dia) return false;
        return dia >= diaMinIso && dia <= diaMaxIso;
      });

    const CARD_GROUPS = [
      {
        key: 'N1',
        label: 'Time Portabilidade',
        docs: docsNoPeriodoPorCampo(timePortabilidadeDocs, 'dataEntrada'),
        dateField: 'dataEntrada',
      },
      {
        key: 'Reclame Aqui',
        label: 'RA',
        docs: docsNoPeriodoPorCampo(reclameAquiDocs, 'dataReclam'),
        dateField: 'dataReclam',
      },
      { key: 'Bacen', label: 'Bacen', docs: docsNoPeriodoPorCampo(bacen, 'dataEntrada'), dateField: 'dataEntrada' },
      { key: 'Procon', label: 'Procon', docs: docsNoPeriodoPorCampo(proconDocs, 'dataProcon'), dateField: 'dataProcon' },
      { key: 'N2', label: 'N2', docs: docsNoPeriodoPorCampo(n2Pix, 'dataEntradaN2'), dateField: 'dataEntradaN2' },
    ];

    const cards = CARD_GROUPS.map(({ key, label }) => ({ key, label }));
    const matriz = {};
    const totaisPorDia = {};
    const totaisPorCard = {};
    const sfMatriz = {};
    const sfTotaisPorDia = {};
    const sfTotaisPorCard = {};

    dias.forEach((d) => {
      matriz[d] = {};
      sfMatriz[d] = {};
      totaisPorDia[d] = { ocorrencias: 0, liberados: 0 };
      sfTotaisPorDia[d] = 0;
      cards.forEach(({ key }) => {
        matriz[d][key] = { ocorrencias: 0, liberados: 0 };
        sfMatriz[d][key] = 0;
      });
    });
    cards.forEach(({ key }) => {
      totaisPorCard[key] = { ocorrencias: 0, liberados: 0 };
      sfTotaisPorCard[key] = 0;
    });

    CARD_GROUPS.forEach(({ key, docs, dateField }) => {
      docs.forEach((doc) => {
        const dia = diaStr(doc[dateField]);
        if (!dia || dia < diaMinIso || dia > diaMaxIso) return;
        if (documentoELiberacaoChavePixExclusivo(doc)) {
          matriz[dia][key].ocorrencias += 1;
          totaisPorDia[dia].ocorrencias += 1;
          totaisPorCard[key].ocorrencias += 1;
        }
        if (documentoContribuiLiberadosPainel(doc)) {
          matriz[dia][key].liberados += 1;
          totaisPorDia[dia].liberados += 1;
          totaisPorCard[key].liberados += 1;
        }
        if (documentoCasosSemFechamentoConciliacao(doc)) {
          sfMatriz[dia][key] += 1;
          sfTotaisPorDia[dia] += 1;
          sfTotaisPorCard[key] += 1;
        }
      });
    });

    return {
      dias,
      cards,
      matriz,
      totaisPorDia,
      totaisPorCard,
      casosSemFechamento: {
        matriz: sfMatriz,
        totaisPorDia: sfTotaisPorDia,
        totaisPorCard: sfTotaisPorCard,
      },
    };
  }

  function escreverAbaConciliacaoExcel(ws, payload) {
    const { dias, cards, matriz, totaisPorDia, totaisPorCard } = payload;
    const header1 = ['Data', 'Total', 'Total'];
    const header2 = ['', 'Ocorrências', 'Liberados'];
    cards.forEach((c) => {
      header1.push(c.label, c.label);
      header2.push('Ocorrências', 'Liberados');
    });
    ws.addRow(header1);
    ws.addRow(header2);
    ws.getRow(1).font = { bold: true };
    ws.getRow(2).font = { bold: true };
    ws.mergeCells(1, 1, 2, 1);
    ws.mergeCells(1, 2, 1, 3);
    let col = 4;
    cards.forEach(() => {
      ws.mergeCells(1, col, 1, col + 1);
      col += 2;
    });

    dias.forEach((dia) => {
      const td = totaisPorDia[dia] || { ocorrencias: 0, liberados: 0 };
      const rowO = [fmtDiaComSemanaUtc(dia), td.ocorrencias, ''];
      const rowL = ['', '', td.liberados];
      cards.forEach(({ key }) => {
        const cell = matriz[dia]?.[key] || { ocorrencias: 0, liberados: 0 };
        rowO.push(cell.ocorrencias, '');
        rowL.push('', cell.liberados);
      });
      ws.addRow(rowO);
      ws.addRow(rowL);
    });

    const grandO = cards.reduce((s, { key }) => s + (totaisPorCard[key]?.ocorrencias ?? 0), 0);
    const grandL = cards.reduce((s, { key }) => s + (totaisPorCard[key]?.liberados ?? 0), 0);
    const rowTotO = ['Total', grandO, ''];
    const rowTotL = ['', '', grandL];
    cards.forEach(({ key }) => {
      const t = totaisPorCard[key] || { ocorrencias: 0, liberados: 0 };
      rowTotO.push(t.ocorrencias, '');
      rowTotL.push('', t.liberados);
    });
    ws.addRow(rowTotO);
    ws.addRow(rowTotL);
    ws.getRow(ws.rowCount - 1).font = { bold: true };
    ws.getRow(ws.rowCount).font = { bold: true };

    ws.getColumn(1).width = 18;
    for (let i = 2; i <= header2.length; i++) ws.getColumn(i).width = 11;
  }

  function escreverAbaSemFechamentoExcel(ws, payload) {
    const { dias, cards, casosSemFechamento } = payload;
    const sf = casosSemFechamento || { matriz: {}, totaisPorDia: {}, totaisPorCard: {} };
    const header = ['Data', 'Total', ...cards.map((c) => c.label)];
    ws.addRow(header);
    ws.getRow(1).font = { bold: true };
    dias.forEach((dia) => {
      const row = [fmtDiaComSemanaUtc(dia), sf.totaisPorDia[dia] ?? 0];
      cards.forEach(({ key }) => {
        row.push(sf.matriz[dia]?.[key] ?? 0);
      });
      ws.addRow(row);
    });
    const rowTot = ['Total', Object.values(sf.totaisPorDia || {}).reduce((a, b) => a + b, 0)];
    cards.forEach(({ key }) => {
      rowTot.push(sf.totaisPorCard[key] ?? 0);
    });
    ws.addRow(rowTot);
    ws.getRow(ws.rowCount).font = { bold: true };
    ws.getColumn(1).width = 18;
    for (let i = 2; i <= header.length; i++) ws.getColumn(i).width = 14;
  }

  /**
   * GET /api/stats/tabela-liberacao/export
   * Excel: aba Conciliação (layout transposto detalhado) + aba Casos sem Fechamento.
   */
  router.get('/tabela-liberacao/export', async (req, res) => {
    try {
      let client;
      try {
        client = await connectToMongo();
      } catch (err) {
        return res.status(503).send('MongoDB não configurado');
      }
      const db = client.db('hub_ouvidoria');
      const payload = await buildTabelaLiberacaoData(db, req);

      const wb = new ExcelJS.Workbook();
      wb.creator = 'Painel Tempo Real';
      const wsConc = wb.addWorksheet('Conciliação', { views: [{ state: 'frozen', ySplit: 2 }] });
      escreverAbaConciliacaoExcel(wsConc, payload);
      const wsSf = wb.addWorksheet('Casos sem Fechamento', { views: [{ state: 'frozen', ySplit: 1 }] });
      escreverAbaSemFechamentoExcel(wsSf, payload);

      const stamp = DateTime.now().setZone('utc').toFormat('yyyyMMdd_HHmmss');
      const buffer = await wb.xlsx.writeBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="conciliacao_pix_${stamp}.xlsx"`);
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Erro export tabela liberação:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * GET /api/stats/relatorio-ouvidoria-base
   * Mesmo conteúdo lógico de scripts/relatorioOuvidoria4AbasTotaisExcel.js + aba timePortabilidade.
   */
  router.get('/relatorio-ouvidoria-base', async (req, res) => {
    try {
      let client;
      try {
        client = await connectToMongo();
      } catch (err) {
        return res.status(503).send('MongoDB não configurado');
      }
      const db = client.db('hub_ouvidoria');
      const { dataInicio, dataFim } = normalizarIntervaloDatasQueryStats(req.query.dataInicio, req.query.dataFim);
      const { produtos, motivos } = parseProdutoMotivoQuery(req);
      const { gerarRelatorioOuvidoriaBaseExcelBuffer } = require('../services/relatorioOuvidoriaBaseExcel');
      const buffer = await gerarRelatorioOuvidoriaBaseExcelBuffer({ db, dataInicio, dataFim, produtos, motivos });
      const stamp = DateTime.now().setZone('utc').toFormat('yyyyMMdd_HHmmss');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="relatorio_ouvidoria_base_${stamp}.xlsx"`);
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Erro relatorio ouvidoria base:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * GET /api/stats/tabela-liberacao
   * Query: dataInicio, dataFim, produto, motivo (igual GET /api/stats).
   * Resposta: dias[], cards[], matriz, totaisPorDia, totaisPorCard, casosSemFechamento.
   */
  router.get('/tabela-liberacao', async (req, res) => {
    try {
      let client;
      try {
        client = await connectToMongo();
      } catch (err) {
        return res.status(503).json({
          success: false,
          message: 'MongoDB não configurado: ' + err.message,
          data: emptyTabelaLiberacaoPayload(),
        });
      }
      const db = client.db('hub_ouvidoria');
      const data = await buildTabelaLiberacaoData(db, req);

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error('Erro ao buscar tabela liberação:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao buscar tabela de liberação',
        error: error.message,
        data: emptyTabelaLiberacaoPayload(),
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
/** Scripts / relatórios: mesmo Mongo query que GET /api/stats para ouvidoria. */
module.exports.normalizarIntervaloDatasQueryStats = normalizarIntervaloDatasQueryStats;
module.exports.criarFiltroDataPorCollection = criarFiltroDataPorCollection;
module.exports.criarFiltroProduto = criarFiltroProduto;
module.exports.criarFiltroMotivo = criarFiltroMotivo;
module.exports.mesclarFiltros = mesclarFiltros;
/** Mesmas funções do corpo do GET / para montar porTipo (scripts de auditoria). */
module.exports.calcularStatsPorTipo = calcularStatsPorTipo;
module.exports.calcularStatsCardN1 = calcularStatsCardN1;
module.exports.enrichComMostradoresOuvidoria = enrichComMostradoresOuvidoria;
module.exports.auditoriaPainelPredicatesPorDoc = auditoriaPainelPredicatesPorDoc;
module.exports.classificacaoDesdobramentoOuvidoriaNaoN1 = classificacaoDesdobramentoOuvidoriaNaoN1;
/** Scripts / relatórios: mesmo predicado “Liberação Chave Pix” do GET / (motivos_chave_pix / detalhe_2026 / motivoReduzido). */
module.exports.documentoELiberacaoChavePixExclusivo = documentoELiberacaoChavePixExclusivo;
module.exports.documentoResolvidoParaMetricas = documentoResolvidoParaMetricas;
module.exports.documentoLiberacaoAnterior = documentoLiberacaoAnterior;
