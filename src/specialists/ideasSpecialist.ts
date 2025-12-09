// src/specialists/ideasSpecialist.ts

import * as ideaService from "../services/ideaService";
import * as aiService from "../services/aiService";
import { UserContext } from "../services/types";

// Interfaces para a EXTRAÇÃO do LLM
interface IdeaData {
  content: string;
  tags: string;
}
interface ListData { list_all: boolean; }
interface DeleteData { idea_id: string; delete: boolean; }
interface ClearData { clear_all: boolean; }

// Tipos de dados que o especialista pode extrair
type IdeaExtractionData = IdeaData | ListData | DeleteData | ClearData;

// O tipo de retorno é Promise<string>
export async function ideasSpecialist(context: UserContext): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  // Prompt MESTRE DE INTENÇÃO/EXTRAÇÃO: A IA deve retornar a ação e os dados
  const extractionPrompt = `
    Você é um Extrator de Ações de Ideias/Notas. Analise a mensagem e retorne APENAS um ÚNICO OBJETO JSON que melhor representa a intenção primária do usuário.
    
    ### REGRAS CRÍTICAS ###
    1. SALVAR/ADICIONAR: Se for para salvar uma nova ideia, retorne: {"content": "O texto da ideia", "tags": "tag1, tag2"}
    2. LISTAR: Se for listar, retorne: {"list_all": true}
    3. EXCLUIR TUDO: Se for limpar todas as ideias, retorne: {"clear_all": true}
    4. Nenhuma das anteriores: retorne um objeto vazio: {}
    
    *OBS: Se for para DELETAR UMA IDEIA ESPECÍFICA, a lógica será tratada no código após a listagem.*
  `;

  try {
    // 1. EXTRAÇÃO DO JSON (LLM 1)
    const jsonString = await aiService.extractData(
      extractionPrompt,
      fullMessage
    );
    const data: IdeaExtractionData = JSON.parse(jsonString);

    // Variável para armazenar o resultado técnico para a IA de Personalidade
    let actionConfirmedMessage = "";

    // 2. LÓGICA DE EXECUÇÃO (NODE.JS)

    // --- 1. LÓGICA DE LISTAR ---
    if ('list_all' in data && data.list_all) {
        const ideas = await ideaService.listIdeas(waId);
        if (ideas.length === 0) {
            actionConfirmedMessage = "Você não tem nenhuma ideia ou anotação salva ainda. Que tal anotar a primeira?";
        } else {
            // Formatação técnica do resultado para o LLM 2 (Personalidade)
            const listText = ideas.map((item, index) => `(${index + 1}) - ${item.idea_content.substring(0, 50)}... [Tags: ${item.tags.join(', ')}]`).join('\n');
            actionConfirmedMessage = `Suas ideias salvas são:\n${listText}.`;
        }
    }
    
    // --- 2. LÓGICA DE LIMPAR TUDO (REQUER CONFIRMAÇÃO) ---
    else if ('clear_all' in data && data.clear_all) {
        // CORREÇÃO: Pede confirmação antes de apagar
        // NOTA: Se você quer que apague na mesma mensagem, comente a linha abaixo. 
        // Se você quer que o LLM pergunte, use o LLM 2 aqui:
        return await aiService.generatePersonaResponse(
             `O usuário pediu para apagar todas as ideias (clear_all). Peça uma confirmação explícita antes de chamar a ferramenta de exclusão.`,
             fullMessage,
             userConfig
        );
        
        // Se a confirmação for feita, a lógica real de exclusão virá em uma nova mensagem
    }

    // --- 3. LÓGICA DE SALVAR/ADICIONAR ---
    else if ('content' in data && data.content && data.content.length > 5) {
      const tagsArray = data.tags.split(",").map((tag) => tag.trim());
      const newIdea = await ideaService.createIdea(
        waId,
        data.content,
        tagsArray
      );
      actionConfirmedMessage = `Ideia salva com sucesso! Conteúdo: "${newIdea.idea_content.substring(0, 50)}...". Tags geradas: ${tagsArray.join(', ')}.`;
    }

    // --- 4. NENHUMA INTENÇÃO VÁLIDA ---
    if (!actionConfirmedMessage) {
        return ""; // Retorna string vazia para o Orquestrador chamar o Generalist
    }
    
    // 5. GERAÇÃO DA RESPOSTA COM PERSONALIDADE (LLM 2)
    const finalResponse = await aiService.generatePersonaResponse(
      `Sua tarefa é transformar esta mensagem de confirmação técnica em uma resposta amigável, com personalidade e formatada para o WhatsApp.
       MENSAGEM TÉCNICA: "${actionConfirmedMessage}"
       `,
      fullMessage,
      userConfig
    );
    
    return finalResponse;

  } catch (error: any) {
    // Retorno Técnico de FALHA
    console.error(`Erro no Ideas Specialist:`, error);
    // Em caso de erro, o especialista retorna uma mensagem de erro formatada
    return `*Erro!* Não consegui completar sua ação de ideias. Tive um erro: _${error.message}_.`;
  }
}