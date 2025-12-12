import axios from "axios";
import moment from "moment-timezone";
import fs from "fs";

const XAI_API_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const XAI_API_KEY = process.env.XAI_GROK_API_KEY;

const FAST_MODEL_ID = "grok-4-1-fast-non-reasoning";
const REASONING_MODEL_ID = "grok-4-1-fast-reasoning";

if (!XAI_API_KEY) {
  throw new Error("XAI_GROK_API_KEY não está definido no ambiente.");
}

export function getSaoPauloTime(): string {
  const saoPauloTime = moment().tz("America/Sao_Paulo");
  return saoPauloTime.format("YYYY-MM-DD HH:mm:ss Z");
}

export function getCurrentTime(timezone: string = "America/Sao_Paulo"): string {
  // Isso garante que a IA receba a hora LOCAL do usuário
  return moment().tz(timezone).format("YYYY-MM-DD HH:mm:ss Z");
}

async function grokCompletion(
  systemPrompt: string,
  userMessage: string,
  modelId: string,
  isJson: boolean = false
): Promise<string> {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const payload: any = {
    model: modelId,
    messages: messages,
    temperature: isJson ? 0.0 : 0.7,
  };

  if (isJson) {
    payload.response_format = { type: "json_object" };
  }

  try {
    const response = await axios.post(XAI_API_ENDPOINT, payload, {
      headers: {
        Authorization: `Bearer ${XAI_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    return response.data.choices[0].message.content || "";
  } catch (error) {
    throw new Error("Falha na comunicação com a IA.");
  }
}

export async function identifyTasks(
  userMessage: string,
  chatHistory: string
): Promise<string[]> {
  const systemMessage = `
        Você é um Planejador de Tarefas. Sua função é decidir quais especialistas ativar para a última mensagem do usuário.
        KEYWORDS DISPONÍVEIS: 'calendar', 'finance', 'market', 'goals', 'ideas', 'files', 'vault', 'gym', 'todo', 'study', 'general'.
        Se identificar uma intenção técnica clara, NÃO inclua 'general'.
        'general' serve apenas para papo furado.
        FINANÇAS: Gastos, pagamentos, salário, saldo, planilhas financeiras, exportar relatório financeiro.
        FINANÇAS + METAS: Sucesso financeiro, guardar dinheiro.
        LISTA DE TAREFAS: Lembrar de, preciso fazer, anota aí, lista de afazeres.
        CALENDÁRIO: Compromissos com hora marcada, agendar, marcar reunião.
        COFRE: Senhas, chaves, logins, dados bancários.
        ACADEMIA: Treino, dieta, peso.
        ARQUIVOS GERAIS: Arquivos genéricos não financeiros.
        METAS: Metas de longo prazo.
        MERCADO: Lista de compras físicas.
        CONVERSA CONTINUADA: Use o histórico.
        ESTUDO: Estudar, cadastrar matéria, plano de estudo.
        HISTÓRICO DE CONVERSA: ${chatHistory}
        Retorne APENAS as keywords separadas por vírgula.
    `;

  const output = await grokCompletion(
    systemMessage,
    userMessage,
    FAST_MODEL_ID
  );

  return output
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0 && k !== "<|separator|>");
}

export async function extractData(
  systemPrompt: string,
  userMessage: string,
  userTimezone: string = "America/Sao_Paulo" // <--- Novo parâmetro
): Promise<string> {
  const finalPrompt = `[DATA/HORA ATUAL DO USUÁRIO: ${getCurrentTime(
    userTimezone
  )} (Fuso: ${userTimezone})]\n${systemPrompt}`;
  return await grokCompletion(finalPrompt, userMessage, FAST_MODEL_ID, true);
}

export async function generatePersonaResponse(
  systemInstruction: string,
  userMessage: string,
  userConfig: any
): Promise<string> {
  // Debug: Verifique no terminal se o idioma está chegando corretamente
  console.log(
    `🗣️ [AI LANGUAGE] Configuração recebida: "${userConfig.language}"`
  );

  const systemPrompt = `
    INSTRUÇÕES DE PERSONA:
    - Nome: ${userConfig.agent_nickname}
    - Gênero: ${userConfig.agent_gender}
    - Personalidade: ${userConfig.agent_personality.join(", ")}
    - Usuário: ${userConfig.user_nickname}
    
    TAREFA TÉCNICA: ${systemInstruction}
    
    REGRAS DE FORMATAÇÃO:
    1. Use formatação do WhatsApp (*negrito*, _itálico_).
    2. Seja conciso e natural.

    ===================================================
    🛑 REGRAS CRÍTICAS DE IDIOMA (PRIORIDADE MÁXIMA) 🛑
    ===================================================
    1. O idioma OBRIGATÓRIO para a resposta é: "${userConfig.language}".
    2. IGNORE o idioma em que o usuário escreveu. Se ele escrever em Português mas a configuração for English, RESPONDA EM ENGLISH.
    3. IGNORE o fato de que estas instruções estão em Português. Sua saída final deve obedecer SOMENTE à variável de idioma acima.
    4. Traduza qualquer termo técnico ou resposta do sistema para "${
      userConfig.language
    }" antes de enviar.
  `;

  return await grokCompletion(systemPrompt, userMessage, REASONING_MODEL_ID);
}

export async function summarizerResponse(
  responses: string[],
  userConfig: any
): Promise<string> {
  if (responses.length === 1) return responses[0];

  const systemMessage = `
  Você é o Unificador de Tarefas do assistente ${userConfig.agent_nickname}.
  Unifique as respostas técnicas abaixo em uma única mensagem coesa.
  
  RESPOSTAS ORIGINAIS:
  ${responses.map((r, i) => `[Especialista ${i + 1}]: "${r}"`).join("\n")}
  
  REGRAS:
  1. Fusão Inteligente.
  2. Prioridade de Ação.
  3. Formatação WhatsApp.
  
  ===================================================
  🛑 PRIORIDADE MÁXIMA DE IDIOMA 🛑
  ===================================================
  VOCÊ DEVE ESCREVER A RESPOSTA FINAL EM: "${userConfig.language}".
  Não misture idiomas. Traduza o conteúdo dos especialistas se necessário.
`;
  return await grokCompletion(
    systemMessage,
    "Unifique as respostas acima.",
    REASONING_MODEL_ID
  );
}

export async function normalizeForSpeech(
  text: string, 
  language: string = "Português (Brasil)" // <--- Novo parâmetro com valor padrão
): Promise<string> {
  const systemPrompt = `
    Você é um redator de scripts para locução (TTS).
    
    IDIOMA DO SCRIPT: ${language}
    
    SUA TAREFA:
    1. Prepare o texto para ser lido por um robô neste idioma.
    2. IMPORTANTE: MANTENHA O IDIOMA do texto original. Se o texto veio em Inglês, a saída DEVE ser em Inglês.
    3. Remova URLs (substitua por "o link enviado").
    4. Escreva números e moedas por extenso (no idioma ${language}).
    5. Remova emojis e formatação (*, _).
    6. Se o texto estiver misturado, dê preferência ao idioma: ${language}.
  `;

  // Usa o modelo rápido para não demorar
  return await grokCompletion(systemPrompt, text, FAST_MODEL_ID);
}

export async function generalCompletion(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  return await grokCompletion(systemPrompt, userMessage, REASONING_MODEL_ID);
}

export async function describeImage(
  imagePath: string,
  prompt: string
): Promise<string> {
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString("base64");
    const dataUrl = `data:image/jpeg;base64,${base64Image}`;

    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ];

    const payload = {
      model: "grok-vision-beta",
      messages: messages,
      temperature: 0.2,
    };

    const response = await axios.post(XAI_API_ENDPOINT, payload, {
      headers: {
        Authorization: `Bearer ${XAI_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    return response.data.choices[0].message.content || "";
  } catch (error) {
    return " [Erro ao ler imagem] ";
  }
}
