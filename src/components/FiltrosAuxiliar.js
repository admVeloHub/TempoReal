/**
 * Painel Reclamações Tempo Real - FiltrosAuxiliar
 * VERSION: v1.0.0
 *
 * Seção de filtros compartilhada: início, fim, produto, motivo, Atualizar.
 */

import React, { useState, useEffect, useRef } from 'react';

const PRODUTOS = [
  { label: 'Antecipação 2026', value: 'Antecipação 2026' },
  { label: 'Antecipação Outros Anos', value: 'Antecipacao' },
  { label: 'Aplicativo', value: 'Aplicativo' },
  { label: 'Conta Celcoin', value: 'Conta Celcoin' },
  { label: 'Cupom', value: 'Cupom' },
  { label: 'Empréstimo pessoal', value: 'Empréstimo pessoal' },
  { label: 'Seguros', value: 'Seguros' },
  { label: 'Crédito ao trabalhador', value: 'Crédito ao trabalhador' },
  { label: 'VeloPrime', value: 'VeloPrime' },
];

const MOTIVOS = [
  'Abatimento de juros',
  'Cancelamento',
  'Cobrança',
  'Encerramento de conta',
  'Erro',
  'Fraude',
  'Lgpd',
  'Liberação chave pix',
  'Superendividamento',
];

const baseSelectClass =
  'px-2 py-1.5 text-sm border rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 min-w-[160px]';

function MultiSelectDropdown({ options, selected, onChange, placeholder, getLabel = (v) => v }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, []);

  const toggle = (value) => {
    onChange(
      selected.includes(value) ? selected.filter((s) => s !== value) : [...selected, value]
    );
  };

  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? getLabel(selected[0])
        : `${selected.length} selecionados`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${baseSelectClass} text-left w-full flex items-center justify-between`}
      >
        <span className="truncate">{label}</span>
        <span className="ml-1">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto border rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 shadow-lg">
          {options.map((opt) => {
            const value = typeof opt === 'object' ? opt.value : opt;
            const isSelected = selected.includes(value);
            return (
              <div
                key={value}
                onClick={() => toggle(value)}
                className={`px-2 py-1.5 text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 ${isSelected ? 'bg-blue-200 dark:bg-blue-800/60' : ''}`}
              >
                {typeof opt === 'object' ? opt.label : opt}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { PRODUTOS, MOTIVOS, MultiSelectDropdown };

export default function FiltrosAuxiliar({
  dataInicio,
  setDataInicio,
  dataFim,
  setDataFim,
  produtos,
  setProdutos,
  motivos,
  setMotivos,
  onAtualizar,
  loading = false,
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <input
        type="date"
        value={dataInicio}
        onChange={(e) => setDataInicio(e.target.value)}
        className="px-2 py-1.5 text-sm border rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
        style={{ width: 'fit-content', minWidth: '130px' }}
      />
      <input
        type="date"
        value={dataFim}
        onChange={(e) => setDataFim(e.target.value)}
        className="px-2 py-1.5 text-sm border rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
        style={{ width: 'fit-content', minWidth: '130px' }}
      />
      <MultiSelectDropdown
        options={PRODUTOS}
        selected={produtos}
        onChange={setProdutos}
        placeholder="Produto"
        getLabel={(v) => PRODUTOS.find((p) => p.value === v)?.label || v}
      />
      <MultiSelectDropdown
        options={MOTIVOS}
        selected={motivos}
        onChange={setMotivos}
        placeholder="Motivo"
      />
      <button
        onClick={onAtualizar}
        disabled={loading}
        className="px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50"
        style={{ borderColor: '#1634FF', color: '#1634FF' }}
      >
        Atualizar
      </button>
    </div>
  );
}
