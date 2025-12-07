// src/specialists/generalSpecialist.ts
import * as aiService from "../services/aiService";
import * as memoryService from "../services/memoryService";
import { UserContext } from "../services/types";

/**
 * Especialista de Conversa Geral.
 * Usa o histórico de chat para manter a conversa.
 */
export async function generalSpecialist(context: UserContext): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  // 1. CARREGA O HISTÓRICO DE CONVERSA DO DB
  const chatHistoryText = await memoryService.loadHistory(waId);

  // 2. MONTA O PROMPT COMPLETO COM A PROIBIÇÃO DE AÇÕES
  const systemMessage = `
        ===[SISTEMA: Data Atual: ${aiService.getSaoPauloTime()}]\n
        Você é um assistente pessoal. Sua identidade é:
        - Nome: ${userConfig.agent_nickname}
        - Gênero: ${userConfig.agent_gender}
        - Personalidade: ${userConfig.agent_personality.join(", ")}
        
        Você está conversando com ${userConfig.user_nickname}.
        
        ### SUA MISSÃO CRÍTICA ###
        Sua única tarefa é conversar e entreter, sendo um bom companheiro.
        
        ### REGRA DE PROIBIÇÃO (MÁXIMA PRIORIDADE) ###
        1. VOCÊ NÃO TEM FERRAMENTAS.
        2. VOCÊ NUNCA DEVE MENCIONAR TER AGENDADO, PAUSADO, CANCELADO, ADICIONADO ITENS, REGISTRADO DINHEIRO, ou QUALQUER OUTRA AÇÃO.
        3. NUNCA imprima detalhes de agenda, listas de compras ou metas na resposta.
        4. Se o usuário pedir uma ação, diga que ele precisa enviar a instrução de forma mais direta/objetiva na próxima mensagem (Ex: "Adicionar Leite").

        ### HISTÓRICO DE CONVERSA (PARA CONTEXTO) ###
        ${chatHistoryText}
        
        Aja com sua personalidade e responda à última mensagem.
    `;

  try {
    // 3. CHAMA O LLM (USA O MODELO DE RACIOCÍNIO)
    const responseText = await aiService.generalCompletion(
      systemMessage,
      fullMessage
    );

    // 4. SALVA A TROCA DE MENSAGENS NO HISTÓRICO
    await memoryService.saveToHistory(waId, fullMessage, responseText);

    return responseText;
  } catch (error) {
    console.error("Erro no General Specialist:", error);
    return "Desculpe, tive um problema de comunicação, mas estou de volta! Manda de novo.";
  }
}
