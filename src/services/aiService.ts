// src/services/aiService.ts

import axios from "axios";
import moment from "moment-timezone";

const XAI_API_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const XAI_API_KEY = process.env.XAI_GROK_API_KEY;

// Modelos do Grok
const FAST_MODEL_ID = "grok-4-1-fast-non-reasoning"; // Para extração de dados e dispatcher (Rápido)
const REASONING_MODEL_ID = "grok-4-1-fast-reasoning"; // Para conversas, persona e criatividade (Inteligente)

if (!XAI_API_KEY) {
  throw new Error("❌ XAI_GROK_API_KEY não está definido no ambiente.");
}

// Helper para pegar hora atual formatada
export function getSaoPauloTime(): string {
  const saoPauloTime = moment().tz("America/Sao_Paulo");
  return saoPauloTime.format("YYYY-MM-DD HH:mm:ss Z");
}

// Wrapper genérico para chamar a API Grok (uso interno)
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
    temperature: isJson ? 0.0 : 0.7, // 0 para JSON (precisão), 0.7 para texto (criatividade)
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
    throw new Error("Falha na comunicação com a IA.");
  }
}

// =================================================================
// 1. IDENTIFICAÇÃO DE TAREFAS (DISPATCHER)
// =================================================================
export async function identifyTasks(
  userMessage: string,
  chatHistory: string
): Promise<string[]> {
  const systemMessage = `
        Você é um Planejador de Tarefas (Dispatcher). Sua função é decidir quais especialistas ativar para a *última* mensagem do usuário.
        
        KEYWORDS DISPONÍVEIS: 'calendar', 'email', 'finance', 'market', 'goals', 'ideas', 'files', 'vault', 'gym', 'todo', 'general'.
        
        ### REGRA DE OURO (EXCLUSÃO) ###
        - Se identificar uma intenção técnica clara (finance, todo, gym, etc.), **NÃO** inclua 'general'.
        - 'general' serve apenas para papo furado ou assuntos sem ferramenta específica.

        ### REGRAS DE DECISÃO CRÍTICAS ###

        1. **FINANÇAS (finance)**:
           - Gastos, pagamentos, salário, saldo ("Gastei X", "Meu saldo é Y").
           - **IMPORTANTE:** Se o usuário pedir "Gere uma planilha de gastos" ou "Exportar relatório financeiro", use APENAS 'finance'. O especialista financeiro sabe criar planilhas. **NÃO USE 'files'**.

        2. **FINANÇAS + METAS (finance, goals)**:
           - Sucesso financeiro: "Consegui juntar", "Guardei", "Recebi bônus".
           - Use AMBOS para registrar a entrada E atualizar a meta.

        3. **LISTA DE TAREFAS (todo)**:
           - "Lembrar de", "Preciso fazer", "Anota aí", "Lista de afazeres".
           - "Adiciona X na lista para as 22h" -> É 'todo' (tarefa com prazo), NÃO 'calendar'.
           - "Fiz tal coisa", "Terminei", "Já fui". (Conclusão de tarefa).

        4. **CALENDÁRIO (calendar)**:
           - Compromissos com hora marcada que envolvem *estar em algum lugar* ou *reuniões*.
           - Verbos: "Agendar", "Marcar", "Reunião", "Consulta", "Call".
           - Ex: "Marca dentista amanhã", "Agenda reunião às 10h".

        5. **COFRE / ANOTAÇÕES (vault)**:
           - Senhas, chaves, logins, dados bancários (conta, pix), documentos.
           - "Qual meu pix?", "Minha senha do face".

        6. **ACADEMIA / TREINO (gym)**:
           - Montar treino, ficha, exercícios, dieta, peso/altura.
           - "Monta um treino ABC", "Tenho 80kg", "Como faz supino?".

        7. **ARQUIVOS GERAIS (files)**:
           - Use APENAS para arquivos genéricos não financeiros.
           - Ex: "Crie um documento de texto sobre poemas", "Leia o arquivo X".
           - **NÃO USE** para "Planilha de gastos" (Isso é 'finance').

        8. **APENAS METAS (goals)**:
           - Criar/Listar metas de longo prazo ("Quero juntar 100k").

        9. **MERCADO (market)**:
           - Lista de compras físicas (leite, pão, shampoo).

        10. **CONVERSA CONTINUADA**:
           - Use o histórico abaixo para entender o contexto.

        ### HISTÓRICO DE CONVERSA ###
        ${chatHistory}
        
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

// =================================================================
// 2. EXTRAÇÃO DE DADOS (JSON)
// =================================================================
export async function extractData(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  // Injeta a data atual no prompt para a IA saber "hoje", "amanhã", etc.
  const finalPrompt = `[DATA/HORA ATUAL: ${getSaoPauloTime()}]\n${systemPrompt}`;
  return await grokCompletion(finalPrompt, userMessage, FAST_MODEL_ID, true);
}

// =================================================================
// 3. GERAÇÃO DE RESPOSTA COM PERSONA
// =================================================================
export async function generatePersonaResponse(
  systemInstruction: string,
  userMessage: string,
  userConfig: any
): Promise<string> {
  const systemPrompt = `
    ===[IDENTIDADE DO AGENTE]===
    Nome: ${userConfig.agent_nickname}
    Gênero: ${userConfig.agent_gender}
    Personalidade: ${userConfig.agent_personality.join(", ")}
    Usuário: ${userConfig.user_nickname}
    
    ===[SUA TAREFA ESPECÍFICA]===
    ${systemInstruction}
    
    ### REGRAS RÍGIDAS DE FORMATAÇÃO (WHATSAPP) ###
    1. **NEGRITO:** Use APENAS UM asterisco de cada lado (*texto*). NUNCA use dois (**erro**).
    2. **ITÁLICO:** Use underline (_texto_).
    3. **TACHADO:** Use til (~texto~).
    4. **MONOSPACE:** Use crases triplas (\`\`\`texto\`\`\`).
    5. **LINKS:** Mande o link cru ou formatado, mas garanta que funcione.
    6. Seja conciso, mas útil e mantenha a personalidade.
  `;

  // Usa o modelo 'reasoning' para ter mais criatividade e aderência à persona
  return await grokCompletion(systemPrompt, userMessage, REASONING_MODEL_ID);
}

// =================================================================
// 4. SUMMARIZER (UNIFICADOR DE RESPOSTAS)
// =================================================================
export async function summarizerResponse(
  responses: string[],
  userConfig: any
): Promise<string> {
  // Se só tem uma resposta, não gasta token à toa, retorna direto.
  if (responses.length === 1) return responses[0];

  const systemMessage = `
    Você é o *SUMMARIZER* (Unificador de Tarefas) do assistente ${
      userConfig.agent_nickname
    }.
    
    ### SEU OBJETIVO:
    Unificar as respostas técnicas dos especialistas abaixo em uma única mensagem coesa, fluida e natural.

    ### RESPOSTAS RECEBIDAS:
    ${responses.map((r, i) => `[Especialista ${i + 1}]: "${r}"`).join("\n")}
    
    ### REGRAS:
    1. Fusão Inteligente: Se [Esp. 1] disse "Registrei o ganho" e [Esp. 2] disse "Atualizei a meta", diga: "Registrei o ganho e já aproveitei para atualizar sua meta também!".
    2. Prioridade de Ação: Se um especialista confirmou uma ação (ex: "Tarefa concluída"), dê destaque a isso. Se outro especialista apenas fez um comentário genérico, use-o como complemento.
    3. **IMPORTANTE:** Use formatação WhatsApp (*negrito*, _itálico_). NUNCA use (**negrito**).
    4. Personalidade: Mantenha o tom: ${userConfig.agent_personality.join(
      ", "
    )}.

    Gere a resposta unificada agora.
  `;

  return await grokCompletion(
    systemMessage,
    "Unifique as respostas acima.",
    REASONING_MODEL_ID
  );
}

export async function normalizeForSpeech(text: string): Promise<string> {
  const systemPrompt = `
    Você é um redator de scripts para locução (Text-to-Speech).
    Sua tarefa é reescrever o texto do usuário para que soe natural quando lido por um robô.
    
    REGRAS:
    1. Números e Moedas: Escreva por extenso. (Ex: "R$ 50,00" -> "Cinquenta reais").
    2. Links: Remova protocolos. (Ex: "https://google.com" -> "google ponto com").
    3. Emojis: Remova TODOS os emojis.
    4. Formatação: Remova asteriscos (*), underlines (_) e caracteres especiais de formatação.
    5. Clareza: Se houver listas, transforme em texto corrido fluido.
    
    Retorne APENAS o texto tratado.
  `;

  return await grokCompletion(systemPrompt, text, FAST_MODEL_ID);
}

// =================================================================
// 5. CONVERSA GERAL
// =================================================================
export async function generalCompletion(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  return await grokCompletion(systemPrompt, userMessage, REASONING_MODEL_ID);
}
