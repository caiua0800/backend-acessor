// src/specialists/gmailSpecialist.ts
import * as googleService from "../services/googleService";
import * as aiService from "../services/aiService";
import { UserContext } from "../services/types";

export async function gmailSpecialist(context: UserContext): Promise<any> {
  // RETORNA ANY (JSON)
  const { waId, fullMessage } = context;

  const extractionPrompt = `
        Você é um Extrator de Query de E-mail. Sua única tarefa é extrair a intenção de busca (ex: 'hoje', 'da Amazon').
        Retorne APENAS a string de busca mais adequada para o Gmail (Ex: "newer_than:1d AND from:amazon").
    `;

  try {
    const query = await aiService.extractData(extractionPrompt, fullMessage);

    if (!query || query.length < 3)
      return { task: "email", status: "NOT_APPLICABLE" };

    const emails = await googleService.listEmails(waId, query);

    if (emails.length === 0)
      return {
        task: "email",
        status: "SUCCESS",
        action: "list",
        query: query,
        message: "Nenhum e-mail encontrado.",
      };

    // Retorna a lista de emails para o Agente de Formatação
    const emailList = emails.map((e: any) => ({
      from: e.from,
      subject: e.subject,
      snippet: e.snippet,
    }));

    return {
      task: "email",
      status: "SUCCESS",
      action: "list",
      query: query,
      emails: emailList,
    };
  } catch (error) {
    const typedError = error as any;
    if (typedError.message.includes("AUTH_REQUIRED")) {
      const authUrl = googleService.getAuthUrl(waId);
      return {
        task: "email",
        status: "FAILURE",
        reason: "AUTH_REQUIRED",
        detail: `*Preciso de permissão para ler seus e-mails.* Autorize aqui:\n${authUrl}`,
      };
    }
    return { task: "email", status: "FAILURE", reason: typedError.message };
  }
}
