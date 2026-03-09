/**
 * Utilitários para manipulação de senhas
 * VERSION: v1.0.0
 * Copiado do root VeloHub - geração de senha padrão
 */

const removeAccents = (str) => {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
};

/**
 * Gera senha padrão no formato: nome.sobrenomeCPF
 */
const generateDefaultPassword = (colaboradorNome, cpf) => {
  if (!colaboradorNome) return '';
  const nomeSemAcentos = removeAccents(colaboradorNome).toLowerCase().trim();
  const partesNome = nomeSemAcentos.split(/\s+/).filter((p) => p.length > 0);
  if (partesNome.length === 0) return '';
  const primeiroNome = partesNome[0];
  const sobrenome =
    partesNome.length === 1
      ? primeiroNome
      : partesNome.length === 2
        ? partesNome[1]
        : partesNome[partesNome.length - 1];
  const cpfLimpo = cpf ? cpf.replace(/[.\s-]/g, '') : '';
  if (cpfLimpo && cpfLimpo.length >= 11) {
    return `${primeiroNome}.${sobrenome}${cpfLimpo}`;
  }
  return `${primeiroNome}.${sobrenome}`;
};

module.exports = { generateDefaultPassword };
