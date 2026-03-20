/**
 * Painel Reclamações Tempo Real - Backend
 * VERSION: v1.2.3
 *
 * Servidor Express com auth e GET /api/stats (protegido por sessão).
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const initStatsRoutes = require('./routes/stats');
const initAuthRoutes = require('./routes/auth');
const { requireSession } = require('./middleware/sessionAuth');

const PORT = process.env.PORT || 5050;
/** String de conexão MongoDB: variável de ambiente MONGO_ENV (ex.: Cloud Run Secret). */
const mongoConnectionUri = process.env.MONGO_ENV;

let mongoClient = null;

/** Ping curto: evita reutilizar cliente após idle/rede (Cloud Run) com topologia já fechada. */
async function resetMongoClientIfDead() {
  if (!mongoClient) return;
  try {
    await mongoClient.db('admin').command({ ping: 1 }, { maxTimeMS: 5000 });
  } catch (_e) {
    try {
      await mongoClient.close();
    } catch (_close) {
      /* ignore */
    }
    mongoClient = null;
  }
}

const connectToMongo = async () => {
  if (!mongoConnectionUri) {
    throw new Error('MONGO_ENV não configurada. Defina a string de conexão MongoDB no ambiente.');
  }
  await resetMongoClientIfDead();
  if (!mongoClient) {
    mongoClient = new MongoClient(mongoConnectionUri);
    await mongoClient.connect();
  }
  return mongoClient;
};

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', initAuthRoutes(connectToMongo));
app.use('/api/stats', requireSession, initStatsRoutes(connectToMongo));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, status: 'running' });
});

const startServer = () => {
  app.listen(PORT, async () => {
    console.log(`Painel Reclamações Backend rodando na porta ${PORT}`);
    if (mongoConnectionUri) {
      try {
        await connectToMongo();
        console.log('MongoDB conectado');
      } catch (err) {
        console.error('Erro ao conectar MongoDB:', err.message);
      }
    } else {
      console.warn('MONGO_ENV não definida - /api/stats e auth falharão até configurar');
    }
  });
};

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, connectToMongo, PORT };
