import axios from "axios";
import moment from "moment-timezone";

const XAI_API_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const XAI_API_KEY = process.env.XAI_GROK_API_KEY;

const FAST_MODEL_ID = "grok-4-1-fast-non-reasoning";
const REASONING_MODEL_ID = "grok-4-1-fast-reasoning";

if (!XAI_API_KEY) {
  throw new Error("❌ XAI_GROK_API_KEY não está definido no ambiente.");
}

export function getSaoPauloTime(): string {
  const saoPauloTime = moment().tz("America/Sao_Paulo");
  return saoPauloTime.format("YYYY-MM-DD HH:mm:ss Z");
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
    temperature: isJson ? 0.0 : 0.2,
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
    console.error(
      `❌ Erro na API do Grok (Modelo: ${modelId}):`,
      (error as any).response?.data || (error as any).message
    );
    throw new Error("Falha na comunicação com o Grok da xAI.");
  }
}

export async function identifyTasks(userMessage: string): Promise<string[]> {
  const systemMessage = `
        Você é um Planejador de Tarefas Altamente Eficiente. Sua única tarefa é analisar a mensagem e retornar uma lista de TODAS as palavras-chave de especialistas necessárias, separadas por vírgula.
        
        ### REGRA DE PRIORIZAÇÃO CRÍTICA ###
        1. SE HOUVER UMA AÇÃO (verbo de comando como 'adicionar', 'marcar', 'gastar', 'lançar', 'emagrecer', 'aumentar'), você DEVE retornar a keyword de AÇÃO (ex: goals, market).
        2. Retorne 'general' APENAS se a mensagem for *puramente* uma saudação ou conversa fiada sem instrução de ação.
        3. FORMATO: APENAS a lista de palavras-chave, sem espaços ou explicações.
        
        PALAVRAS-CHAVE PERMITIDAS: 'calendar', 'email', 'finance', 'market', 'goals', 'ideas', 'files', 'general'.
        
        ### EXEMPLOS (PRIORIZANDO AÇÃO) ###
        - Usuário: "Eu emagreci 10 quilos só hoje, sabia?" -> Resposta: goals
        - Usuário: "E aí, tudo bem?" -> Resposta: general
        - Usuário: "Oi, preciso gastar 50 reais, e aí como vai?" -> Resposta: finance
        - Usuário: "Só adicione pão" -> Resposta: market
        - Usuário: "Marca reunião com o Pedro e gasta 10" -> Resposta: calendar,finance
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

export async function formatFinalResponse(
  technicalResults: any[],
  userConfig: any
): Promise<string> {
  const jsonToFormat = JSON.stringify(technicalResults);

  const systemMessage = `
        ===[SISTEMA: Data Atual: ${getSaoPauloTime()}]\n
        Você é o AGENTE DE VOZ FINAL. Sua única missão é transformar um array de resultados técnicos JSON em uma única mensagem coesa e amigável para o usuário.
        
        Sua identidade é: Nome: ${userConfig.agent_nickname}, Gênero: ${
    userConfig.agent_gender
  }, Personalidade: ${userConfig.agent_personality.join(", ")}.
        Você está falando com ${userConfig.user_nickname}.
        
        ### TAREFA ###
        1. Compile os resultados de todas as tarefas.
        2. Aplique a personalidade em *todas* as frases.
        3. Use a formatação do WhatsApp (*negrito*, _itálico_).
        4. Omitir qualquer menção à palavra "JSON", "técnico", "dados".

        Array de Resultados Técnicos: ${jsonToFormat}
    `;

  return await grokCompletion(
    systemMessage,
    `Formate a mensagem final com a personalidade.`,
    REASONING_MODEL_ID
  );
}

export async function extractData(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const finalPrompt = `[DATA ATUAL: ${getSaoPauloTime()}]\n${systemPrompt}`;
  return await grokCompletion(finalPrompt, userMessage, FAST_MODEL_ID, true);
}

export async function generalCompletion(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  return await grokCompletion(systemPrompt, userMessage, REASONING_MODEL_ID);
}
