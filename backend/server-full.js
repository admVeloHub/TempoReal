/**
 * Painel Tempo Real - Servidor unificado (API + Frontend)
 * VERSION: v1.0.1
 * Serve API em /api/* e frontend React em /
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const { app, startServer } = require('./server');

// Frontend estático - no container: /app/build (backend copiado para /app, build ao lado)
const buildPath = path.join(__dirname, 'build');
if (fs.existsSync(buildPath)) {
  app.use(express.static(buildPath));
  app.get('*', (req, res) => res.sendFile(path.join(buildPath, 'index.html')));
} else {
  app.get('/', (req, res) => res.status(503).send('Frontend build não encontrado'));
}

startServer();
