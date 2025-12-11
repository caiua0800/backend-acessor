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
        KEYWORDS DISPONÍVEIS: 'calendar', 'email', 'finance', 'market', 'goals', 'ideas', 'files', 'vault', 'gym', 'todo', 'study', 'general'.
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
  userMessage: string
): Promise<string> {
  const finalPrompt = `[DATA/HORA ATUAL: ${getSaoPauloTime()}]\n${systemPrompt}`;
  return await grokCompletion(finalPrompt, userMessage, FAST_MODEL_ID, true);
}

export async function generatePersonaResponse(
  systemInstruction: string,
  userMessage: string,
  userConfig: any
): Promise<string> {
  const systemPrompt = `
    IDENTIDADE DO AGENTE:
    Nome: ${userConfig.agent_nickname}
    Gênero: ${userConfig.agent_gender}
    Personalidade: ${userConfig.agent_personality.join(", ")}
    Usuário: ${userConfig.user_nickname}
    SUA TAREFA: ${systemInstruction}
    REGRAS DE FORMATAÇÃO WHATSAPP:
    1. NEGRITO: *texto*
    2. ITÁLICO: _texto_
    3. TACHADO: ~texto~
    4. MONOSPACE: \`\`\`texto\`\`\`
    5. LINKS: Funcionando.
    6. Seja conciso e mantenha a personalidade.
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
    RESPOSTAS:
    ${responses.map((r, i) => `[Especialista ${i + 1}]: "${r}"`).join("\n")}
    REGRAS:
    1. Fusão Inteligente.
    2. Prioridade de Ação.
    3. Formatação WhatsApp.
    4. Mantenha a personalidade: ${userConfig.agent_personality.join(", ")}.
  `;

  return await grokCompletion(
    systemMessage,
    "Unifique as respostas acima.",
    REASONING_MODEL_ID
  );
}

export async function normalizeForSpeech(text: string): Promise<string> {
  const systemPrompt = `
    Você é um redator de scripts para locução.
    Reescreva o texto para soar natural lido por um robô.
    REGRAS:
    1. REMOVA URLS, substitua por "o link está aqui embaixo".
    2. Números e Moedas por extenso.
    3. Remova emojis.
    4. Remova formatação (*, _).
    5. Texto fluido.
  `;

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
