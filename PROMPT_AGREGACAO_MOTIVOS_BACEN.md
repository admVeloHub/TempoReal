# Prompt: Correção da Agregação de Motivos na Aba Bacen

## Contexto do problema

Na tabela "Reclamações por Dia" da aba Bacen, as linhas estavam exibindo valores de **origem** (Bacen Celcoin, Bacen Via Capital, Consumidor.Gov) em vez de **motivoReduzido** (Abatimento Juros, Liberação Chave Pix, Chave Pix, etc.).

O schema define:
- `origem: String` – Natureza do canal (Bacen Celcoin, Bacen Via Capital, Consumidor.Gov)
- `motivoReduzido: String` – Motivo da reclamação (Abatimento Juros, Liberação Chave Pix, etc.)

A tabela deve usar **motivoReduzido** como critério de agregação, não origem.

## Solução implementada

### 1. Exclusão de valores de origem na agregação (backend)

No arquivo `backend/routes/stats.js`, foi criado um conjunto com os valores de origem e uma função para identificá-los:

```javascript
const ORIGEM_BACEN = new Set(['Bacen Celcoin', 'Bacen Via Capital', 'Consumidor.Gov']);

function isOrigemBacen(valor) {
  if (!valor || typeof valor !== 'string') return false;
  return ORIGEM_BACEN.has(valor.trim());
}
```

Na montagem de `motivosPorDiaMap`, ao processar cada documento da coleção Bacen, os valores de origem são ignorados:

```javascript
docsDoDia.forEach((d) => {
  const motivosArr = Array.isArray(d.motivoReduzido)
    ? d.motivoReduzido.filter((m) => m && String(m).trim())
    : d.motivoReduzido ? [String(d.motivoReduzido).trim()] : [];
  motivosArr.forEach((m) => {
    const motivo = String(m).trim();
    if (!motivo) return;
    if (tipo === 'bacen' && isOrigemBacen(motivo)) return; // origem ≠ motivo
    // ... resto da agregação
  });
});
```

Assim, mesmo que algum documento tenha origem salva em `motivoReduzido`, esses valores não entram na tabela.

### 2. Ajuste do filtro de motivo (Bacen usa String, não array)

No Bacen, `motivoReduzido` é `String`; em RA, Procon e N2 é `[String]`. O filtro de motivo usava `$elemMatch`, que só funciona para arrays.

Foi alterado para `$regex`, que funciona tanto para String quanto para array:

```javascript
// Antes (apenas arrays):
return { motivoReduzido: { $elemMatch: { $regex: escaped, $options: 'i' } } };

// Depois (String e array):
return { motivoReduzido: { $regex: escaped, $options: 'i' } };
```

### 3. Campos de data e agregação

- Contagem de dias: `dataEntrada` (campo de data do Bacen)
- Linhas da tabela: `motivoReduzido` (excluindo valores de origem)

## Referência de schema

Coleção: `hub_ouvidoria.reclamacoes_bacen`  
Campos relevantes: `dataEntrada`, `motivoReduzido`, `origem`
