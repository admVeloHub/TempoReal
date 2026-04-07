/**
 * Painel Reclamações Tempo Real - Backend
 * VERSION: v1.4.10
 *
 * Servidor Express com auth, GET /api/stats; rotas Octadesk (POST webhook N1, logs, supervisão).
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const initStatsRoutes = require('./routes/stats');
const initAuthRoutes = require('./routes/auth');
const { requireSession } = require('./middleware/sessionAuth');
const { registerOctadeskRoutes } = require('./routes/octadeskIntegration');
const {
  ensureOctadeskIndexes,
  INGEST_SERVICE_VERSION,
} = require('./services/octadeskIngestService');
const { startOctadeskIngestLogTailConsole } = require('./services/octadeskIngestTailService');
const {
  ensureOctaSupervisaoIndexes,
  registerOctaSupervisaoCron,
} = require('./services/octaSupervisaoService');

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
registerOctadeskRoutes(app, connectToMongo);
app.use('/api/stats', requireSession, initStatsRoutes(connectToMongo));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, status: 'running', octadeskIngest: INGEST_SERVICE_VERSION });
});

/** JSON inválido (body-parser): resposta JSON em vez de HTML — clientes com aspas erradas (ex.: curl+PowerShell) enxergam o problema claramente. */
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      outcome: 'error',
      message:
        'Corpo da requisição não é JSON válido. Em PowerShell, com curl.exe, coloque o JSON inteiro entre aspas simples ou use Invoke-RestMethod com -Body e ContentType application/json.',
    });
  }
  next(err);
});

const startServer = () => {
  const server = app.listen(PORT, async () => {
    const whSecretOk = Boolean(
      process.env.OCTADESK_WEBHOOK_SECRET && String(process.env.OCTADESK_WEBHOOK_SECRET).trim()
    );
    console.log(
      `Painel Reclamações Backend porta ${PORT} | Octadesk ingest ${INGEST_SERVICE_VERSION} | webhook N1 ${
        whSecretOk
          ? 'protegido (OCTADESK_WEBHOOK_SECRET: header ou ?octadesk_webhook_key=)'
          : 'sem autenticação no webhook — arriscado; prefira segredo + URL com query (ver .env.example)'
      }`
    );
    if (mongoConnectionUri) {
      try {
        const client = await connectToMongo();
        console.log('MongoDB conectado');
        try {
          await ensureOctadeskIndexes(client);
          console.log('Índices Octadesk/N1 verificados');
        } catch (idxErr) {
          console.warn('Índices Octadesk/N1:', idxErr.message);
        }
        try {
          await ensureOctaSupervisaoIndexes(client);
          console.log('Índices octa_supervisao verificados');
        } catch (supIdxErr) {
          console.warn('Índices octa_supervisao:', supIdxErr.message);
        }
        registerOctaSupervisaoCron(connectToMongo);
        startOctadeskIngestLogTailConsole(client);
      } catch (err) {
        console.error('Erro ao conectar MongoDB:', err.message);
      }
    } else {
      console.warn('MONGO_ENV não definida - /api/stats e auth falharão até configurar');
    }
  });
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(
        `[backend] Porta ${PORT} já está em uso. Pare a outra instância (Ctrl+C no terminal onde o backend rodou) ou encerre o PID em LISTEN. ` +
          `PowerShell: Get-NetTCPConnection -LocalPort ${PORT} | Select-Object OwningProcess. ` +
          `Alternativa: defina PORT=5051 (ou outra) no ambiente antes de npm start.`
      );
      process.exit(1);
      return;
    }
    throw err;
  });
};

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, connectToMongo, PORT };
