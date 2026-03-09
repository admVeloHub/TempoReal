/**
 * Painel Reclamações Tempo Real - Backend
 * VERSION: v1.1.0
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
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_ENV;

let mongoClient = null;

const connectToMongo = async () => {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI não configurada. Defina no .env');
  }
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGODB_URI);
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

app.listen(PORT, async () => {
  console.log(`Painel Reclamações Backend rodando na porta ${PORT}`);
  if (MONGODB_URI) {
    try {
      await connectToMongo();
      console.log('MongoDB conectado');
    } catch (err) {
      console.error('Erro ao conectar MongoDB:', err.message);
    }
  } else {
    console.warn('MONGODB_URI não definida - /api/stats retornará 503');
  }
});
