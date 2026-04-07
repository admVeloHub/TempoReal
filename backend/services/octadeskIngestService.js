/**
 * Painel Reclamações Tempo Real - Octadesk ingest (helpers + webhook N1 + logs / índices)
 * VERSION: v1.13.0
 *
 * POST /api/integrations/octadesk/webhook: persiste em reclamações_n1Stats quando CF/tópico atende critério chave pix.
 * Documento: motivoReduzido (String canónica "Liberação chave pix"); produto fixo "Antecipação - 2026" na linha N1 (CF libera_o_chave_pix não grava produto; sem persistir libera_o_chave_pix / motivos_chave_pix / pixLiberado no Mongo).
 * Logs em octadesk_ingest_log; stats usam motivoN1ContaComoLiberacaoParaMetricas(motivoReduzido).
 * Autenticação do webhook (opcional): OCTADESK_WEBHOOK_SECRET vazio = POST aberto (arriscado). Com segredo: mesmo valor em header (x-api-key / x-octadesk-webhook-secret)
 * ou na query string (?octadesk_webhook_key=...) — muitos SaaS não permitem headers customizados, mas permitem URL completa com parâmetros.
 * Coleções: hub_ouvidoria.reclamações_n1Stats, hub_ouvidoria.octadesk_ingest_log (LISTA_SCHEMAS.rb).
 */

const crypto = require('crypto');
const os = require('os');

const INGEST_SERVICE_VERSION = 'v1.13.0';

/**
 * Identifica o processo que executou processOctadeskN1Webhook (gravado no octadesk_ingest_log).
 * Assim o /hook distingue linha processada no laptop vs Cloud Run no mesmo Mongo.
 */
function getIngestProcessedByTag() {
  const t = process.env.OCTADESK_INGEST_PROCESSOR_TAG;
  if (t != null && String(t).trim() !== '') return String(t).trim();
  if (process.env.K_SERVICE) return `cloudrun:${process.env.K_SERVICE}`;
  try {
    return `host:${os.hostname()}`;
  } catch (_e) {
    return 'unknown';
  }
}

/** Profundidade máxima na varredura do JSON (webhooks aninhados em data/event, etc.). */
const DEEP_SCAN_MAX_DEPTH = 16;

const N1_STATS_COLLECTION = 'reclamações_n1Stats';
const INGEST_LOG_COLLECTION = 'octadesk_ingest_log';

/** Valor canónico persistido em motivoReduzido (N1); CF Octadesk pode chamar-se motivos_chave_pix. */
const MOTIVOS_CHAVE_PIX_VALOR_CANONICO = 'Liberação chave pix';

/** Linha N1 no Mongo: produto único alinhado ao multiselect da UI (FiltrosAuxiliar). */
const N1_PRODUTO_PERSISTIDO = 'Antecipação - 2026';

/** Retenção do log de ingestão (TTL em receivedAt). */
const INGEST_LOG_TTL_SECONDS = 7 * 24 * 60 * 60;
const INGEST_LOG_RECEIVED_AT_INDEX_NAME = 'receivedAt_ttl_7d';

function normalizeText(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/**
 * Comparação de strings vindas da API/formulário: NFKC, zerar espaços Unicode estranhos, NFD sem acento.
 * Não é “interpretação” do motivo — só evita falhar por bytes diferentes para o mesmo rótulo visível
 * (ex.: NBSP, acento pré-composto vs combinado). Webhook N1 compara só a esta forma + lista explícita de frases.
 */
function normalizeTextOctadesk(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Remove zero-width e BOM que às vezes vêm em campos de formulário. */
function stripInvisible(s) {
  return String(s ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '');
}

function normalizeCfKey(k) {
  return stripInvisible(String(k))
    .trim()
    .replace(/^\uFEFF+/, '')
    .toLowerCase()
    .normalize('NFKC');
}

/**
 * Número do ticket em variantes de envelope Octadesk.
 */
function tryReadTicketNumberFromObject(o) {
  if (!o || typeof o !== 'object') return null;
  const n = o.Number ?? o.Ticket?.Number ?? o.ticket?.Number;
  if (n == null || n === '') return null;
  const num = Number(n);
  return Number.isNaN(num) ? null : num;
}

function resolveOctadeskTicketNumber(body) {
  if (!body || typeof body !== 'object') return null;
  let n = tryReadTicketNumberFromObject(body);
  if (n != null) return n;
  n = tryReadTicketNumberFromObject(body.Data);
  if (n != null) return n;
  n = tryReadTicketNumberFromObject(body.data);
  if (n != null) return n;
  if (typeof body.payload === 'string') {
    try {
      const p = JSON.parse(body.payload);
      n = tryReadTicketNumberFromObject(p);
      if (n != null) return n;
    } catch (_e) {
      /* ignore */
    }
  } else if (body.payload && typeof body.payload === 'object') {
    n = tryReadTicketNumberFromObject(body.payload);
    if (n != null) return n;
  }
  return null;
}

/**
 * Objetos onde TopicName / CustomField podem estar (envelope ≠ ticket na raiz — comum em localhost/proxy).
 */
function topicCarrierObjects(body) {
  const out = [];
  if (!body || typeof body !== 'object') return out;
  out.push(body);
  if (typeof body.payload === 'string') {
    try {
      const p = JSON.parse(body.payload);
      if (p && typeof p === 'object') out.push(p);
    } catch (_e) {
      /* ignore */
    }
  } else if (body.payload && typeof body.payload === 'object') {
    out.push(body.payload);
  }
  if (body.Ticket && typeof body.Ticket === 'object') out.push(body.Ticket);
  if (body.ticket && typeof body.ticket === 'object') out.push(body.ticket);
  if (body.Body && typeof body.Body === 'object') out.push(body.Body);
  if (body.body && typeof body.body === 'object') out.push(body.body);
  if (body.Data && typeof body.Data === 'object') out.push(body.Data);
  if (body.data && typeof body.data === 'object') out.push(body.data);
  return out;
}

/**
 * Normaliza o POST para leitura única: mescla tópico/custom/Number de payload ou Ticket na raiz; CustomField string → objeto.
 */
function coerceOctadeskWebhookBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  let out = { ...body };
  if (typeof out.CustomField === 'string') {
    const shaped = shapeCustomFieldRaw(out.CustomField);
    if (shaped && typeof shaped === 'object' && !Array.isArray(shaped)) {
      out.CustomField = shaped;
    }
  }
  for (const src of topicCarrierObjects(body)) {
    if (!src || src === body || typeof src !== 'object') continue;
    if ((out.TopicName == null || String(out.TopicName).trim() === '') && src.TopicName != null) {
      out.TopicName = src.TopicName;
    }
    if ((out.TopicGroupName == null || String(out.TopicGroupName).trim() === '') && src.TopicGroupName != null) {
      out.TopicGroupName = src.TopicGroupName;
    }
    if (
      (out.Number == null || out.Number === '') &&
      tryReadTicketNumberFromObject(src) != null
    ) {
      out.Number = src.Number ?? src.Ticket?.Number ?? src.ticket?.Number;
    }
    const cfEmpty =
      out.CustomField == null ||
      (typeof out.CustomField === 'object' &&
        !Array.isArray(out.CustomField) &&
        Object.keys(out.CustomField).length === 0);
    if (cfEmpty && src.CustomField != null) {
      const sc = shapeCustomFieldRaw(src.CustomField);
      if (sc && typeof sc === 'object' && !Array.isArray(sc)) {
        out.CustomField = sc;
      } else if (typeof src.CustomField === 'object' && !Array.isArray(src.CustomField)) {
        out.CustomField = { ...src.CustomField };
      }
    }
  }
  const topCf = out.CustomField;
  const hasTopCf =
    topCf != null &&
    typeof topCf === 'object' &&
    !Array.isArray(topCf) &&
    Object.keys(topCf).length > 0;
  const t = out.Ticket && typeof out.Ticket === 'object' ? out.Ticket : null;
  const tCf = t?.CustomField;
  if (!hasTopCf && tCf != null && typeof tCf === 'object' && !Array.isArray(tCf)) {
    out = {
      ...out,
      Number: out.Number ?? t.Number,
      CustomField: tCf,
    };
  }
  return out;
}

/** Raízes do JSON (webhook pode enviar ticket dentro de payload string/objeto, Ticket aninhado, etc.). */
function webhookBodyRoots(body) {
  const roots = [];
  if (!body || typeof body !== 'object') return [body];
  if (typeof body.payload === 'string') {
    try {
      const p = JSON.parse(body.payload);
      if (p && typeof p === 'object') roots.push(p);
    } catch (_e) {
      /* ignore */
    }
  } else if (body.payload && typeof body.payload === 'object') {
    roots.push(body.payload);
  }
  if (body.Body && typeof body.Body === 'object') roots.push(body.Body);
  if (body.body && typeof body.body === 'object') roots.push(body.body);
  if (body.Ticket && typeof body.Ticket === 'object') roots.push(body.Ticket);
  if (body.ticket && typeof body.ticket === 'object') roots.push(body.ticket);
  if (body.Data && typeof body.Data === 'object') roots.push(body.Data);
  if (body.data && typeof body.data === 'object') roots.push(body.data);
  roots.push(body);
  return roots;
}

/**
 * CustomField da Octadesk: objeto, string JSON (parse), array de { key, value }, wrappers (Ticket/Data).
 * Ordem: blocos secundários primeiro; CustomField por último (fonte principal).
 * mergeCustomFieldLayer não aplica undefined; null não apaga valor já preenchido (evita MultiChannelField apagar CF de motivo chave pix).
 * typeof [] === 'object' em JS — array sem normalizar não expõe chaves CF homólogas.
 */
const CUSTOM_FIELD_EXTRACTORS = [
  (b) => b?.RequesterCustomField,
  (b) => b?.requesterCustomField,
  (b) => b?.MultiChannelField,
  (b) => b?.CustomFields,
  (b) => b?.Ticket?.CustomField,
  (b) => b?.ticket?.CustomField,
  (b) => b?.Data?.CustomField,
  (b) => b?.data?.CustomField,
  (b) => b?.customField,
  (b) => b?.CustomField,
];

function mergeCustomFieldLayer(merged, shaped) {
  if (!shaped || typeof shaped !== 'object' || Array.isArray(shaped)) return;
  for (const k of Object.keys(shaped)) {
    const v = shaped[k];
    if (v === undefined) continue;
    if (v === null && k in merged && merged[k] != null && merged[k] !== '') continue;
    /* Não apagar valor já preenchido com string vazia (camadas Octadesk às vezes enviam ""). */
    if (
      v === '' &&
      k in merged &&
      merged[k] != null &&
      String(merged[k]).trim() !== ''
    ) {
      continue;
    }
    merged[k] = v;
  }
}

function foldCustomFieldArray(arr) {
  const out = {};
  if (!Array.isArray(arr)) return out;
  for (const el of arr) {
    if (!el || typeof el !== 'object') continue;
    const k =
      el.key ??
      el.Key ??
      el.name ??
      el.Name ??
      el.field ??
      el.Field ??
      el.fieldName ??
      el.FieldName ??
      el.customFieldKey ??
      el.CustomFieldKey ??
      el.id ??
      el.Id;
    const v =
      el.value ??
      el.Value ??
      el.val ??
      el.selected ??
      el.Selected ??
      el.text ??
      el.Text;
    if (k == null || k === '') continue;
    out[String(k)] = v;
  }
  return out;
}

function shapeCustomFieldRaw(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return null;
    try {
      return shapeCustomFieldRaw(JSON.parse(t));
    } catch (_e) {
      return null;
    }
  }
  if (Array.isArray(raw)) {
    const folded = foldCustomFieldArray(raw);
    return Object.keys(folded).length > 0 ? folded : null;
  }
  if (typeof raw === 'object') return raw;
  return null;
}

function normalizeOctadeskCustomField(body) {
  if (!body || typeof body !== 'object') return {};
  const merged = {};
  for (const root of webhookBodyRoots(body)) {
    if (!root || typeof root !== 'object') continue;
    for (const pick of CUSTOM_FIELD_EXTRACTORS) {
      try {
        const shaped = shapeCustomFieldRaw(pick(root));
        if (shaped && typeof shaped === 'object' && !Array.isArray(shaped)) {
          mergeCustomFieldLayer(merged, shaped);
        }
      } catch (_e) {
        /* ignore */
      }
    }
  }
  /* Garantia: CustomField no topo do POST (fonte mais comum) por último absoluto. */
  try {
    const top = shapeCustomFieldRaw(body.CustomField);
    if (top && typeof top === 'object' && !Array.isArray(top)) {
      mergeCustomFieldLayer(merged, top);
    }
  } catch (_e) {
    /* ignore */
  }
  return merged;
}

function getCustomFieldValue(cf, fieldName) {
  if (!cf || typeof cf !== 'object' || Array.isArray(cf)) return undefined;
  const want = normalizeCfKey(fieldName);
  if (Object.prototype.hasOwnProperty.call(cf, fieldName)) {
    const d = cf[fieldName];
    if (d !== undefined) return d;
  }
  for (const k of Object.keys(cf)) {
    if (normalizeCfKey(k) === want) return cf[k];
  }
  return undefined;
}

/** Valor escalar para regras N1 (string, número, { value }, array[0]). */
function scalarCustomFieldValue(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return stripInvisible(String(v)).trim();
  }
  if (Array.isArray(v)) {
    return v.length === 0 ? '' : stripInvisible(String(scalarCustomFieldValue(v[0]))).trim();
  }
  if (typeof v === 'object') {
    if (v.value != null) return scalarCustomFieldValue(v.value);
    if (v.Value != null) return scalarCustomFieldValue(v.Value);
    if (v.label != null) return scalarCustomFieldValue(v.label);
    if (v.Label != null) return scalarCustomFieldValue(v.Label);
    if (v.Name != null) return scalarCustomFieldValue(v.Name);
    if (v.Display != null) return scalarCustomFieldValue(v.Display);
    if (v.Text != null) return scalarCustomFieldValue(v.Text);
    if (v.text != null) return scalarCustomFieldValue(v.text);
    if (v.Title != null) return scalarCustomFieldValue(v.Title);
    if (v.name != null) return scalarCustomFieldValue(v.name);
    if (v.Description != null) return scalarCustomFieldValue(v.Description);
    if (v.description != null) return scalarCustomFieldValue(v.description);
  }
  return stripInvisible(String(v)).trim();
}

/** Frases equivalentes no formulário Octadesk (fonte única para norm + filtro Mongo stats N1). */
const MOTIVO_LIBERACAO_CHAVE_PIX_LITERALES = [
  'Liberação chave pix',
  'Liberação de chave pix',
  'Liberação da chave pix',
  'Liberacao chave pix',
  'Liberacao de chave pix',
  'Liberação Chave PIX',
  'Chave Pix',
  'chave pix',
  'Solicitação liberação chave pix',
  'Solicitacao liberacao chave pix',
];

/** Frases equivalentes após normalização (comparação com valor recebido). */
const MOTIVO_LIBERACAO_FRASES_NORM = new Set(
  MOTIVO_LIBERACAO_CHAVE_PIX_LITERALES.map((s) => normalizeTextOctadesk(s))
);

/**
 * Valores para $in em motivoReduzido (stats GET /, N1 e ouvidoria): variantes NFC/NFD e legado sem acento.
 * Evita 0 resultados quando o filtro UI “Liberação chave pix” encontra grafia/Unicode diferente ou campo vazio no Mongo (ouvidoria; N1 filtra só motivo+data).
 */
function expandMotivoLiberacaoChavePixParaMongoIn() {
  const out = new Set();
  for (const x of MOTIVO_LIBERACAO_CHAVE_PIX_LITERALES) {
    out.add(x);
    try {
      out.add(x.normalize('NFD'));
      out.add(x.normalize('NFC'));
    } catch (_e) {
      /* ignore */
    }
  }
  out.add(MOTIVOS_CHAVE_PIX_VALOR_CANONICO);
  try {
    out.add(MOTIVOS_CHAVE_PIX_VALOR_CANONICO.normalize('NFD'));
    out.add(MOTIVOS_CHAVE_PIX_VALOR_CANONICO.normalize('NFC'));
  } catch (_e) {
    /* ignore */
  }
  return [...out];
}

/**
 * Valor textual do motivo (campo oficial ou custom homólogo) para regras N1.
 */
function scalarMotivoChavePixFromCf(cf) {
  if (!cf || typeof cf !== 'object' || Array.isArray(cf)) return '';
  let v = scalarCustomFieldValue(getCustomFieldValue(cf, 'motivos_chave_pix'));
  if (v) return v;
  v = scalarCustomFieldValue(getCustomFieldValue(cf, 'motivo_chave_pix'));
  if (v) return v;
  for (const k of Object.keys(cf)) {
    const nk = normalizeCfKey(k);
    if (nk.includes('motivo') && nk.includes('chave') && nk.includes('pix')) {
      const s = scalarCustomFieldValue(cf[k]);
      if (s) return s;
    }
  }
  return '';
}

/** Motivo às vezes só aparece em LastInteraction.PropertiesChanges (rótulo humano Octadesk). */
function scalarMotivoFromPropertiesChanges(body) {
  const pc = body?.LastInteraction?.PropertiesChanges;
  if (!pc || typeof pc !== 'object' || Array.isArray(pc)) return '';
  for (const k of Object.keys(pc)) {
    const nk = normalizeCfKey(k).replace(/\s+/g, '');
    if (nk.includes('motivo') && nk.includes('chave') && nk.includes('pix')) {
      const s = scalarCustomFieldValue(pc[k]);
      if (s) return s;
    }
  }
  return '';
}

/**
 * Texto já normalizado (normalizeTextOctadesk) indica liberação de chave Pix (métricas / ingest).
 */
function compactAlphaNorm(norm) {
  return String(norm).replace(/[^a-z0-9]/g, '');
}

function isMotivoLiberacaoChavePixNorm(norm) {
  if (!norm || typeof norm !== 'string') return false;
  if (MOTIVO_LIBERACAO_FRASES_NORM.has(norm)) return true;
  const compact = compactAlphaNorm(norm);
  if (compact === 'chavepix') return true;
  if (compact === 'liberacaochavepix' || compact === 'liberacaodechavepix' || compact === 'liberacaodachavepix') {
    return true;
  }
  const hasLib = norm.includes('liberacao') || norm.includes('liberar');
  const hasChave = norm.includes('chave');
  const hasPix = norm.includes('pix');
  return hasLib && hasChave && hasPix;
}

/** Fila Octadesk "Chaves Pix" — lê Topic em qualquer envelope (raiz, payload, Ticket, Body). */
function topicFieldsMatchChavesPix(o) {
  if (!o || typeof o !== 'object') return false;
  const candidates = [
    o.TopicName,
    o.TopicGroupName,
    o.topicName,
    o.topicGroupName,
  ];
  for (const c of candidates) {
    if (c == null || c === '') continue;
    const norm = normalizeTextOctadesk(String(c));
    const letters = norm.replace(/[^a-z]+/g, '');
    if (letters.includes('chaves') && letters.includes('pix')) return true;
    if (letters.includes('chave') && letters.includes('pix')) return true;
  }
  return false;
}

function isTopicChavesPix(body) {
  if (!body || typeof body !== 'object') return false;
  return topicCarrierObjects(body).some((o) => topicFieldsMatchChavesPix(o));
}

/** Tópico Chaves Pix em qualquer profundidade (envelope Octadesk / Zapier / proxy). */
function deepScanTopicChavesPix(node, depth, seen) {
  if (depth > DEEP_SCAN_MAX_DEPTH || node == null || typeof node !== 'object') return false;
  if (seen.has(node)) return false;
  seen.add(node);
  if (topicFieldsMatchChavesPix(node)) return true;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (deepScanTopicChavesPix(node[i], depth + 1, seen)) return true;
    }
    return false;
  }
  const keys = Object.keys(node);
  for (let i = 0; i < keys.length; i++) {
    if (deepScanTopicChavesPix(node[keys[i]], depth + 1, seen)) return true;
  }
  return false;
}

/** Objeto “tipo CustomField” com motivo de liberação em qualquer profundidade. */
function deepScanMotivoLiberacao(node, depth, seen) {
  if (depth > DEEP_SCAN_MAX_DEPTH || node == null || typeof node !== 'object') return false;
  if (seen.has(node)) return false;
  seen.add(node);
  if (!Array.isArray(node)) {
    const s = scalarMotivoChavePixFromCf(node);
    if (s && isMotivoLiberacaoChavePixNorm(normalizeTextOctadesk(s))) return true;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (deepScanMotivoLiberacao(node[i], depth + 1, seen)) return true;
    }
    return false;
  }
  const keys = Object.keys(node);
  for (let i = 0; i < keys.length; i++) {
    if (deepScanMotivoLiberacao(node[keys[i]], depth + 1, seen)) return true;
  }
  return false;
}

/**
 * Elegível a gravar em reclamações_n1Stats (ver bloco de decisão no topo do arquivo).
 */
function isN1IngestEligible(body, cf) {
  if (isTopicChavesPix(body)) return true;
  const motivoMerged = scalarMotivoChavePixFromCf(cf);
  const motivoTop =
    body &&
    typeof body === 'object' &&
    body.CustomField &&
    typeof body.CustomField === 'object' &&
    !Array.isArray(body.CustomField)
      ? scalarMotivoChavePixFromCf(body.CustomField)
      : '';
  const motivoStr = motivoMerged || motivoTop || '';
  if (motivoStr && isMotivoLiberacaoChavePixNorm(normalizeTextOctadesk(motivoStr))) {
    return true;
  }
  const seenT = new WeakSet();
  if (deepScanTopicChavesPix(body, 0, seenT)) return true;
  const seenM = new WeakSet();
  if (deepScanMotivoLiberacao(body, 0, seenM)) return true;
  return false;
}

/** Compatível com testes/código que chamam (cf, body). */
function isEligibleCustomFields(customField, body) {
  return isN1IngestEligible(body, customField);
}

/** Mesma regra de "Liberação chave Pix" que o ingest usa — para stats (N1 campo motivoReduzido). */
function motivoN1ContaComoLiberacaoParaMetricas(motivoReduzido) {
  if (motivoReduzido == null || String(motivoReduzido).trim() === '') return false;
  if (String(motivoReduzido).trim() === MOTIVOS_CHAVE_PIX_VALOR_CANONICO) return true;
  return isMotivoLiberacaoChavePixNorm(normalizeTextOctadesk(String(motivoReduzido)));
}

/**
 * Decisão de upsert webhook N1: motivo absoluto do formulário, comparado após normalizeTextOctadesk (só fiação)
 * ao conjunto MOTIVO_LIBERACAO_FRASES_NORM + três compactações alfa explícitas — sem heurística “liberação+chave+pix”
 * de isMotivoLiberacaoChavePixNorm (essa fica só para métricas/legado em motivoN1ContaComoLiberacaoParaMetricas).
 * Caminho do valor: cf mesclado, CustomField na raiz ou PropertiesChanges.
 */
function evaluateWebhookN1PersistDecision(cf, coerced) {
  let motivoStr = scalarMotivoChavePixFromCf(cf);
  let motivoSource = motivoStr ? 'merged_cf' : '';
  if (!motivoStr) {
    motivoStr = scalarMotivoFromPropertiesChanges(coerced);
    if (motivoStr) motivoSource = 'properties_changes';
  }
  if (!motivoStr && coerced?.CustomField && typeof coerced.CustomField === 'object' && !Array.isArray(coerced.CustomField)) {
    motivoStr = scalarMotivoChavePixFromCf(coerced.CustomField);
    if (motivoStr) motivoSource = 'body_customfield';
  }
  const norm = motivoStr ? normalizeTextOctadesk(motivoStr) : '';
  let eligible = false;
  if (motivoStr) {
    if (MOTIVO_LIBERACAO_FRASES_NORM.has(norm)) eligible = true;
    else {
      const compact = compactAlphaNorm(norm);
      eligible =
        compact === 'liberacaochavepix' ||
        compact === 'liberacaodechavepix' ||
        compact === 'liberacaodachavepix';
    }
  }
  if (!eligible) {
    return {
      eligible: false,
      motivoStr: motivoStr || '',
      skipDetail: {
        ingestVersion: INGEST_SERVICE_VERSION,
        motivoRaw: motivoStr || null,
        motivoNorm: norm || null,
        motivoSource: motivoSource || null,
        cfKeyCount: cf && typeof cf === 'object' && !Array.isArray(cf) ? Object.keys(cf).length : 0,
        cfKeysSample:
          cf && typeof cf === 'object' && !Array.isArray(cf) ? Object.keys(cf).slice(0, 30) : [],
      },
    };
  }
  return { eligible: true, motivoStr, motivoSource };
}

function isWebhookEligibleForN1Persist(cf, coerced) {
  return evaluateWebhookN1PersistDecision(cf, coerced || {}).eligible;
}

function cfHasNormalizedKey(cf, fieldName) {
  if (!cf || typeof cf !== 'object' || Array.isArray(cf)) return false;
  const want = normalizeCfKey(fieldName);
  for (const k of Object.keys(cf)) {
    if (normalizeCfKey(k) === want) return true;
  }
  return false;
}

function coerceRetidoNoAtendimento(v) {
  if (v === true || v === false) return v;
  if (v === 'true' || v === '1' || v === 1) return true;
  if (v === 'false' || v === '0' || v === 0) return false;
  return false;
}

/** Data de abertura do ticket (OpenDate); usada só no $setOnInsert.createdAt — campo dataEntradaN1 não é mais persistido (LISTA_SCHEMAS v4.16.15+). */
function parseDataEntradaN1FromBody(body) {
  if (!body || typeof body !== 'object') return null;
  const raw = body.OpenDate ?? body.openDate;
  if (raw == null || raw === '') return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function statusResolvidoFromBody(body) {
  if (!body || typeof body !== 'object') return false;
  const name = body.CurrentStatusName ?? body.currentStatusName;
  if (name == null || name === '') return false;
  return normalizeTextOctadesk(String(name)) === normalizeTextOctadesk('Resolvido');
}

function buildN1WebhookUpsert(coerced, cf, octadeskNumber, now) {
  const retido = coerceRetidoNoAtendimento(getCustomFieldValue(cf, 'retido_no_atendimento'));
  const cpfRaw = getCustomFieldValue(cf, 'cpf_do_titular');
  const cpfStr = cpfRaw == null ? '' : scalarCustomFieldValue(cpfRaw);

  const currentStatus =
    coerced?.CurrentStatusName != null && String(coerced.CurrentStatusName).trim() !== ''
      ? String(coerced.CurrentStatusName).trim()
      : '';
  const resolvido = statusResolvidoFromBody(coerced);

  const $set = {
    cpf: cpfStr,
    motivoReduzido: MOTIVOS_CHAVE_PIX_VALOR_CANONICO,
    produto: N1_PRODUTO_PERSISTIDO,
    retido_no_atendimento: retido,
    currentStatusName: currentStatus,
    Finalizado: resolvido
      ? { Resolvido: true, dataResolucao: now }
      : { Resolvido: false, dataResolucao: null },
    updatedAt: now,
  };

  if (cfHasNormalizedKey(cf, 'escalar_chamado')) {
    const r = getCustomFieldValue(cf, 'escalar_chamado');
    $set.escalar_chamado = r === null ? null : scalarCustomFieldValue(r);
  }

  const createdAtInsert = parseDataEntradaN1FromBody(coerced) || now;

  const $setOnInsert = {
    octadeskNumber,
    createdAt: createdAtInsert,
  };

  const $unset = {
    motivos_chave_pix: '',
    libera_o_chave_pix: '',
    pixLiberado: '',
    detalhe_2026: '',
  };

  return { $set, $setOnInsert, $unset };
}

function clonePayloadForLog(body) {
  if (body == null) return body;
  if (typeof body !== 'object' || Array.isArray(body)) return { _nonObject: String(body) };
  try {
    return JSON.parse(JSON.stringify(body));
  } catch (_e) {
    return { _cloneError: true };
  }
}

/** true quando OCTADESK_WEBHOOK_SECRET não vazio — a rota exige credencial em header ou query. */
function isOctadeskWebhookSecretConfigured() {
  const secret = process.env.OCTADESK_WEBHOOK_SECRET;
  return secret != null && String(secret).trim() !== '';
}

function firstQueryStringMatch(req, names) {
  const q = req.query;
  if (!q || typeof q !== 'object') return '';
  for (const name of names) {
    const v = q[name];
    if (v == null) continue;
    const s = Array.isArray(v) ? v[0] : v;
    if (s == null) continue;
    return String(s);
  }
  return '';
}

/**
 * Valida o webhook: sem OCTADESK_WEBHOOK_SECRET, aceita qualquer POST (só use se não puder autenticar).
 * Com segredo: header x-api-key / x-octadesk-webhook-secret OU query ?octadesk_webhook_key= (ou hook_key), timing-safe.
 */
function validateOctadeskWebhookSecret(req) {
  const secret = process.env.OCTADESK_WEBHOOK_SECRET;
  if (secret == null || String(secret).trim() === '') return true;
  const headerVal =
    req.headers['x-api-key'] ??
    req.headers['x-octadesk-webhook-secret'] ??
    req.headers['X-Api-Key'] ??
    req.headers['X-Octadesk-Webhook-Secret'] ??
    '';
  const queryVal = firstQueryStringMatch(req, ['octadesk_webhook_key', 'hook_key']);
  const candidate = String(headerVal || queryVal).trim();
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(String(secret), 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch (_e) {
    return false;
  }
}

/**
 * Processa um POST webhook Octadesk: log em octadesk_ingest_log; upsert em reclamações_n1Stats se elegível.
 * @returns {Promise<{ outcome: string, octadeskNumber: number|null, message: string }>}
 */
async function processOctadeskN1Webhook(client, bodyRaw) {
  const receivedAt = new Date();
  const db = client.db('hub_ouvidoria');
  const logColl = db.collection(INGEST_LOG_COLLECTION);
  const n1Coll = db.collection(N1_STATS_COLLECTION);

  const payloadForLog = clonePayloadForLog(bodyRaw);

  async function writeLog(entry) {
    await logColl.insertOne({
      receivedAt,
      octadeskNumber: entry.octadeskNumber ?? null,
      outcome: entry.outcome,
      message: entry.message ?? '',
      detail: entry.detail ?? '',
      processedBy: getIngestProcessedByTag(),
      ingestServiceVersion: INGEST_SERVICE_VERSION,
      payload:
        entry.payload && typeof entry.payload === 'object' && !Array.isArray(entry.payload)
          ? entry.payload
          : { _payload: entry.payload },
    });
  }

  if (!bodyRaw || typeof bodyRaw !== 'object' || Array.isArray(bodyRaw)) {
    await writeLog({
      outcome: 'error',
      message: 'Corpo da requisição inválido',
      detail: '',
      octadeskNumber: null,
      payload: { _erro: 'body_deve_ser_objeto_json' },
    });
    return { outcome: 'error', octadeskNumber: null, message: 'Corpo da requisição inválido' };
  }

  const coerced = coerceOctadeskWebhookBody(bodyRaw);
  let cf = normalizeOctadeskCustomField(coerced);
  const octadeskNumber = resolveOctadeskTicketNumber(coerced);

  if (octadeskNumber == null) {
    await writeLog({
      outcome: 'error',
      message: 'Number do ticket ausente ou inválido',
      detail: '',
      octadeskNumber: null,
      payload: payloadForLog,
    });
    return { outcome: 'error', octadeskNumber: null, message: 'Number do ticket ausente ou inválido' };
  }

  const decision = evaluateWebhookN1PersistDecision(cf, coerced);
  if (!decision.eligible) {
    await writeLog({
      outcome: 'skipped',
      message: 'Critério chave pix (webhook N1) não atendido',
      detail: JSON.stringify(decision.skipDetail),
      octadeskNumber,
      payload: payloadForLog,
    });
    return {
      outcome: 'skipped',
      octadeskNumber,
      message: 'skipped',
    };
  }

  const now = new Date();
  const { $set, $setOnInsert, $unset } = buildN1WebhookUpsert(coerced, cf, octadeskNumber, now);

  try {
    await n1Coll.updateOne({ octadeskNumber }, { $set, $setOnInsert, $unset }, { upsert: true });
    await writeLog({
      outcome: 'upsert',
      message: 'reclamações_n1Stats atualizado',
      detail: '',
      octadeskNumber,
      payload: payloadForLog,
    });
    return { outcome: 'upsert', octadeskNumber, message: 'ok' };
  } catch (err) {
    await writeLog({
      outcome: 'error',
      message: err.message || 'Erro MongoDB',
      detail: String(err),
      octadeskNumber,
      payload: payloadForLog,
    });
    return { outcome: 'error', octadeskNumber, message: err.message || 'Erro MongoDB' };
  }
}

async function ensureOctadeskIndexes(client) {
  const db = client.db('hub_ouvidoria');
  const n1 = db.collection(N1_STATS_COLLECTION);
  const log = db.collection(INGEST_LOG_COLLECTION);
  await n1.createIndex({ octadeskNumber: 1 }, { unique: true, sparse: true });

  const existingLogIdx = await log.indexes();
  for (const idx of existingLogIdx) {
    const key = idx.key && typeof idx.key === 'object' ? idx.key : {};
    const keyNames = Object.keys(key);
    if (keyNames.length !== 1 || keyNames[0] !== 'receivedAt') continue;
    if (idx.expireAfterSeconds === INGEST_LOG_TTL_SECONDS) continue;
    try {
      await log.dropIndex(idx.name);
    } catch (e) {
      console.warn('[octadeskIngest] dropIndex receivedAt legado:', idx.name, e.message);
    }
  }

  await log.createIndex(
    { receivedAt: 1 },
    { name: INGEST_LOG_RECEIVED_AT_INDEX_NAME, expireAfterSeconds: INGEST_LOG_TTL_SECONDS }
  );
  await log.createIndex({ octadeskNumber: 1 });
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
      processedBy: doc.processedBy ?? null,
      ingestServiceVersion: doc.ingestServiceVersion ?? null,
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
      webhookRequiresSecret: isOctadeskWebhookSecretConfigured(),
      processorTagThisApi: getIngestProcessedByTag(),
      ingestServiceVersionThisApi: INGEST_SERVICE_VERSION,
    },
  };
}

module.exports = {
  INGEST_SERVICE_VERSION,
  MOTIVOS_CHAVE_PIX_VALOR_CANONICO,
  N1_STATS_COLLECTION,
  INGEST_LOG_COLLECTION,
  INGEST_LOG_TTL_SECONDS,
  INGEST_LOG_RECEIVED_AT_INDEX_NAME,
  normalizeText,
  normalizeTextOctadesk,
  normalizeOctadeskCustomField,
  coerceOctadeskWebhookBody,
  isEligibleCustomFields,
  isN1IngestEligible,
  isWebhookEligibleForN1Persist,
  evaluateWebhookN1PersistDecision,
  motivoN1ContaComoLiberacaoParaMetricas,
  expandMotivoLiberacaoChavePixParaMongoIn,
  validateOctadeskWebhookSecret,
  isOctadeskWebhookSecretConfigured,
  processOctadeskN1Webhook,
  ensureOctadeskIndexes,
  listIngestLogs,
  listIngestLogsWithMeta,
  getIngestProcessedByTag,
};
