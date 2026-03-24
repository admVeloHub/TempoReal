/**
 * Painel Reclamações Tempo Real - Rotas Octadesk (webhook + logs)
 * VERSION: v1.0.0
 */

const { requireSession } = require('../middleware/sessionAuth');
const {
  validateWebhookSecret,
  processOctadeskWebhook,
  listIngestLogs,
} = require('../services/octadeskIngestService');

function registerOctadeskRoutes(app, connectToMongo) {
  app.post('/api/integrations/octadesk/webhook', async (req, res) => {
    if (!validateWebhookSecret(req)) {
      return res.status(401).json({ success: false, message: 'Não autorizado' });
    }
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
      const items = await listIngestLogs(connectToMongo, req.query.limit);
      return res.json({ success: true, data: { items } });
    } catch (err) {
      console.error('[GET /api/integrations/octadesk/logs]', err);
      return res.status(500).json({ success: false, message: err.message || 'Erro ao listar logs' });
    }
  });
}

module.exports = { registerOctadeskRoutes };
