/**
 * Painel Tempo Real - Servidor unificado (API + Frontend)
 * VERSION: v1.0.0
 * Serve API em /api/* e frontend React em /
 */

const path = require('path');
const express = require('express');
const { app, startServer } = require('./server');

// Frontend estático (build do React) - em ../build quando rodando do backend
const buildPath = path.join(__dirname, '..', 'build');
app.use(express.static(buildPath));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(buildPath, 'index.html'));
});

startServer();
