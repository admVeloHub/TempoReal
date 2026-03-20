/**
 * Painel Reclamações Tempo Real - Auth Routes
 * VERSION: v1.0.3
 * Login e sessão. Acesso exige acessos.tempoReal === true em qualidade_funcionarios.
 */

const express = require('express');
const router = express.Router();
const userSessionLogger = require('../services/userSessionLogger');
const { generateDefaultPassword } = require('../utils/password');

function isDbConnectionError(err) {
  const msg = err && (err.message || err.reason?.message || String(err));
  if (!msg) return false;
  const s = String(msg).toLowerCase();
  return (
    s.includes('mongo_env') ||
    s.includes('mongo') ||
    s.includes('server selection') ||
    s.includes('econnrefused') ||
    s.includes('etimedout') ||
    s.includes('enotfound') ||
    s.includes('topology') ||
    s.includes('querySrv')
  );
}

function initAuthRoutes(connectToMongo) {
  const getFuncionariosDb = async () => {
    const client = await connectToMongo();
    return client.db('console_analises');
  };

  const checkTempoRealAccess = (funcionario) => {
    if (!funcionario) return { ok: false, error: 'Usuário não encontrado' };
    if (funcionario.desligado === true) return { ok: false, error: 'Usuário desligado' };
    if (funcionario.afastado === true) return { ok: false, error: 'Usuário afastado' };
    if (funcionario.suspenso === true) return { ok: false, error: 'Usuário suspenso' };
    const acessos = funcionario.acessos || {};
    const tempoReal = acessos.tempoReal || acessos.TempoReal || acessos.realTime || acessos.RealTime || false;
    if (!tempoReal) {
      return { ok: false, error: 'Acesso ao Painel Tempo Real não autorizado. Contate o administrador.' };
    }
    return { ok: true };
  };

  // POST /api/auth/login
  router.post('/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email e senha são obrigatórios' });
      }

      const db = await getFuncionariosDb();
      const funcionariosCollection = db.collection('qualidade_funcionarios');
      const funcionario = await funcionariosCollection.findOne({
        userMail: email.toLowerCase(),
      });

      if (!funcionario) {
        return res.status(404).json({
          success: false,
          error: 'Usuário inexistente. Contate seu gestor.',
        });
      }

      const accessCheck = checkTempoRealAccess(funcionario);
      if (!accessCheck.ok) {
        return res.status(403).json({ success: false, error: accessCheck.error });
      }

      const passwordHash = funcionario.password || '';
      let passwordToCompare = passwordHash;
      if (!passwordHash || passwordHash.trim() === '') {
        passwordToCompare = generateDefaultPassword(
          funcionario.colaboradorNome || '',
          funcionario.CPF || ''
        );
      }

      const passwordMatch =
        passwordToCompare && password.toLowerCase() === passwordToCompare.toLowerCase();
      if (!passwordMatch) {
        return res.status(401).json({ success: false, error: 'Email ou senha incorretos' });
      }

      const userData = {
        name: funcionario.colaboradorNome || email,
        email: funcionario.userMail,
        picture: funcionario.profile_pic || funcionario.fotoPerfil || null,
      };

      const sessionResult = await userSessionLogger.logLogin(
        funcionario.colaboradorNome,
        funcionario.userMail,
        req.ip,
        req.get('User-Agent')
      );

      res.json({
        success: true,
        user: userData,
        sessionId: sessionResult.sessionId,
        message: 'Login realizado com sucesso',
      });
    } catch (error) {
      console.error('Auth login error:', error);
      const dbErr = isDbConnectionError(error);
      res.status(dbErr ? 503 : 500).json({
        success: false,
        error: dbErr
          ? 'Serviço indisponível: falha ao conectar ao banco de dados. Verifique MONGO_ENV no servidor.'
          : 'Erro interno do servidor',
      });
    }
  });

  // POST /api/auth/validate-access (Google OAuth)
  router.post('/validate-access', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ success: false, error: 'Email é obrigatório' });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const db = await getFuncionariosDb();
      const funcionariosCollection = db.collection('qualidade_funcionarios');

      let funcionario = await funcionariosCollection.findOne({
        $or: [
          { userMail: normalizedEmail },
          { userMail: { $regex: new RegExp(`^${normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
          { email: normalizedEmail },
        ],
      });

      if (!funcionario) {
        return res.status(404).json({
          success: false,
          error: 'Usuário inexistente. Contate seu gestor.',
        });
      }

      const accessCheck = checkTempoRealAccess(funcionario);
      if (!accessCheck.ok) {
        return res.status(403).json({ success: false, error: accessCheck.error });
      }

      const emailResolved = funcionario.userMail || funcionario.email || normalizedEmail;
      const userData = {
        name: funcionario.colaboradorNome || emailResolved,
        email: typeof emailResolved === 'string' ? emailResolved.toLowerCase().trim() : normalizedEmail,
        picture: funcionario.profile_pic || funcionario.fotoPerfil || null,
      };

      res.json({ success: true, user: userData, message: 'Acesso validado com sucesso' });
    } catch (error) {
      console.error('Auth validate-access error:', error);
      const dbErr = isDbConnectionError(error);
      res.status(dbErr ? 503 : 500).json({
        success: false,
        error: dbErr
          ? 'Serviço indisponível: falha ao conectar ao banco de dados. Verifique MONGO_ENV no servidor.'
          : 'Erro interno do servidor',
      });
    }
  });

  // POST /api/auth/session/login
  router.post('/session/login', async (req, res) => {
    try {
      const { colaboradorNome, userEmail } = req.body;
      if (!colaboradorNome || !userEmail) {
        return res.status(400).json({
          success: false,
          error: 'colaboradorNome e userEmail são obrigatórios',
        });
      }

      const result = await userSessionLogger.logLogin(
        colaboradorNome,
        userEmail,
        req.ip,
        req.get('User-Agent')
      );

      if (!result.success) {
        return res.status(500).json({ success: false, error: result.error });
      }

      res.json({
        success: true,
        sessionId: result.sessionId,
        message: 'Login registrado com sucesso',
      });
    } catch (error) {
      console.error('Session login error:', error);
      res.status(500).json({ success: false, error: 'Erro interno do servidor' });
    }
  });

  // POST /api/auth/session/logout
  router.post('/session/logout', async (req, res) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(400).json({ success: false, error: 'sessionId é obrigatório' });
      }

      const result = await userSessionLogger.logLogout(sessionId);
      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }

      res.json({
        success: true,
        duration: result.duration,
        message: 'Logout registrado com sucesso',
      });
    } catch (error) {
      console.error('Session logout error:', error);
      res.status(500).json({ success: false, error: 'Erro interno do servidor' });
    }
  });

  // POST /api/auth/session/heartbeat
  router.post('/session/heartbeat', async (req, res) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(400).json({ success: false, error: 'sessionId é obrigatório' });
      }

      const result = await userSessionLogger.updateSession(sessionId);

      if (result.expired) {
        return res.status(401).json({
          success: false,
          expired: true,
          error: 'Sessão expirada - novo login necessário',
        });
      }

      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }

      res.json({ success: true, message: 'Heartbeat recebido' });
    } catch (error) {
      console.error('Heartbeat error:', error);
      res.status(500).json({ success: false, error: 'Erro interno do servidor' });
    }
  });

  // POST /api/auth/session/reactivate
  router.post('/session/reactivate', async (req, res) => {
    try {
      const { userEmail } = req.body;
      if (!userEmail) {
        return res.status(400).json({ success: false, error: 'userEmail é obrigatório' });
      }

      const result = await userSessionLogger.reactivateSession(userEmail);

      if (result.expired) {
        return res.status(401).json({
          success: false,
          expired: true,
          error: 'Sessão expirada - novo login necessário',
        });
      }

      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }

      res.json({
        success: true,
        sessionId: result.sessionId,
        message: 'Sessão reativada com sucesso',
      });
    } catch (error) {
      console.error('Reactivate error:', error);
      res.status(500).json({ success: false, error: 'Erro interno do servidor' });
    }
  });

  return router;
}

module.exports = initAuthRoutes;
