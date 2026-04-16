listagem de schema de coleções do mongoDB
  <!-- VERSION: v4.17.1 | DATE: 2026-04-16 | AUTHOR: VeloHub Development Team -->
  <!-- CHANGELOG: v4.17.1 - hub_ouvidoria.reclamacoes_timePortabilidade (Painel GET /api/stats porTipo.N1) -->
  <!-- CHANGELOG: v4.17.0 - Consolidação: base Painel v4.16.20 + academy_registros.quiz_conteudo + qualidade_avaliacoes.avaliacaoIA/somenteAnaliseAudioIA (root - Console v4.15.0) -->
  <!-- FONTE DA VERDADE - Versão única e definitiva -->
 
    🗄️ Database: console_conteudo
   
  //schema console_conteudo.Artigos
  {
  _id: ObjectId,
  tag: String,                    // Tag do artigo
  categoria_id: String,           // ID da categoria
  categoria_titulo: String,       // Título da categoria
  artigo_titulo: String,          // Título do artigo
  artigo_conteudo: String,        // Conteúdo do artigo (FORMATADO - ver FORMATAÇÃO_PADRÃO.md)
  media: Array,                    // Array de imagens/vídeos [{ url: String, data: String (base64), type: String, name: String }]
  createdAt: Date,                // Data de criação
  updatedAt: Date                 // Data de atualização
  }
  
  //schema console_conteudo.artigos_categorias (singleton: um único documento; API GET/PUT /api/artigos-categorias)
  {
  _id: ObjectId,
  Categorias: Array,              // [{ Ordem: Number, categoria_id: String (snake_case), categoria_titulo: String }, ...]
  createdAt: Date,
  updatedAt: Date
  }
  
  //schema console_conteudo.Bot_perguntas
  {
  _id: ObjectId,
  pergunta: String,               // Pergunta do bot
  resposta: String,               // Resposta do bot (FORMATADA - ver FORMATAÇÃO_PADRÃO.md)
  palavrasChave: String,          // Palavras-chave
  sinonimos: String,              // Sinônimos
  tabulacao: String,              // Tabulação
  media: Array,                   // Array de imagens/vídeos [{ url: String, data: String (base64), type: String, name: String }]
  createdAt: Date,                // Data de criação
  updatedAt: Date                 // Data de atualização
  }
  
  //schema console_conteudo.Velonews
  {
  _id: ObjectId,
  titulo: String,                 // Título da notícia
  conteudo: String,               // Conteúdo da notícia
  isCritical: Boolean,            // Se é notícia crítica
  solved: Boolean,                // Se a notícia foi resolvida (default: false)
  images: Array,                   // Array de imagens [{ url: String, data: String (base64), type: String, name: String }]
  videos: Array,                   // Array de vídeos [{ youtubeId: String (opcional), url: String, embedUrl: String (opcional), data: String (base64 - opcional), type: String, name: String }]
  media: Array,                    // Array de imagens/vídeos com caminhos relativos do GCS [{ url: String, type: String, name: String }]
  // PADRÃO DE NOMENCLATURA: camelCase para campos técnicos (images, videos, url, data, type, name, youtubeId, embedUrl)
  // snake_case para campos de conteúdo em português (artigo_titulo, categoria_titulo)
  // VÍDEOS: Preferir YouTube (youtubeId, embedUrl) ao invés de base64 para melhor performance
  createdAt: Date,                // Data de criação
  updatedAt: Date                 // Data de atualização
  }
      
  //schema console_conteudo.user_activity
  {
  _id: ObjectId,
  colaboradorNome: String,           // Nome do colaborador
  action: String,                    // Tipo de ação (question_asked, feedback_given, article_viewed, ai_button_used)
  details: {                         // Detalhes específicos da ação
    question: String,                // Pergunta feita (para question_asked)
    feedbackType: String,            // Tipo de feedback (positive/negative)
    messageId: String,               // ID da mensagem (para feedback)
    articleId: String,               // ID do artigo (para article_viewed)
    articleTitle: String,            // Título do artigo
    formatType: String               // Tipo de formatação (whatsapp/email)
  },
  sessionId: String,                 // ID da sessão
  source: String,                    // Fonte da ação (chatbot, ai_button, etc.)
  createdAt: Date,                   // Data de criação
  updatedAt: Date                    // Data de atualização
  }
  
  //schema console_conteudo.hub_sessions
  {
  _id: ObjectId,
  colaboradorNome: String,           // Nome do colaborador
  userEmail: String,                 // Email do usuário
  sessionId: String,                 // ID único da sessão (UUID)
  ipAddress: String,                 // IP do usuário (opcional)
  userAgent: String,                 // Navegador/dispositivo (opcional)
  isActive: Boolean,                 // Se a sessão está ativa
  loginTimestamp: Date,              // Data/hora do login
  logoutTimestamp: Date,             // Data/hora do logout (null se ativo)
  createdAt: Date,                   // Data de criação
  updatedAt: Date                    // Data de atualização
  }
  
  //schema console_conteudo.velonews_acknowledgments
  {
  _id: ObjectId,
  newsId: ObjectId,              // Referência à notícia (Velonews._id)
  colaboradorNome: String,       // Nome do colaborador que confirmou
  userEmail: String,             // Email do usuário
  acknowledgedAt: Date,          // Data/hora da confirmação
  createdAt: Date,               // Data de criação
  updatedAt: Date                // Data de atualização
  }
  
  //schema console_conteudo.bot_feedback
  {
  _id: ObjectId,
  colaboradorNome: String,           // Nome do colaborador que deu o feedback
  action: String,                    // Tipo de ação (feedback_given)
  messageId: String,                 // ID da mensagem que recebeu o feedback
  sessionId: String,                 // ID da sessão
  source: String,                    // Fonte da resposta (chatbot, ai_button, clarification, etc.)
  resolvido: Boolean,                // Se o feedback foi resolvido
  details: {                         // Detalhes específicos do feedback
    feedbackType: String,            // Tipo de feedback (positive/negative)
    comment: String,                 // Comentário opcional do usuário
    question: String,                // Pergunta original que gerou a resposta
    answer: String,                  // Resposta do bot que recebeu o feedback
    aiProvider: String,              // Provedor da IA (OpenAI, Gemini, null)
    responseSource: String           // Origem da resposta (bot_perguntas, ai, clarification, etc.)
  },
  createdAt: Date,                   // Data de criação
  updatedAt: Date                    // Data de atualização
  }
  

  🗄️ Database: console_chamados
  
    // schema DB console_chamados.tk_gestão
  // Tickets de gestão, RH e financeiro, facilities
  {
  _id: String,                    // ID personalizado com prefixo TKG- + numeração automática (ex: TKG-000001)
  _userEmail: String,             // Email do usuário (obtido via SSO) - MOVIDO para 2ª posição
  _genero: String,                // Gênero do ticket (Gestão, RH e Financeiro, Facilities)
  _tipo: String,                  // Tipo do ticket (solicitação, agendamento, notificação, etc.)
  _direcionamento: String,        // Direcionamento (supervisor, gestor, backoffice, RH, Financeiro, etc.)
  _corpo: [                       // Array de mensagens do ticket (ALTERADO de String para Array)
    {
      autor: String,              // "user" | "admin"
      userName: String,           // Nome obtido do SSO
      timestamp: Date,            // Data/hora da mensagem
      mensagem: String            // Conteúdo da mensagem
    }
  ],
  _atribuido: string,             // Atribuído a (opcional)
  _processo: string,              // Processo (opcional)
  _processamento: String,         // Processamento (aprovação do gestor, consulta viabilidade, processamento) - OPCIONAL
  _statusHub: String,             // Status para usuário (novo, aberto, em espera pendente, resolvido)
  _statusConsole: String,         // Status para gestor (novo, aberto, em espera, pendente, resolvido)
  _lastUpdatedBy: String,         // Quem atualizou por último (user, admin)
  createdAt: Date,                // Data de criação
  updatedAt: Date                 // Data de atualização
  }
  

  // schema DB console_chamados.tk_conteudos
  // Tickets de conteúdo (artigos, processos, roteiros, treinamentos, funcionalidades, recursos)
  {
  _id: String,                    // ID personalizado com prefixo TKC- + numeração automática (ex: TKC-000001)
  _userEmail: String,             // Email do usuário (obtido via SSO) - MOVIDO para 2ª posição
  _assunto: String,                // Assunto do ticket
  _genero: String,                // Gênero do ticket (Artigo, Processo, Roteiro, Treinamento, Funcionalidade, Recurso Adicional, Velobot)
  _tipo: String,                  // Tipo do ticket (assunto, produto, ambiente, tipo_recurso, etc.)
  _corpo: [                       // Array de mensagens do ticket (ALTERADO de String para Array)
    {
      autor: String,              // "user" | "admin"
      userName: String,           // Nome obtido do SSO
      timestamp: Date,            // Data/hora da mensagem
      mensagem: String            // Conteúdo da mensagem
    }
  ],
  _obs: String,                   // Observações (opcional)
  _atribuido: string,             // Atribuído a (opcional)
  _processo: string,              // Processo (opcional)
  _processamento: String,         // Processamento (aprovação do gestor, consulta viabilidade, processamento) - OPCIONAL
  _statusHub: String,             // Status para usuário (novo, aberto, em espera pendente, resolvido)
  _statusConsole: String,         // Status para gestor (novo, aberto, em espera, pendente, resolvido)
  _lastUpdatedBy: String,         // Quem atualizou por último (user, admin)
  createdAt: Date,                // Data de criação
  updatedAt: Date                 // Data de atualização
  }
  
  // ===== MAPEAMENTO DE FORMULÁRIOS PARA SCHEMAS =====
  
  // FORMULÁRIOS TK_CONTEUDOS (7 Gêneros):
  // 1. Artigo: assunto → _assunto, tipo → _tipo, descrição → _corpo, ocorrência → _obs
  // 2. Processo: assunto → _assunto, tipo → _tipo, descrição → _corpo, ocorrência → _obs
  // 3. Roteiro: assunto → _assunto, tipo → _tipo, descrição → _corpo, ocorrência → _obs
  // 4. Treinamento: assunto → _assunto, tipo → _tipo, descrição → _corpo, ocorrência → _obs
  // 5. Funcionalidade: assunto → _assunto, tipo → _tipo, descrição → _corpo, ocorrência → _obs
  // 6. Recurso Adicional: assunto → _assunto, tipo → _tipo, descrição → _corpo, ocorrência → _obs
  // 7. Velobot: assunto → _assunto, tipo → _tipo, descrição → _corpo, ocorrência → _obs
  
  // FORMULÁRIOS TK_GESTÃO (3 Gêneros):
  // 1. Gestão: tipo → _tipo, direcionado → _direcionamento, mensagem → _corpo
  // 2. RH e Financeiro: tipo → _tipo, setor → _direcionamento, mensagem → _corpo
  // 3. Facilities: tipo → _tipo, categoria → _direcionamento, mensagem → _corpo
  
  
  
  🗄️ Database: console_config
  
  // Schema Config
  {
  _id: ObjectId,
  _userMail: String,              // Email do usuário
  _userId: String,                // ID do usuário
  _userRole: String,              // Papel do usuário
  _userClearance: {               // Permissões do usuário
    artigos: Boolean,
    velonews: Boolean,
    botPerguntas: Boolean,
    botAnalises: Boolean,         // Permissão para Bot Análises
    chamadosInternos: Boolean,
    igp: Boolean,
    qualidade: Boolean,
    capacity: Boolean,
    config: Boolean,
    servicos: Boolean,
    academy: Boolean              // Permissão para Academy
  },
  _userTickets: {                 // Tipos de tickets
    artigos: Boolean,
    processos: Boolean,
    roteiros: Boolean,
    treinamentos: Boolean,
    funcionalidades: Boolean,
    recursos: Boolean,
    gestao: Boolean,
    rhFin: Boolean,
    facilities: Boolean
  },
  _funcoesAdministrativas: {      // Funções administrativas
    avaliador: Boolean,           // Se é avaliador no módulo Qualidade
    auditoria: Boolean,           // Se tem permissão para auditoria
    relatoriosGestao: Boolean     // Se tem permissão para relatórios de gestão
  },
  createdAt: Date,                // Data de criação
  updatedAt: Date                 // Data de atualização
  }
  
   //schema console_config.module_status
  {
  _id: ObjectId,
  _pessoal: String,
  _antecipacao: String,
  _pgtoAntecip: String,
  _seguroCred: String,
  _seguroCel: String,
  _perdaRenda: String,
  _cupons: String,
  _seguroPessoal: String,
  createdAt: Date,
  updatedAt: Date
  }
  
  
  //🗄️ Schema de Ping de Usuário
  // de login ou refresh
  {
  _userId: String,                // ID do usuário
  _collectionId: String,          // ID da collection
  createdAt: Date,                // Data de criação
  updatedAt: Date                 // Data de atualização
  }
  
  🗄️ Database console_analises
  
  //schema console_analises.qualidade_avaliacoes
  {
  _id: ObjectId,
  colaboradorNome: String,        // Nome do colaborador
  avaliador: String,              // Avaliador
  mes: String,                    // Mês da avaliação
  ano: Number,                    // Ano da avaliação
  saudacaoAdequada: Boolean,      // Critério de avaliação
  escutaAtiva: Boolean,           // Critério de avaliação
  clarezaObjetividade: Boolean,   // Critério de avaliação
  resolucaoQuestao: Boolean,      // Critério de avaliação
  dominioAssunto: Boolean,        // Critério de avaliação
  empatiaCordialidade: Boolean,   // Critério de avaliação
  direcionouPesquisa: Boolean,    // Critério de avaliação
  procedimentoIncorreto: Boolean, // Critério de avaliação
  encerramentoBrusco: Boolean,    // Critério de avaliação
  pontuacaoTotal: Number,         // Pontuação total
  avaliacaoIA: Number,            // Nota IA espelhada de audio_analise_results ao concluir análise (só worker/backend)
  somenteAnaliseAudioIA: Boolean, // true = fluxo lote/só áudio; manual do supervisor ainda não aplicado
  observacoes: String,            // Observações da avaliação
  dataLigacao: Date,              // Data da ligação
  nomeArquivoAudio: String,       // Nome do arquivo de áudio
  audioSent: Boolean,             // Áudio enviado para análise
  audioTreated: Boolean,          // Áudio processado pela IA
  audioCreatedAt: Date,           // Data de criação do registro de áudio
  audioUpdatedAt: Date,           // Data de atualização do registro de áudio
  createdAt: Date,                // Data de criação
  updatedAt: Date                 // Data de atualização
  }

  //schema console_analises.qualidade_funcionarios
  {
  _id: ObjectId,
  colaboradorNome: String,        // Nome completo (padronizado)
  dataAniversario: Date,          // Data de aniversário
  empresa: String,                // Empresa
  dataContratado: Date,           // Data de contratação
  telefone: String,               // Telefone
  userMail: String,               // Email do usuário (para autenticação SSO)
  atuacao: [ObjectId],            // Array de referências para qualidade_funcoes
  escala: String,                 // Escala
  acessos: {                      // Objeto com acessos aos módulos (API/validação: QualidadeFuncionario)
    Velohub: Boolean,             // Acesso ao VeloHub (pré-requisito para outros módulos)
    Console: Boolean,             // Acesso ao Console de conteúdo
    Ouvidoria: Boolean,           // Acesso ao módulo Ouvidoria (requer Velohub === true)
    Sociais: Boolean,             // Acesso ao módulo Sociais (requer Velohub === true)
    Academy: Boolean,             // Acesso ao Academy
    Desk: Boolean,                // Acesso ao Desk
    realTime: Boolean,            // Acesso ao módulo Tempo Real (rótulo no produto: “Tempo Real”; mesmo campo nas rotas POST/PUT /api/qualidade/funcionarios)
    apoioN1: Boolean              // Credencial Apoio N1 (rótulo no produto: “Apoio N1”; POST/PUT /api/qualidade/funcionarios; formato legado array: sistema normalizado “apoion1”)
  },
  desligado: Boolean,             // Se foi desligado
  dataDesligamento: Date,         // Data de desligamento
  afastado: Boolean,              // Se está afastado
  dataAfastamento: Date,          // Data de afastamento
  idSecao: String,                // ID da seção do agente (para filtros)
  createdAt: Date,                // Data de criação
  updatedAt: Date                 // Data de atualização
  }
  
  //schema console_analises.qualidade_avaliacoes_gpt
  {
  _id: ObjectId,
  avaliacao_id: ObjectId,         // Referência à avaliação original (padronizado)
  analiseGPT: String,             // Análise completa do GPT
  pontuacaoGPT: Number,           // Pontuação calculada pelo GPT (0-100)
  criteriosGPT: {                 // Critérios avaliados pelo GPT
    saudacaoAdequada: Boolean,
    escutaAtiva: Boolean,
    clarezaObjetividade: Boolean,
    resolucaoQuestao: Boolean,
    dominioAssunto: Boolean,
    empatiaCordialidade: Boolean,
    direcionouPesquisa: Boolean,
    procedimentoIncorreto: Boolean,
    encerramentoBrusco: Boolean
  },
  confianca: Number,              // Nível de confiança (0-100)
  palavrasCriticas: [String],     // Palavras-chave críticas mencionadas
  calculoDetalhado: [String],     // Explicação do cálculo da pontuação
  createdAt: Date,                // Data de criação
  updatedAt: Date                 // Data de atualização (padronizado)
  }
  
  //schema console_analises.qualidade_funcoes
  {
  _id: ObjectId,
  funcao: String,              // Nome da função (ex: "Atendimento", "Suporte Técnico")
  descricao: String,           // Descrição opcional da função
  createdAt: Date,             // Data de criação
  updatedAt: Date              // Data de atualização
  }
  
  //schema console_analises.faq_bot
  {
  _id: "faq",                      // ID fixo para identificação no backend
  dados: [String],                 // Array com as 10 perguntas mais feitas (apenas os textos)
  totalPerguntas: Number,          // Total de perguntas no período
  updatedAt: Date                  // Data de atualização (controle de versionamento)
  }
  
  //schema console_analises.audio_analise_status
  {
  _id: ObjectId,
  avaliacao_id: ObjectId,          // Referência à avaliação (qualidade_avaliacoes._id)
  nomeArquivoAudio: String,        // Nome do arquivo de áudio
  status: String,                  // Status: "pendente", "processando", "concluido", "erro"
  audioSent: Boolean,              // Áudio enviado para análise
  audioTreated: Boolean,           // Áudio processado pela IA
  erro: String,                    // Mensagem de erro (se houver)
  createdAt: Date,                 // Data de criação
  updatedAt: Date                  // Data de atualização
  }
  
  //schema console_analises.audio_analise_results
  {
  _id: ObjectId,
  avaliacao_id: ObjectId,          // Referência à avaliação (qualidade_avaliacoes._id)
  nomeArquivoAudio: String,        // Nome do arquivo de áudio
  analiseCompleta: String,         // Análise completa do áudio pela IA
  pontuacaoCalculada: Number,      // Pontuação calculada (0-100)
  criteriosDetalhados: {           // Critérios detalhados
    saudacaoAdequada: Boolean,
    escutaAtiva: Boolean,
    clarezaObjetividade: Boolean,
    resolucaoQuestao: Boolean,
    dominioAssunto: Boolean,
    empatiaCordialidade: Boolean,
    direcionouPesquisa: Boolean,
    procedimentoIncorreto: Boolean,
    encerramentoBrusco: Boolean
  },
  palavrasChave: [String],         // Palavras-chave identificadas
  timestampInicio: Date,           // Timestamp de início da análise
  timestampFim: Date,              // Timestamp de fim da análise
  createdAt: Date,                  // Data de criação
  updatedAt: Date                   // Data de atualização
  }
  
  🗄️ Database: academy_registros
  
  //schema academy_registros.course_progress
  {
  _id: ObjectId,                    // Gerado automaticamente pelo MongoDB
  userEmail: String,                 // Email do usuário (obrigatório)
  subtitle: String,                 // Subtítulo da seção (ex: "Seguro Prestamista") (obrigatório)
  completedVideos: {                 // Objeto com progresso de cada aula do subtítulo
    "Aula em vídeo": Boolean,        // true quando todos os vídeos da sequência forem assistidos
    "Ebook - Seguro Prestamista": Boolean,  // true quando clicado pela primeira vez
    // ... outras aulas do subtítulo (chave = título da aula, valor = Boolean)
  },
  quizUnlocked: Boolean,             // true quando todas as aulas do subtítulo estiverem completas (todos valores em completedVideos == true)
  completedAt: Date,                 // Data de conclusão do subtítulo (quando todas as aulas foram completadas)
  createdAt: Date,                   // Data de criação do registro
  updatedAt: Date                    // Data da última atualização
  }
  
  // Chave única (índice composto): userEmail + subtitle
  // Permite múltiplos registros por usuário (um por subtítulo)

  //schema academy_registros.quiz_conteudo
  // Um documento por quiz; quizID deve coincidir com quizId em cursos_conteudo (obrigatoriamente igual ao temaNome da seção em snake_case). Em cada item de questões, opção1 é a correta.
  {
  _id: ObjectId,
  quizID: String,              // = temaNome da seção em snake_case (ex.: "Seja Bem Vindo" → seja_bem_vindo)
  questões: [
    {
      pergunta: String,      // enunciado
      opção1: String,        // opção correta (convenção)
      opção2: String,
      opção3: String,        // vazio em V/F (só opção1–2); pode ter texto com opção4 vazia (3 alternativas)
      opção4: String         // vazio em V/F ou em pergunta de 3 alternativas
    }
  ],
  notaCorte: Number,         // mínimo de acertos (inteiro), 0 .. questões.length
  createdAt: Date,
  updatedAt: Date
  }
  // Índice: { quizID: 1 } unique (recomendado; fallback não-unique se existirem duplicados legados)


  //schema academy_registros.cursos_conteudo
  // Estrutura normalizada (4 coleções: cursos, modulos, secoes, aulas)
  {
  _id: ObjectId,
  cursoClasse: String,          // "Essencial", "Atualização", "Opcional", "Reciclagem"
  cursoNome: String,            // "onboarding", "produtos", etc
  courseOrder: Number,          // Ordem de exibição
  isActive: Boolean,            // Ativar/desativar curso
  modules: [
    {
      moduleId: String,        // "modulo-1", "modulo-2"
      moduleNome: String,       // "Módulo 1: Treinamentos Essenciais"
      isActive: Boolean,
      sections: [              // Tema/Subtítulo
        {
          temaNome: String,     // "Seja Bem Vindo"
          temaOrder: Number,
          isActive: Boolean,
          hasQuiz: Boolean,     // Se tem quiz associado
          quizId: String,       // Obrigatoriamente = temaNome desta seção em snake_case (mesmo valor que quizID em quiz_conteudo)
          lessons: [
            {
              lessonId: String,      // "l1-1"
              lessonTipo: String,    // "video", "pdf", "audio", "slide", "document"
              lessonTitulo: String,  // "Bem vindo ao VeloAcademy"
              lessonOrdem: Number,
              isActive: Boolean,
              lessonContent: [       // ARRAY de objetos com url
                {
                  url: String        // YouTube, Google Drive PDF, Google Slides, Google Drive Audio, Outros documentos
                }
              ],
              driveId: String,       // ID do Google Drive (se aplicável)
              youtubeId: String,     // ID do YouTube (se aplicável)
            }
          ]
        }
      ]
    }
  ],
  createdAt: Date,
  updatedAt: Date,
  createdBy: String,           // Email do criador
  version: Number              // Controle de versão
  }
  
  🗄️ Database: hub_escalacoes
  
  //schema hub_escalacoes.solicitacoes_tecnicas
  // Módulo Req_Prod (Requisições de Produto) - sem integração WhatsApp
  // Status do chamado: derivado do último elemento de reply[].status
  // Na criação: reply inicia com [{ status: "enviado", msgProdutos: null, msgN1: null, at }]
  // Produtos responde: msgProdutos preenchido, msgN1 null | N1 responde: msgN1 preenchido, msgProdutos null
  {
  _id: ObjectId,
  colaboradorNome: String,          // Nome do colaborador (agente)
  cpf: String,                      // CPF (11 dígitos, sem formatação)
  tipo: String,                     // Tipo de solicitação
  payload: {                        // Objeto com dados adicionais
    agente: String,
    cpf: String,
    tipo: String,
    imagens: [{ nome: String, imagemUrl: String }],   // nome do arquivo, URL de download no GCS
    videos: [{ nome: String, videoUrl: String }]      // nome do arquivo, URL de download no GCS
  },
  reply: [{
    status: String,                 // "enviado" | "feito" | "não feito" | "Cancelado"
    msgProdutos: String | null,     // Time Produtos: texto da resposta; null se vazio / cancelamento / quando quem falou foi só o N1
    msgN1: String | null,           // N1: texto; null se vazio / cancelamento / quando quem falou foi só Produtos
    at: Date                        // Data/hora do envio daquele item (Produtos ou N1, conforme o campo preenchido)
  }],
  createdAt: Date,
  updatedAt: Date
  }
  
  //schema hub_escalacoes.erros_bugs
  // Erros e bugs do módulo Req_Prod - sem integração WhatsApp
  // Status do chamado: derivado do último elemento de reply[].status
  // Na criação: reply inicia com [{ status: "enviado", msgProdutos: null, msgN1: null, at }]
  // Produtos responde: msgProdutos preenchido, msgN1 null, at = data/hora do envio | N1: msgN1 preenchido, msgProdutos null
  {
  _id: ObjectId,
  colaboradorNome: String,
  cpf: String,
  tipo: String,                     // Ex: "Erro/Bug - ..."
  payload: {
    agente: String,
    cpf: String,
    tipo: String,                   // Tipo sem prefixo
    descricao: String,
    marca: String,
    modelo: String,
    imagens: [{ nome: String, imagemUrl: String }],   // nome do arquivo, URL de download no GCS
    videos: [{ nome: String, videoUrl: String }],     // nome do arquivo, URL de download no GCS
    exclusao: Object | undefined    // Exclusão de Conta: excluirVelotax, excluirCelcoin, etc.
  },
  reply: [{
    status: String,                 // "enviado" | "feito" | "não feito" | "Cancelado"
    msgProdutos: String | null,     // Time Produtos: texto da resposta; null se vazio / cancelamento / quando quem falou foi só o N1
    msgN1: String | null,           // N1: texto; null se vazio / cancelamento / quando quem falou foi só Produtos
    at: Date                        // Data/hora do envio daquele item (Produtos ou N1, conforme o campo preenchido)
  }],
  createdAt: Date,
  updatedAt: Date
  }
  
  🗄️ Database: console_sociais
  
  //schema console_sociais.sociais_metricas
  // Tabulações de redes sociais (módulo Sociais)
  {
  _id: ObjectId,
  clientName: String,               // Nome ou username do cliente
  socialNetwork: String,            // Enum: 'WhatsApp', 'Instagram', 'Facebook', 'TikTok', 'Messenger', 'YouTube', 'PlayStore'
  messageText: String,              // O texto da mensagem/atendimento
  rating: Integer,                  // Classificação de 1 a 5 estrelas (Obrigatório se PlayStore)
  contactReason: String,            // Enum: 'Produto', 'Suporte', 'Bug', 'Elogio', 'Reclamação', 'Oculto', 'Outro'
  sentiment: String,                // Enum: 'Positivo', 'Negativo', 'Neutro'
  directedCenter: Boolean,          // true se foi direcionado para a central, false se não
  link: String,                     // URL ou link do atendimento (opcional)
  createdAt: Date,                  // Data de criação
  updatedAt: Date                   // Data de atualização
  }
  
  // Índices MongoDB recomendados:
  // - socialNetwork: 1
  // - createdAt: -1
  // - sentiment: 1
  // - contactReason: 1
  
  🗄️ Database: hub_ouvidoria
  
  // NOTA IMPORTANTE (2026-03-02):
  // motivoReduzido foi padronizado como [String] em TODAS as collections de ouvidoria
  // Todas as collections (BACEN, N2 Pix, Reclame Aqui, Procon, Ação Judicial) agora usam array
  // para permitir seleção múltipla de motivos no formulário (conforme funcionalidade implementada)
  // Migração executada: 2371 documentos migrados de String para [String]
  
  //schema hub_ouvidoria.reclamacoes_bacen
  {
  _id: ObjectId,                    // ID gerado automaticamente pelo MongoDB
  nome: String,                     // Nome do cliente
  cpf: String,                      // CPF (11 dígitos, apenas números)
  telefones: {                      // Objeto com lista de telefones
    lista: [String]                 // Array de números de telefone formatados
  },
  email: String,                    // E-mail do cliente (opcional)
  observacoes: String,              // Observações gerais (opcional)
  responsavel: String,              // Nome do responsável pela reclamação
  dataEntrada: Date,                // Data de entrada da reclamação
  origem: String,                   // Natureza: "Bacen Celcoin", "Bacen Via Capital", "Consumidor.Gov"
  produto: String,                   // Produto relacionado (opcional)
  anexos: [String],                 // Array de URLs dos anexos no Cloud Storage (mediabank_velohub/anexos_ouvidoria/bacen)
  prazoBacen: Date,                 // Prazo BACEN — preenchido apenas na API: createdAt + 2 dias corridos (UTC); não editável no formulário
  motivoReduzido: [String],         // Motivo reduzido (array de motivos selecionados - múltipla escolha)
  motivoDetalhado: String,          // Descrição detalhada da reclamação
  tentativasContato: {              // Objeto com lista de tentativas de contato
    lista: [{
      data: Date,                   // Data da tentativa
      meio: String,                 // Meio de contato: "Telefone", "Whatsapp", "Email"
      resultado: String             // Resultado do contato
    }]
  },
  acionouCentral: Boolean,          // Se acionou Central de Ajuda
  protocolosCentral: [String],      // Array de protocolos da Central de Ajuda
  n2SegundoNivel: Boolean,          // Se foi escalado para Ouvidoria
  protocolosN2: [String],           // Array de protocolos N2/Ouvidoria
  reclameAqui: Boolean,             // Se acionou Reclame Aqui
  protocolosReclameAqui: [String],  // Array de protocolos Reclame Aqui
  procon: Boolean,                  // Se acionou Procon
  protocolosProcon: [String],       // Array de protocolos Procon
  semRespostaCliente: Boolean,      // Sem resposta do cliente (Canais de atendimento e protocolos acionados)
  pixLiberado: Boolean,             // PIX liberado (true = Liberado/Excluído/Solicitada; false = Não aplicável/vazio)
  statusContratoQuitado: Boolean,   // Se contrato está quitado
  statusContratoAberto: Boolean,    // Se contrato está em aberto
  enviarParaCobranca: Boolean,      // Se deve enviar para cobrança
  Finalizado: {                     // Objeto de finalização (opcional)
    Resolvido: Boolean,             // Se a reclamação foi resolvida (se vazio/null = em andamento)
    dataResolucao: Date             // Timestamp da resolução (preenchido quando Resolvido = true)
  },
  createdAt: Date,                  // Data de criação
  updatedAt: Date                   // Data de atualização
  }
  
  // Índices MongoDB:
  // - cpf: 1 (índice simples para buscas por CPF)
  // - telefones.lista: 1 (índice para buscas em telefones)
  // - email: 1 (índice esparso para buscas por email)
  // - createdAt: -1 (índice para ordenação)
  
  //schema hub_ouvidoria.reclamacoes_n2Pix  
  {
  _id: ObjectId,                    // ID gerado automaticamente pelo MongoDB
  nome: String,                     // Nome do cliente
  cpf: String,                      // CPF (11 dígitos, apenas números)
  telefones: {                      // Objeto com lista de telefones
    lista: [String]                 // Array de números de telefone formatados
  },
  email: String,                    // E-mail do cliente (opcional)
  observacoes: String,              // Observações gerais (opcional)
  responsavel: String,              // Nome do responsável pela reclamação
  dataEntradaN2: Date,              // Data entrada N2
  motivoReduzido: [String],         // Motivo reduzido (array de motivos selecionados - múltipla escolha)
  origem: String,                   // Origem: "Telefone", "Ticket", "Chatbot" (opcional)
  produto: String,                  // Produto relacionado (opcional)
  prazoOuvidoria: Date,             // Prazo N2/Ouvidoria — preenchido apenas na API: createdAt + 2 dias corridos (UTC); não editável no formulário
  motivoDetalhado: String,          // Descrição detalhada (opcional)
  anexos: [String],                 // Array de URLs dos anexos no Cloud Storage (mediabank_velohub/anexos_ouvidoria/ouvidoria)
  tentativasContato: {              // Objeto com lista de tentativas de contato
    lista: [{
      data: Date,                   // Data da tentativa
      meio: String,                 // Meio de contato: "Telefone", "Whatsapp", "Email"
      resultado: String             // Resultado do contato
    }]
  },
  acionouCentral: Boolean,          // Se acionou Central de Ajuda
  protocolosCentral: [String],      // Array de protocolos da Central de Ajuda
  protocolosN2: [String],           // Array de protocolos N2/Ouvidoria
  bacen: Boolean,                  // Se acionou Bacen
  protocolosBacen: [String],       // Array de protocolos Bacen
  reclameAqui: Boolean,             // Se acionou Reclame Aqui
  protocolosReclameAqui: [String],  // Array de protocolos Reclame Aqui
  procon: Boolean,                  // Se acionou Procon
  protocolosProcon: [String],       // Array de protocolos Procon
  semRespostaCliente: Boolean,      // Sem resposta do cliente (Canais de atendimento e protocolos acionados)
  pixLiberado: Boolean,             // PIX liberado (true = Liberado/Excluído/Solicitada; false = Não aplicável/vazio)
  statusContratoQuitado: Boolean,   // Se contrato está quitado
  enviarParaCobranca: Boolean,      // Se deve enviar para cobrança
  Finalizado: {                     // Objeto de finalização (opcional)
    Resolvido: Boolean,             // Se a reclamação foi resolvida (se vazio/null = em andamento)
    dataResolucao: Date             // Timestamp da resolução (preenchido quando Resolvido = true)
  },
  createdAt: Date,                  // Data de criação
  updatedAt: Date                   // Data de atualização
  }
  
  // Índices MongoDB:
  // - cpf: 1 (índice simples para buscas por CPF)
  // - telefones.lista: 1 (índice para buscas em telefones)
  // - email: 1 (índice esparso para buscas por email)
  // - createdAt: -1 (índice para ordenação)
  
  //schema hub_ouvidoria.reclamacoes_reclameAqui  
  {
  _id: ObjectId,                    // ID gerado automaticamente pelo MongoDB
  nome: String,                     // Nome do cliente
  cpf: String,                      // CPF (11 dígitos, apenas números)
  telefones: {                      // Objeto com lista de telefones
    lista: [String]                 // Array de números de telefone formatados
  },
  email: String,                    // E-mail do cliente (opcional)
  observacoes: String,              // Observações gerais (opcional)
  responsavel: String,              // Nome do responsável pela reclamação
  
  cpfRepetido: String,              // CPF Repetido (campo digitável para valores numéricos) (L1C4)
  idEntrada: String,                // ID Entrada (campo digitável, 9 dígitos numéricos) (L1C1)
  dataReclam: Date,                 // Data Reclamação (L1C3)
  produto: String,                  // Produto relacionado 
  motivoReduzido: [String],         // Motivo reduzido (array de motivos selecionados - múltipla escolha) (L2C1)
  motivoDetalhado: String,          // Descrição detalhada (opcional)
  passivelNotaMais: Boolean,        // Passível de nota + (campo booleano)
  pixLiberado: Boolean,             // PIX liberado (true = Liberado/Excluído/Solicitada; false = Não aplicável/vazio)
  statusContratoQuitado: Boolean,   // Se contrato está quitado
  statusContratoAberto: Boolean,    // Se contrato está em aberto
  enviarParaCobranca: Boolean,      // Se deve enviar para cobrança
  anexos: [String],                 // Array de URLs dos anexos no Cloud Storage (mediabank_velohub/anexos_ouvidoria/reclame_aqui)
  solicitadoAvaliacao: Boolean,     // Solicitado Avaliação (boolean, abaixo do Descrição)
  avaliado: Boolean,                // Avaliado (boolean, abaixo do Descrição, à direita do Solicitado Avaliação)
  
  acionouCentral: Boolean,          // Se acionou Central de Ajuda
  protocolosCentral: [String],      // Array de protocolos da Central de Ajuda
  n2SegundoNivel: Boolean,          // Se foi escalado para Ouvidoria
  protocolosN2: [String],           // Array de protocolos N2/Ouvidoria
  bacen: Boolean,                  // Se acionou Bacen
  protocolosBacen: [String],       // Array de protocolos Bacen
  protocolosReclameAqui: [String],  // Array de protocolos Reclame Aqui
  procon: Boolean,                  // Se acionou Procon
  protocolosProcon: [String],       // Array de protocolos Procon
  semRespostaCliente: Boolean,      // Sem resposta do cliente (Canais de atendimento e protocolos acionados)
  Finalizado: {                     // Objeto de finalização (opcional)
    Resolvido: Boolean,             // Se a reclamação foi resolvida (se vazio/null = em andamento)
    dataResolucao: Date             // Timestamp da resolução (preenchido quando Resolvido = true)
  },
  createdAt: Date,                  // Data de criação (usado como Início tratativa)
  updatedAt: Date                   // Data de atualização
  }
  
  // Índices MongoDB:
  // - cpf: 1 (índice simples para buscas por CPF)
  // - cpfRepetido: 1 (índice para buscas por CPF repetido)
  // - idEntrada: 1 (índice único para buscas por ID Entrada)
  // - telefones.lista: 1 (índice para buscas em telefones)
  // - email: 1 (índice esparso para buscas por email)
  // - createdAt: -1 (índice para ordenação)
  
  //schema hub_ouvidoria.reclamacoes_procon  
  {
  _id: ObjectId,                    // ID gerado automaticamente pelo MongoDB
  nome: String,                     // Nome do cliente
  cpf: String,                      // CPF (11 dígitos, apenas números)
  telefones: {                      // Objeto com lista de telefones
    lista: [String]                 // Array de números de telefone formatados
  },
  email: String,                    // E-mail do cliente (opcional)
  observacoes: String,              // Observações gerais (opcional)
  responsavel: String,              // Nome do responsável pela reclamação
  
  codigoProcon: String,            // Código Procon (campo de múltiplos caracteres, validação para 16 caracteres) (L1C1)
  dataProcon: Date,                // Data Procon (L1C2)
  origem: String,                   // Origem: "Procon" ou "Consumidor.gov"
  produto: String,                  // Produto relacionado (mesmos valores de N2) (L1C3)
  motivoReduzido: [String],         // Motivo reduzido (array de motivos selecionados - múltipla escolha, mesmos valores de N2) (L2C1)
  motivoDetalhado: String,          // Descrição detalhada (L3C1)
  solucaoApresentada: String,       // Solução Apresentada (campo de digitação livre) (L4C1)
  processoAdministrativo: String,   // Processo Administrativo (dropdown: "Sim - Status Não Atendido", "Não - Status Atendido", "Sem Interação do Cliente") (L5C1)
  clienteDesistiu: Boolean,         // Cliente Desistiu (checkbox) (L5C2)
  encaminhadoJuridico: Boolean,     // Processo Encaminhado (checkbox) (L5C3)
  processoEncaminhadoResponsavel: String,  // Responsável pelo encaminhamento (dropdown: Tadeu, Aline, Celcoin) (preenchido quando encaminhadoJuridico = true)
  processoEncaminhadoData: Date,   // Data do encaminhamento (preenchido quando encaminhadoJuridico = true)
  processoEncerrado: Boolean,       // Processo Encerrado (checkbox) (L5C4)
  dataProcessoEncerrado: Date,      // Data Processo Encerrado (preenchido quando processoEncerrado = true) (L5C5)
  registrosReclameAqui: String,    // Registros Reclame Aqui (campo de texto não preenchível, busca automática por CPF)
  anexos: [String],                 // Array de URLs dos anexos no Cloud Storage (mediabank_velohub/anexos_ouvidoria/procon)
  acionouCentral: Boolean,          // Se acionou Central de Ajuda
  protocolosCentral: [String],      // Array de protocolos da Central de Ajuda
  n2SegundoNivel: Boolean,          // Se foi escalado para Ouvidoria
  protocolosN2: [String],           // Array de protocolos N2/Ouvidoria
  reclameAqui: Boolean,             // Se acionou Reclame Aqui
  protocolosReclameAqui: [String],  // Array de protocolos Reclame Aqui
  pixLiberado: Boolean,             // PIX liberado (preenchido por Localizar Atendimentos a partir de BACEN)
  statusContratoQuitado: Boolean,   // Se contrato está quitado (preenchido por Localizar Atendimentos a partir de BACEN)
  semRespostaCliente: Boolean,      // Sem resposta do cliente (Canais de atendimento e protocolos acionados)
  Finalizado: {                     // Objeto de finalização (opcional)
    Resolvido: Boolean,             // Se a reclamação foi resolvida (se vazio/null = em andamento)
    dataResolucao: Date             // Timestamp da resolução (preenchido quando Resolvido = true)
  },
  createdAt: Date,                  // Data de criação (usado como Início tratativa)
  updatedAt: Date                   // Data de atualização
  }
  
  // Índices MongoDB:
  // - cpf: 1 (índice simples para buscas por CPF)
  // - codigoProcon: 1 (índice para buscas por código Procon)
  // - telefones.lista: 1 (índice para buscas em telefones)
  // - email: 1 (índice esparso para buscas por email)
  // - createdAt: -1 (índice para ordenação)
  
  //schema hub_ouvidoria.reclamacoes_judicial (Ação Judicial)
  {
  _id: ObjectId,                    // ID gerado automaticamente pelo MongoDB
  nome: String,                     // Nome do cliente
  cpf: String,                      // CPF (11 dígitos, apenas números)
  telefones: {                      // Objeto com lista de telefones
    lista: [String]                 // Array de números de telefone formatados
  },
  email: String,                    // E-mail do cliente (opcional)
  observacoes: String,              // Observações gerais (opcional)
  responsavel: String,              // Nome do responsável pela reclamação
  
  nroProcesso: String,              // Número do Processo
  empresaAcionada: String,          // Empresa Acionada (dropdown: Velotax, Celcoin)
  dataEntrada: Date,                // Data de Entrada
  produto: String,                  // Produto relacionado (mesmos valores de N2)
  motivoReduzido: [String],         // Motivo reduzido (array de motivos selecionados: Juros, Chave Pix, Restituição BB, Relatório, Repetição Indébito, Superendividamento, Desconhece Contratação)
  motivoDetalhado: String,          // Descrição detalhada
  audiencia: Boolean,               // Audiência (checkbox)
  dataAudiencia: Date,              // Data da Audiência (preenchido quando audiencia = true)
  situacaoAudiencia: String,        // Situação da Audiência (campo digitável)
  subsidios: String,                // Subsídios (campo digitável)
  outrosProtocolos: String,         // Outros Protocolos (campo de texto não preenchível, busca automática por CPF)
  anexos: [String],                 // Array de URLs dos anexos no Cloud Storage (mediabank_velohub/anexos_ouvidoria/processos)
  Finalizado: {                     // Objeto de finalização (opcional)
    Resolvido: Boolean,             // Se a reclamação foi resolvida (se vazio/null = em andamento)
    dataResolucao: Date             // Timestamp da resolução (preenchido quando Resolvido = true)
  },
  createdAt: Date,                  // Data de criação (usado como Início tratativa)
  updatedAt: Date                   // Data de atualização
  }
  
  // Índices MongoDB:
  // - cpf: 1 (índice simples para buscas por CPF)
  // - nroProcesso: 1 (índice para buscas por número do processo)
  // - telefones.lista: 1 (índice para buscas em telefones)
  // - email: 1 (índice esparso para buscas por email)
  // - createdAt: -1 (índice para ordenação)
  
  //schema hub_ouvidoria.reclamacoes_timePortabilidade (Time Portabilidade; painel porTipo.N1 — stats v1.21.3: dataEntrada + produto/motivo)
  {
  _id: ObjectId,
  nome: String,
  cpf: String,
  telefones: { lista: [String] },
  email: String,
  observacoes: String,
  responsavel: String,
  createdAt: Date,
  updatedAt: Date,
  dataEntrada: Date,                // Filtro de período no GET /api/stats
  origem: String,
  produto: String,
  motivoReduzido: [String],
  motivoDetalhado: String,
  protocoloOctadesk: String,
  pixLiberado: Boolean,
  statusContratoQuitado: Boolean,
  statusContratoAberto: Boolean,
  tentativasContato: { lista: [String] },
  semRespostaCliente: Boolean,      // Opcional; métricas excludentes (ouvidoria)
  retido_no_atendimento: Boolean,   // Opcional; liberado/retido com Finalizado (stats.js)
  Finalizado: { Resolvido: Boolean, dataResolucao: Date },
  userEmail: String                 // Opcional
  }
  
  // Índices MongoDB sugeridos:
  // - dataEntrada (filtro stats)
  // - produto, motivoReduzido (filtros UI)
  // - createdAt: -1
  
  //schema hub_ouvidoria.reclamacoes_n1Stats (Octadesk webhook N1) — LISTA v4.16.20: motivoReduzido String; produto fixo Antecipação - 2026; sem motivos_chave_pix/libera_o_chave_pix/pixLiberado no documento
  {
  _id: ObjectId,
  octadeskNumber: Number,           // Ticket Octadesk (único); no POST do webhook vem como Number (JSON raiz)
  cpf: String,                     // Origem CustomField cpf_do_titular no webhook
  motivoReduzido: String,          // Texto canónico alinhado à elegibilidade chave pix (ingest grava; payload Octadesk pode ler CF motivos_chave_pix — não persistir esse nome)
  escalar_chamado: String,        // CustomField escalar_chamado quando a chave vem no POST (String ou null; não entra no critério skipped/upsert). Ingest v1.14.1+: Devolutiva/Reabertura/“-” (e traços Unicode só-hífen)/vazio não entram no $set (preservam valor válido anterior). Card N1 pixLiberado: stats ∈ {Ouvidoria, Devolutiva, -}
  currentStatusName: String,      // Octadesk: métricas resolução N1 por status "Resolvido" (normalizeTextOctadesk); Finalizado espelha resolução no ingest
  retido_no_atendimento: Boolean, // Único critério retido vs liberado (espelho CustomField); stats N1 usam este campo
  produto: String,                // Linha N1: valor fixo persistido "Antecipação - 2026" (ingest + script normalizeN1ProdutoAntecipacao2026); CF libera_o_chave_pix não alimenta este campo
  Finalizado: { Resolvido: Boolean, dataResolucao: Date },
  createdAt: Date,                // OpenDate Octadesk. GET /api/stats N1: período só createdAt
  updatedAt: Date
  }
  
  🗄️ Database: velochat
  
  //schema velochat.chat_salas
  // Salas de conversa (grupos)
  {
  _id: ObjectId,
  Id: String,                          // UUID da sala
  salaNome: String,                    // Nome da sala
  participantes: Array<String>,        // Array de colaboradorNome dos participantes
  encerradaPor: Array<String>,        // Array de colaboradorNome que ocultaram a sala (soft delete)
  bloqueioAdm: Boolean,                // Se true, apenas o criador pode gerenciar a sala
  criadoPor: String,                  // Nome do criador da sala (colaboradorNome)
  createdAt: Date,                     // Data de criação
  updatedAt: Date                      // Data de atualização
  }
  
  // Índices MongoDB recomendados:
  // - Id: 1 (índice único para buscas por salaId)
  // - participantes: 1 (índice para buscas por participante)
  // - createdAt: -1 (índice para ordenação)
  
  //schema velochat.chat_mensagens
  // Mensagens de conversas P2P (privadas entre dois usuários)
  // NOTA: Pode haver múltiplos documentos com mesmo Id quando excede 16MB (limite MongoDB)
  {
  _id: ObjectId,
  Id: String,                          // ID da conversa P2P (formato: "p2p_xxxxx")
  p2p: {                               // Objeto com participantes da conversa P2P
    colaboradorNome1: String,          // Primeiro participante (ordenado alfabeticamente)
    colaboradorNome2: String           // Segundo participante (ordenado alfabeticamente)
  },
  corpo: [{                            // Array de mensagens da conversa
    userName: String,                  // Nome do colaborador que enviou
    timestamp: Date,                   // Data/hora da mensagem
    mensagem: String,                  // Conteúdo da mensagem
    mensagemOriginal: String,          // Mensagem original (quando editada ou excluída)
    mediaUrl: String,                  // URL do anexo (opcional)
    mediaType: String,                 // Tipo do anexo (opcional)
    mediaUrlOriginal: String,         // URL original do anexo (quando excluído)
    anexoExcluido: Boolean             // Se anexo foi excluído (opcional)
  }],
  encerradaPor: Array<String>,        // Array de colaboradorNome que encerraram a conversa (soft delete)
  createdAt: Date,                     // Data de criação do documento
  updatedAt: Date                      // Data de atualização (usado para ordenação de conversas)
  }
  
  // Índices MongoDB recomendados:
  // - Id: 1 (índice para buscas por conversationId)
  // - "p2p.colaboradorNome1": 1, "p2p.colaboradorNome2": 1 (índices para buscas por participante)
  // - updatedAt: -1 (índice para ordenação de conversas)
  // - createdAt: -1 (índice para ordenação de documentos quando há múltiplos)
  
  //schema velochat.chat_mensagens (alternativo)
  // Mensagens individuais de salas (formato alternativo usando collection chat_mensagens)
  {
  _id: ObjectId,
  salaId: String,                      // ID da sala (UUID)
  salaNome: String,                    // Nome da sala
  autorEmail: String,                  // Email do autor
  autorNome: String,                   // Nome do autor (colaboradorNome)
  mensagem: String,                    // Conteúdo da mensagem
  anexos: Array,                       // Array de anexos [{ url: String, type: String, name: String }]
  timestamp: Date,                     // Data/hora da mensagem
  editado: Boolean,                    // Se a mensagem foi editada
  deletado: Boolean,                   // Se a mensagem foi deletada (soft delete)
  editadoEm: Date,                     // Data de edição (opcional)
  deletadoEm: Date,                    // Data de deleção (opcional)
  createdAt: Date,                     // Data de criação
  updatedAt: Date                      // Data de atualização
  }
  
  // Índices MongoDB recomendados:
  // - salaId: 1 (índice para buscas por sala)
  // - autorEmail: 1 (índice para buscas por autor)
  // - timestamp: -1 (índice para ordenação de mensagens)
  // - deletado: 1 (índice para filtrar mensagens deletadas)
  
  //schema velochat.salas_mensagens
  // Mensagens de salas (grupos) em formato de array
  // NOTA: Pode haver múltiplos documentos com mesmo salaId quando excede 16MB (limite MongoDB)
  {
  _id: ObjectId,
  Id: String,                          // UUID do documento de mensagens
  salaId: String,                      // ID da sala (UUID)
  salaNome: String,                    // Nome da sala
  corpo: [{                            // Array de mensagens da sala
    userName: String,                  // Nome do colaborador que enviou
    timestamp: Date,                   // Data/hora da mensagem
    mensagem: String,                  // Conteúdo da mensagem
    mensagemOriginal: String,          // Mensagem original (quando editada ou excluída)
    mediaUrl: String,                  // URL do anexo (opcional)
    mediaType: String,                 // Tipo do anexo (opcional)
    mediaUrlOriginal: String,         // URL original do anexo (quando excluído)
    anexoExcluido: Boolean             // Se anexo foi excluído (opcional)
  }],
  createdAt: Date,                     // Data de criação do documento
  updatedAt: Date                      // Data de atualização (usado para ordenação)
  }
  
  // Índices MongoDB recomendados:
  // - salaId: 1 (índice para buscas por sala)
  // - updatedAt: -1 (índice para ordenação)
  // - createdAt: -1 (índice para ordenação de documentos quando há múltiplos)
  
  // NOTA: Para padrões de formatação de conteúdo, consulte FORMATAÇÃO_PADRÃO.md
