/**
 * Middleware de autenticação por sessão - Painel Tempo Real
 * VERSION: v1.0.0
 * Valida sessionId em hub_sessions.
 */

const userSessionLogger = require('../services/userSessionLogger');

async function requireSession(req, res, next) {
  try {
    const sessionId = req.headers['x-session-id'] || req.query.sessionId || req.body?.sessionId;

    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Sessão obrigatória. Faça login.',
      });
    }

    const result = await userSessionLogger.validateSession(sessionId);

    if (!result.valid) {
      return res.status(401).json({
        success: false,
        error: result.expired ? 'Sessão expirada. Faça login novamente.' : 'Sessão inválida.',
        expired: result.expired,
      });
    }

    req.user = {
      email: result.session?.userEmail,
      name: result.session?.colaboradorNome,
      sessionId,
    };
    next();
  } catch (error) {
    console.error('SessionAuth error:', error);
    res.status(500).json({ success: false, error: 'Erro ao verificar sessão' });
  }
}

module.exports = { requireSession };
