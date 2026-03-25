/**
 * Painel Reclamações Tempo Real - Octadesk ingest (webhook → MongoDB)
 * VERSION: v1.3.0
 *
 * Regras: motivo_2026 = Chave Pix → registra e alimenta Ped. Liberação (motivoReduzido compatível com stats).
 * Detalhe Liberação Chave Pix + status Resolvido → pixLiberado (mostrador Liberados / “retirado”).
 * Detalhe Retenção Chave Pix + Resolvido → retido (pixLiberado false).
 *
 * Coleções: hub_ouvidoria.reclamações_n1Stats, hub_ouvidoria.octadesk_ingest_log (LISTA_SCHEMAS.rb)
 */

const N1_STATS_COLLECTION = 'reclamações_n1Stats';
const INGEST_LOG_COLLECTION = 'octadesk_ingest_log';

/** Limite defensivo para não exceder 16MB do documento MongoDB. */
const MAX_PAYLOAD_JSON_CHARS = 900_000;

/**
 * Cópia segura do body do webhook para persistir em octadesk_ingest_log.payload (Object).
 */
function cloneBodyForLog(body) {
  if (body == null || typeof body !== 'object') return null;
  try {
    const s = JSON.stringify(body);
    if (s.length > MAX_PAYLOAD_JSON_CHARS) {
      return {
        _payloadTruncated: true,
        _originalLength: s.length,
        _preview: s.slice(0, 80_000),
      };
    }
    return JSON.parse(s);
  } catch (_e) {
    return { _payloadError: 'body não serializável em JSON' };
  }
}

/**
 * Sempre retorna um Object persistível: cópia do body do webhook ou envelope explícito.
 * Garante que /hook possa exibir JSON por entrega após deploy.
 */
function snapshotWebhookBody(body) {
  if (body == null) {
    return { _webhookBodyAusente: true };
  }
  if (typeof body === 'object') {
    const cloned = cloneBodyForLog(body);
    if (cloned != null) return cloned;
    return { _webhookBodySerializacao: 'falha ao clonar objeto' };
  }
  return {
    _webhookBodyTipoPrimitivo: typeof body,
    valor: String(body).slice(0, 50_000),
  };
}

function normalizeText(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

const DETALHE_LIBERACAO_CHAVE_PIX = 'liberacao chave pix';
const DETALHE_RETENCAO_CHAVE_PIX = normalizeText('Retenção Chave Pix');
const MOTIVO_CHAVE_PIX = 'chave pix';

function isEligibleCustomFields(customField) {
  if (!customField || typeof customField !== 'object') return false;
  const m = customField.motivo_2026;
  if (m == null || String(m).trim() === '') return false;
  return normalizeText(m) === MOTIVO_CHAVE_PIX;
}

function statusResolvido(currentStatusName) {
  return normalizeText(currentStatusName) === normalizeText('Resolvido');
}

/**
 * Liberados no painel: só quando Resolvido e detalhe = Liberação Chave Pix.
 * Retidos: Resolvido + detalhe Retenção Chave Pix (e demais casos resolvidos sem “liberação”) → pixLiberado false.
 */
function computePixLiberado(detalhe2026, resolved) {
  if (!resolved) return false;
  const dn = normalizeText(detalhe2026);
  if (dn === DETALHE_LIBERACAO_CHAVE_PIX) return true;
  if (dn === DETALHE_RETENCAO_CHAVE_PIX) return false;
  return false;
}

/**
 * Monta $set a partir do payload Octadesk + documento existente (dataResolucao preservada quando já resolvido).
 */
function buildMergedSet(body, existing) {
  const cf = body.CustomField && typeof body.CustomField === 'object' ? body.CustomField : {};
  const num = Number(body.Number);
  const openDate = body.OpenDate ? new Date(body.OpenDate) : new Date();
  const dataEntradaN1 = existing?.dataEntradaN1 ?? openDate;
  const resolved = statusResolvido(body.CurrentStatusName);
  const detRaw = cf.detalhe_2026 != null ? String(cf.detalhe_2026) : '';

  let dataResolucao = existing?.Finalizado?.dataResolucao ?? null;
  if (resolved) {
    if (!dataResolucao) dataResolucao = new Date();
  } else {
    dataResolucao = null;
  }

  const topicProduto =
    body.TopicName != null && String(body.TopicName).trim()
      ? String(body.TopicName).trim()
      : body.TopicGroupName != null && String(body.TopicGroupName).trim()
        ? String(body.TopicGroupName).trim()
        : undefined;

  const produto =
    cf.produto != null && String(cf.produto).trim()
      ? String(cf.produto).trim()
      : cf.produto_2026 != null && String(cf.produto_2026).trim()
        ? String(cf.produto_2026).trim()
        : topicProduto !== undefined
          ? topicProduto
          : existing?.produto;

  const cpfRaw = cf.cpf_do_titular != null ? String(cf.cpf_do_titular).replace(/\D/g, '') : '';
  const cpf = cpfRaw || existing?.cpf || '';

  const setDoc = {
    octadeskNumber: num,
    cpf,
    motivo_2026: cf.motivo_2026 != null ? String(cf.motivo_2026) : '',
    detalhe_2026: detRaw,
    currentStatusName: body.CurrentStatusName != null ? String(body.CurrentStatusName) : '',
    motivoReduzido: ['Liberação Chave Pix'],
    pixLiberado: computePixLiberado(detRaw, resolved),
    dataEntradaN1,
    Finalizado: {
      Resolvido: Boolean(resolved),
      dataResolucao,
    },
    updatedAt: new Date(),
  };

  if (produto !== undefined) setDoc.produto = produto;

  return setDoc;
}

async function writeIngestLog(db, { octadeskNumber, outcome, message, detail, payload }) {
  try {
    const snap =
      payload != null && typeof payload === 'object'
        ? payload
        : { _erroInternoPayload: true };
    const doc = {
      receivedAt: new Date(),
      octadeskNumber: octadeskNumber != null ? Number(octadeskNumber) : null,
      outcome,
      message: String(message || '').slice(0, 500),
      detail: detail != null ? String(detail).slice(0, 1000) : '',
      payload: snap,
    };
    await db.collection(INGEST_LOG_COLLECTION).insertOne(doc);
  } catch (e) {
    console.error('[octadeskIngest] writeIngestLog failed:', e.message);
  }
}

async function ensureOctadeskIndexes(client) {
  const db = client.db('hub_ouvidoria');
  const n1 = db.collection(N1_STATS_COLLECTION);
  const log = db.collection(INGEST_LOG_COLLECTION);
  await n1.createIndex({ octadeskNumber: 1 }, { unique: true, sparse: true });
  await log.createIndex({ receivedAt: -1 });
  await log.createIndex({ octadeskNumber: 1 });
}

/**
 * Processa corpo JSON do webhook. Retorna { httpStatus, outcome, message }.
 */
async function processOctadeskWebhook(body, connectToMongo) {
  const client = await connectToMongo();
  const db = client.db('hub_ouvidoria');
  const coll = db.collection(N1_STATS_COLLECTION);

  if (!body || typeof body !== 'object') {
    await writeIngestLog(db, {
      octadeskNumber: null,
      outcome: 'error',
      message: 'Body inválido',
      payload: snapshotWebhookBody(body),
    });
    return { httpStatus: 400, outcome: 'error', message: 'Body inválido' };
  }

  const numRaw = body.Number;
  if (numRaw == null || numRaw === '' || Number.isNaN(Number(numRaw))) {
    await writeIngestLog(db, {
      octadeskNumber: null,
      outcome: 'error',
      message: 'Number ausente ou inválido',
      payload: snapshotWebhookBody(body),
    });
    return { httpStatus: 400, outcome: 'error', message: 'Number obrigatório' };
  }

  const num = Number(numRaw);
  const cf = body.CustomField && typeof body.CustomField === 'object' ? body.CustomField : {};

  if (!isEligibleCustomFields(cf)) {
    await writeIngestLog(db, {
      octadeskNumber: num,
      outcome: 'skipped',
      message: 'Critérios N1 não atendidos',
      detail: JSON.stringify({ motivo_2026: cf.motivo_2026, detalhe_2026: cf.detalhe_2026 }),
      payload: snapshotWebhookBody(body),
    });
    return { httpStatus: 200, outcome: 'skipped', message: 'Fora dos critérios' };
  }

  try {
    const existing = await coll.findOne({ octadeskNumber: num });
    const $set = buildMergedSet(body, existing);

    await coll.updateOne(
      { octadeskNumber: num },
      { $set: $set, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );

    await writeIngestLog(db, {
      octadeskNumber: num,
      outcome: 'upsert',
      message: 'Documento N1 atualizado',
      payload: snapshotWebhookBody(body),
    });

    return { httpStatus: 200, outcome: 'upsert', message: 'OK' };
  } catch (err) {
    console.error('[octadeskIngest] persist error:', err);
    await writeIngestLog(db, {
      octadeskNumber: num,
      outcome: 'error',
      message: err.message || 'Erro ao persistir',
      payload: snapshotWebhookBody(body),
    });
    return { httpStatus: 500, outcome: 'error', message: err.message || 'Erro interno' };
  }
}

async function listIngestLogs(connectToMongo, limit = 100, options = {}) {
  const includePayload = Boolean(options.includePayload);
  const client = await connectToMongo();
  const db = client.db('hub_ouvidoria');
  const lim = Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 500);
  let cursor = db.collection(INGEST_LOG_COLLECTION).find({}).sort({ receivedAt: -1 }).limit(lim);
  if (!includePayload) {
    cursor = cursor.project({ payload: 0 });
  }
  const raw = await cursor.toArray();
  return raw.map((doc) => {
    const row = {
      id: doc._id?.toString?.() || String(doc._id),
      receivedAt: doc.receivedAt,
      octadeskNumber: doc.octadeskNumber,
      outcome: doc.outcome,
      message: doc.message,
      detail: doc.detail,
    };
    if (includePayload) {
      if (doc.payload != null && typeof doc.payload === 'object') {
        row.payload = doc.payload;
        row.payloadCapturado = true;
      } else {
        row.payload = {
          _postOriginalNaoArmazenado: true,
          _explicacao:
            'Registro antigo: o servidor não guardou o corpo do POST. Com octadeskIngest v1.3+ em produção, cada novo webhook passa a salvar o JSON da Octadesk em payload.',
        };
        row.payloadCapturado = false;
      }
    }
    return row;
  });
}

async function listIngestLogsWithMeta(connectToMongo, limit = 100, options = {}) {
  const items = await listIngestLogs(connectToMongo, limit, options);
  let approximateTotalInCollection = null;
  try {
    const client = await connectToMongo();
    const db = client.db('hub_ouvidoria');
    approximateTotalInCollection = await db.collection(INGEST_LOG_COLLECTION).estimatedDocumentCount();
  } catch (e) {
    console.warn('[octadeskIngest] estimatedDocumentCount:', e.message);
  }
  return {
    items,
    meta: {
      fetchedAt: new Date().toISOString(),
      countReturned: items.length,
      approximateTotalInCollection,
      webhookRequiresSecret: false,
    },
  };
}

module.exports = {
  N1_STATS_COLLECTION,
  INGEST_LOG_COLLECTION,
  normalizeText,
  isEligibleCustomFields,
  processOctadeskWebhook,
  ensureOctadeskIndexes,
  listIngestLogs,
  listIngestLogsWithMeta,
};
