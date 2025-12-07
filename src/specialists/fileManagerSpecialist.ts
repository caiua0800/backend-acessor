// src/specialists/fileManagerSpecialist.ts
import * as googleService from "../services/googleService";
import * as aiService from "../services/aiService";
import { UserContext } from "../services/types";

interface DocCreationData {
  title: string;
  content: string;
}

export async function fileManagerSpecialist(
  context: UserContext
): Promise<any> {
  // RETORNA ANY (JSON)
  const { waId, fullMessage } = context;

  // Focando na tarefa de maior probabilidade de acontecer: criar um doc.
  const extractionPrompt = `
        Você é um Extrator de Criação de Documentos. Sua única tarefa é extrair o título e o conteúdo de um novo documento a ser criado.
        Retorne APENAS o JSON no formato: {"title": "Titulo do Doc", "content": "Conteúdo inicial"}.
    `;

  try {
    const jsonString = await aiService.extractData(
      extractionPrompt,
      fullMessage
    );
    const docData: DocCreationData = JSON.parse(jsonString);

    if (!docData.title || docData.title.length < 5)
      return { task: "files", status: "NOT_APPLICABLE" };

    const docResult = await googleService.createDoc(
      waId,
      docData.title,
      docData.content
    );

    // Retorno Técnico de SUCESSO
    return {
      task: "files",
      status: "SUCCESS",
      action: "create_doc",
      title: docResult.title,
      link: docResult.link,
    };
  } catch (error) {
    const typedError = error as any;
    if (typedError.message.includes("AUTH_REQUIRED")) {
      const authUrl = googleService.getAuthUrl(waId);
      return {
        task: "files",
        status: "FAILURE",
        reason: "AUTH_REQUIRED",
        detail: `*Preciso de permissão para gerenciar seus arquivos.* Autorize aqui: ${authUrl}`,
      };
    }
    return { task: "files", status: "FAILURE", reason: typedError.message };
  }
}
