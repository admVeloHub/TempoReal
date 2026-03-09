/**
 * User Session Logger - Painel Tempo Real
 * VERSION: v1.0.0
 * Log de sessões em console_conteudo.hub_sessions
 */

const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_ENV;
const SESSION_EXPIRATION_MS = 4 * 60 * 60 * 1000; // 4 horas

class UserSessionLogger {
  constructor() {
    this.client = null;
    this.db = null;
    this.collection = null;
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected) return;
    if (!MONGODB_URI) throw new Error('MONGODB_URI não configurada');
    const { MongoClient } = require('mongodb');
    this.client = new MongoClient(MONGODB_URI);
    await this.client.connect();
    this.db = this.client.db('console_conteudo');
    this.collection = this.db.collection('hub_sessions');
    this.isConnected = true;
  }

  async logLogin(colaboradorNome, userEmail, ipAddress = null, userAgent = null) {
    try {
      await this.connect();
      const sessionId = uuidv4();
      const now = new Date();
      const session = {
        colaboradorNome,
        userEmail,
        sessionId,
        ipAddress,
        userAgent,
        isActive: true,
        loginTimestamp: now,
        logoutTimestamp: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.collection.insertOne(session);
      return { success: true, sessionId };
    } catch (error) {
      console.error('SessionLogger: Erro ao registrar login:', error.message);
      return { success: false, error: error.message };
    }
  }

  async logLogout(sessionId) {
    try {
      await this.connect();
      const session = await this.collection.findOne({ sessionId, isActive: true });
      if (!session) {
        return { success: false, error: 'Sessão não encontrada ou já inativa' };
      }
      const now = new Date();
      const duration = Math.round((now - session.loginTimestamp) / 1000 / 60);
      await this.collection.updateOne(
        { sessionId },
        { $set: { isActive: false, logoutTimestamp: now, updatedAt: now } }
      );
      return { success: true, duration, colaboradorNome: session.colaboradorNome };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async updateSession(sessionId) {
    try {
      await this.connect();
      const session = await this.collection.findOne({ sessionId });
      if (!session) {
        return { success: false, expired: false, error: 'Sessão não encontrada' };
      }
      const elapsedTime = Date.now() - session.loginTimestamp;
      if (elapsedTime > SESSION_EXPIRATION_MS) {
        await this.collection.updateOne(
          { sessionId },
          { $set: { isActive: false, logoutTimestamp: new Date(), updatedAt: new Date() } }
        );
        return { success: false, expired: true, error: 'Sessão expirada' };
      }
      await this.collection.updateOne(
        { sessionId },
        { $set: { isActive: true, updatedAt: new Date() } }
      );
      return { success: true, expired: false };
    } catch (error) {
      return { success: false, expired: false, error: error.message };
    }
  }

  async reactivateSession(userEmail) {
    try {
      await this.connect();
      const sessions = await this.collection
        .find({ userEmail })
        .sort({ loginTimestamp: -1 })
        .limit(1)
        .toArray();
      if (!sessions || sessions.length === 0) {
        return { success: false, expired: false, error: 'Nenhuma sessão encontrada' };
      }
      const latest = sessions[0];
      const elapsedTime = Date.now() - latest.loginTimestamp;
      if (elapsedTime > SESSION_EXPIRATION_MS) {
        return { success: false, expired: true, error: 'Sessão expirada' };
      }
      await this.collection.updateOne(
        { sessionId: latest.sessionId },
        { $set: { isActive: true, updatedAt: new Date() } }
      );
      return { success: true, sessionId: latest.sessionId, expired: false };
    } catch (error) {
      return { success: false, expired: false, error: error.message };
    }
  }

  async validateSession(sessionId) {
    try {
      await this.connect();
      const session = await this.collection.findOne({ sessionId });
      if (!session) {
        return { valid: false, expired: false, session: null };
      }
      const expired = Date.now() - session.loginTimestamp > SESSION_EXPIRATION_MS;
      return {
        valid: !expired && session.isActive,
        expired,
        session,
      };
    } catch (error) {
      return { valid: false, expired: false, session: null };
    }
  }
}

module.exports = new UserSessionLogger();
