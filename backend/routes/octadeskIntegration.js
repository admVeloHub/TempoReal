/**
 * Painel Reclamações Tempo Real - Rotas Octadesk (webhook N1 + logs + supervisão)
 * VERSION: v1.6.3
 *
 * POST /api/integrations/octadesk/webhook: Octadesk → reclamações_n1Stats + octadesk_ingest_log. Com OCTADESK_WEBHOOK_SECRET: header ou ?octadesk_webhook_key=; sem variável: POST aberto.
 * POST supervisao/run-hourly: secret em x-octa-supervisao-secret (OCTA_SUPERVISAO_RUN_SECRET); agrega hora anterior + IA opcional.
 */

const { requireSession } = require('../middleware/sessionAuth');
const {
  listIngestLogsWithMeta,
  validateOctadeskWebhookSecret,
  processOctadeskN1Webhook,
} = require('../services/octadeskIngestService');
const {
  runHourlySupervisaoJob,
  validateSupervisaoRunSecret,
} = require('../services/octaSupervisaoService');

function registerOctadeskRoutes(app, connectToMongo) {
  app.post('/api/integrations/octadesk/webhook', async (req, res) => {
    if (!validateOctadeskWebhookSecret(req)) {
      return res.status(401).json({
        success: false,
        outcome: 'unauthorized',
        message: 'Unauthorized',
      });
    }
    try {
      const client = await connectToMongo();
      const result = await processOctadeskN1Webhook(client, req.body);
      if (result.outcome === 'error' && result.octadeskNumber == null) {
        return res.status(400).json({ success: false, ...result });
      }
      if (result.outcome === 'error') {
        return res.status(500).json({ success: false, ...result });
      }
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('[POST /api/integrations/octadesk/webhook]', err);
      return res.status(500).json({
        success: false,
        outcome: 'error',
        message: err.message || 'Erro ao processar webhook',
      });
    }
  });

  app.post('/api/integrations/octadesk/supervisao/run-hourly', async (req, res) => {
    if (!validateSupervisaoRunSecret(req)) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    try {
      const client = await connectToMongo();
      const data = await runHourlySupervisaoJob(client);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[POST /api/integrations/octadesk/supervisao/run-hourly]', err);
      return res.status(500).json({
        success: false,
        message: err.message || 'Erro ao executar job horário',
      });
    }
  });

  app.get('/api/integrations/octadesk/logs', requireSession, async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.set('Pragma', 'no-cache');
      const includePayload =
        req.query.includePayload === '1' || req.query.includePayload === 'true';
      const { items, meta } = await listIngestLogsWithMeta(connectToMongo, req.query.limit, {
        includePayload,
      });
      return res.json({ success: true, data: { items, meta } });
    } catch (err) {
      console.error('[GET /api/integrations/octadesk/logs]', err);
      return res.status(500).json({ success: false, message: err.message || 'Erro ao listar logs' });
    }
  });
}

module.exports = { registerOctadeskRoutes };
