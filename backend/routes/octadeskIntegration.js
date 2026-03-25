/**
 * Painel Reclamações Tempo Real - Rotas Octadesk (webhook + logs)
 * VERSION: v1.3.0
 *
 * POST webhook: sem autenticação por segredo (requisito Octadesk). Restrinja por rede/API Gateway se necessário.
 */

const { requireSession } = require('../middleware/sessionAuth');
const { processOctadeskWebhook, listIngestLogsWithMeta } = require('../services/octadeskIngestService');

function registerOctadeskRoutes(app, connectToMongo) {
  app.post('/api/integrations/octadesk/webhook', async (req, res) => {
    console.log('[WEBHOOK OCTADESK] POST recebido (sem checagem de secret)');
    try {
      const r = await processOctadeskWebhook(req.body, connectToMongo);
      return res.status(r.httpStatus).json({
        success: r.httpStatus < 400,
        outcome: r.outcome,
        message: r.message,
      });
    } catch (err) {
      console.error('[POST /api/integrations/octadesk/webhook]', err);
      return res.status(500).json({
        success: false,
        outcome: 'error',
        message: err.message || 'Erro interno',
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
