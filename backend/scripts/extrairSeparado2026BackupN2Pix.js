/**
 * Extrai do backup N2Pix apenas linhas com produto no grupo "Antecipação 2026"
 * (mesmo critério que FiltrosAuxiliar.PRODUTO_GRUPOS_PARA_API e relatorioAdministrativoN2Pix.bucketProdutoRelatorio).
 * VERSION: v1.0.0
 *
 * Uso (pasta backend):
 *   node scripts/extrairSeparado2026BackupN2Pix.js
 *
 * Opcional — arquivo painel específico:
 *   PAINEL_JSON=C:\caminho\reclamacoes_n2Pix_audit_xxx_painel.json node scripts/extrairSeparado2026BackupN2Pix.js
 *
 * Saída: backend/backups/separado 2026.json
 */

const fs = require('fs');
const path = require('path');
const { normalizeTextOctadesk } = require('../services/octadeskIngestService');

const API_PRODUTO_GRUPO_2026_EXATO = new Set(['Antecipação - 2026', 'Antecipação 2026']);

function produtoNoGrupoApiAntecipacao2026(produto) {
  if (produto == null || String(produto).trim() === '') return false;
  return API_PRODUTO_GRUPO_2026_EXATO.has(String(produto).trim());
}

function produtoEhGrupoApiOutrosAnos(produto) {
  if (produto == null || String(produto).trim() === '') return false;
  const s = String(produto).trim();
  if (s === 'Antecipação - Outros Anos' || s === 'Antecipacao' || s === 'Antecipação') return true;
  const n = normalizeTextOctadesk(s);
  return n === normalizeTextOctadesk('Antecipação - Outros Anos');
}

/** Igual backend/scripts/relatorioAdministrativoN2Pix.js bucketProdutoRelatorio — bucket final Antecipação - 2026. */
function produtoEhGrupoAntecipacao2026(produto) {
  if (produto == null || String(produto).trim() === '') return false;
  const s = String(produto).trim();
  if (produtoEhGrupoApiOutrosAnos(produto)) return false;
  if (produtoNoGrupoApiAntecipacao2026(produto)) return true;

  const lower = s.toLowerCase();
  if (lower === 'antecipação 2026') return true;
  const semDiac = s.normalize('NFD').replace(/\p{M}/gu, '');
  if (/^antecipacao\s+2026$/i.test(semDiac.trim())) return true;

  const n = normalizeTextOctadesk(s);
  for (const lit of ['Antecipação - 2026', 'Antecipação 2026']) {
    if (normalizeTextOctadesk(lit) === n) return true;
  }

  const compact = semDiac.toLowerCase().replace(/\s+/g, '');
  if (/\d/.test(s) && /2026/.test(s) && compact.includes('antecipacao')) return true;
  return false;
}

function encontrarPainelMaisRecente(backupsDir) {
  if (!fs.existsSync(backupsDir)) return null;
  const files = fs
    .readdirSync(backupsDir)
    .filter((f) => f.startsWith('reclamacoes_n2Pix_audit_') && f.endsWith('_painel.json'));
  if (files.length === 0) return null;
  let best = null;
  let bestM = -1;
  files.forEach((f) => {
    const p = path.join(backupsDir, f);
    const m = fs.statSync(p).mtimeMs;
    if (m > bestM) {
      bestM = m;
      best = p;
    }
  });
  return best;
}

function main() {
  const backupsDir = path.join(__dirname, '..', 'backups');
  const saidaPath = path.join(backupsDir, 'separado 2026.json');

  const painelPath =
    process.env.PAINEL_JSON && String(process.env.PAINEL_JSON).trim()
      ? path.resolve(String(process.env.PAINEL_JSON).trim())
      : encontrarPainelMaisRecente(backupsDir);

  if (!painelPath || !fs.existsSync(painelPath)) {
    console.error(
      '[extrairSeparado2026BackupN2Pix] Nenhum reclamacoes_n2Pix_audit_*_painel.json em backend/backups/. Rode backupAuditoriaReclamacoesN2Pix.js ou defina PAINEL_JSON.'
    );
    process.exit(1);
  }

  const raw = fs.readFileSync(painelPath, 'utf8');
  const payload = JSON.parse(raw);
  const linhas = Array.isArray(payload.linhas) ? payload.linhas : [];
  const filtradas = linhas.filter((row) => produtoEhGrupoAntecipacao2026(row.produto));

  const out = {
    meta: {
      script: 'extrairSeparado2026BackupN2Pix.js',
      scriptVersion: 'v1.0.0',
      geradoEm: new Date().toISOString(),
      criterioProduto2026:
        'Grupo Antecipação 2026 = FiltrosAuxiliar PRODUTO_GRUPOS_PARA_API [Antecipação - 2026, Antecipação 2026] + heurísticas relatorioAdministrativoN2Pix.bucketProdutoRelatorio (exclui Outros Anos antes).',
      arquivoOrigem: path.basename(painelPath),
      totalLinhasOrigem: linhas.length,
      totalLinhasGrupo2026: filtradas.length,
    },
    linhas: filtradas,
  };

  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  fs.writeFileSync(saidaPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`[extrairSeparado2026BackupN2Pix] Origem: ${painelPath}`);
  console.log(`[extrairSeparado2026BackupN2Pix] ${filtradas.length} / ${linhas.length} linhas → ${saidaPath}`);
}

main();
