// src/specialists/gmailSpecialist.ts

import * as googleService from "../services/googleService";
import * as aiService from "../services/aiService";
import { UserContext } from "../services/types";

// Interfaces de Extração
interface EmailQueryData {
    query: string;
}
interface ReadEmailData {
    read_id: string; // Para ler um email específico
}

type GmailExtractionData = EmailQueryData | ReadEmailData | {};

// O tipo de retorno é Promise<string>
export async function gmailSpecialist(context: UserContext): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  // Prompt MESTRE DE INTENÇÃO/EXTRAÇÃO: A IA deve retornar a ação e os dados
  const extractionPrompt = `
    Você é um Extrator de Ações de E-mail. Analise a mensagem do usuário e determine a ação principal.
    
    ### REGRA DE OURO ###
    Sua única função é extrair a query de busca OU o ID do e-mail para leitura.
    
    ### FORMATOS DE RETORNO (PRIORIDADE) ###
    1. LER E-MAIL (por ID): {"read_id": "message_id_extraido"}
    2. BUSCAR/LISTAR: {"query": "string de busca do Gmail (ex: newer_than:1d, from:amazon)"}
    3. Nenhuma Ação Válida: {}
  `;

  try {
    // 1. EXTRAÇÃO DO JSON (LLM 1)
    const jsonString = await aiService.extractData(
      extractionPrompt,
      fullMessage
    );
    const data: GmailExtractionData = JSON.parse(jsonString);

    // Variável para armazenar o resultado técnico para a IA de Personalidade
    let actionConfirmedMessage = "";

    // 2. LÓGICA DE EXECUÇÃO (NODE.JS)

    // A. LÓGICA DE LER E-MAIL
    if ('read_id' in data && data.read_id) {
        const email = await googleService.readEmail(waId, data.read_id);
        // Retornamos o conteúdo completo para o LLM 2 resumir
        actionConfirmedMessage = `Email lido com sucesso. De: ${email.from}. Assunto: ${email.subject}. Conteúdo completo: ${email.body}`;
    }
    // B. LÓGICA DE BUSCAR/LISTAR E-MAILS
    else if ('query' in data && data.query && data.query.length > 3) {
        const emails = await googleService.listEmails(waId, data.query);
        
        if (emails.length === 0) {
            actionConfirmedMessage = `Não encontrei nenhum e-mail para a sua busca: '${data.query}'.`;
        } else {
            // Formatação técnica do resultado para o LLM 2 (Personalidade)
            const emailList = emails.map((e: any, index) => `(${index + 1}) De: ${e.from}. Assunto: ${e.subject}. Snippet: ${e.snippet}`).join('\n');
            actionConfirmedMessage = `Busca '${data.query}' concluída. Encontrei ${emails.length} e-mail(s): ${emailList}`;
        }
    }

    // 3. SE NENHUMA INTENÇÃO VÁLIDA FOI EXECUTADA
    if (!actionConfirmedMessage) {
        return ""; // Retorna string vazia para o Orquestrador chamar o Generalist
    }
    
    // 4. GERAÇÃO DA RESPOSTA COM PERSONALIDADE (LLM 2)
    const finalResponse = await aiService.generatePersonaResponse(
      `Sua tarefa é transformar esta mensagem de confirmação técnica em uma resposta amigável, com personalidade e formatada para o WhatsApp.
       Se a mensagem for um conteúdo de e-mail (snippet ou corpo), você deve resumi-lo antes de responder.
       MENSAGEM TÉCNICA: "${actionConfirmedMessage}"
       `,
      fullMessage,
      userConfig
    );
    
    return finalResponse;

  } catch (error: any) {
    // Retorno Técnico de FALHA
    console.error(`Erro no Gmail Specialist:`, error);
    
    // TRATAMENTO DA EXCEÇÃO DE AUTORIZAÇÃO (FLUXO CORRETO)
    if (error.message.includes("AUTH_REQUIRED")) {
        const authUrl = googleService.getAuthUrl(waId);
        return `*Parece que preciso de permissão para ler seus e-mails.* Autorize aqui: \n${authUrl}`;
    }
    
    // Outros erros
    return `*Xi, ${userConfig.user_nickname}*. Deu um erro na minha conexão com o Google. Tive um erro: _${error.message}_. Será que você consegue reformular sua busca?`;
  }
}