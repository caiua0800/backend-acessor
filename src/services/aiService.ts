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
    console.log(`❌ Erro na API do Grok (Modelo: ${modelId}):`)
    console.log(error)
    throw new Error("Falha na comunicação com o Grok da xAI.");
  }
}

export async function identifyTasks(userMessage: string): Promise<string[]> {
  const systemMessage = `
        Você é um Planejador de Tarefas Altamente Eficiente. Sua única tarefa é analisar a mensagem e retornar uma lista de TODAS as palavras-chave de especialistas necessárias, separadas por vírgula.
        
        ### REGRAS RÍGIDAS DE DESPACHE ###
        1. PRIORIZE AÇÃO: Se houver qualquer intenção de AÇÃO, a keyword de AÇÃO deve ser a ÚNICA resposta.
        2. CONVERSA: Retorne 'general' APENAS se a mensagem for *puramente* uma saudação ou conversa fiada sem instrução de ação.
        3. FORMATO: APENAS a lista de palavras-chave, sem espaços ou explicações.
        
        PALAVRAS-CHAVE PERMITIDAS: 'calendar', 'email', 'finance', 'market', 'goals', 'ideas', 'files', 'general'.
        
        ### EXEMPLOS (MUITO IMPORTANTES) ###
        - Usuário: "Adiciona leite na lista" -> Resposta: market
        - Usuário: "E aí, tudo bem?" -> Resposta: general
        - Usuário: "Oi, preciso gastar 50 reais" -> Resposta: finance
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

export async function summarizeResponses(
  responses: string[],
  userConfig: any
): Promise<string> {
  const responsesText = responses
    .map((r) => `[Resposta do Especialista]: ${r}`)
    .join("\n\n");

  const systemMessage = `
        ===[SISTEMA: Data Atual: ${getSaoPauloTime()}]\n
        Você é um Assistente de Conclusão de Tarefas. 
        Sua identidade é: Nome: ${userConfig.agent_nickname}, Gênero: ${
    userConfig.agent_gender
  }, Personalidade: ${userConfig.agent_personality.join(", ")}.
        Você recebeu as seguintes respostas de especialistas. 
        Sua tarefa é compilar e transformar TUDO em uma única mensagem coesa, amigável e direta para o usuário (${
          userConfig.user_nickname
        }).
        Use a formatação do WhatsApp (*negrito*, _itálico_).
        Apenas retorne a resposta final, sem cabeçalhos ou listas.
    `;

  return await grokCompletion(
    systemMessage,
    `Respostas dos especialistas:\n${responsesText}`,
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
