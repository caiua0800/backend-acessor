// src/specialists/ideasSpecialist.ts
import * as ideaService from "../services/ideaService";
import * as aiService from "../services/aiService";
import { UserContext } from "../services/types";

interface IdeaData {
  content: string;
  tags: string;
}

export async function ideasSpecialist(context: UserContext): Promise<any> {
  // RETORNA ANY (JSON)
  const { waId, fullMessage } = context;

  const extractionPrompt = `
        Você é um Extrator de Ideias. Extraia o conteúdo da ideia e gere de 1 a 3 tags relevantes.
        Retorne APENAS o JSON no formato: {"content": "O texto da ideia", "tags": "tag1, tag2"}.
    `;

  try {
    const jsonString = await aiService.extractData(
      extractionPrompt,
      fullMessage
    );
    const ideaData: IdeaData = JSON.parse(jsonString);

    if (!ideaData.content || ideaData.content.length < 5)
      return { task: "ideas", status: "NOT_APPLICABLE" };

    const tagsArray = ideaData.tags.split(",").map((tag) => tag.trim());
    const newIdea = await ideaService.createIdea(
      waId,
      ideaData.content,
      tagsArray
    );

    // Retorno Técnico de SUCESSO
    return {
      task: "ideas",
      status: "SUCCESS",
      action: "create",
      content_snippet: newIdea.idea_content.substring(0, 50),
      tags: tagsArray,
    };
  } catch (error) {
    // Retorno Técnico de FALHA
    return {
      task: "ideas",
      status: "FAILURE",
      reason: (error as any).message,
    };
  }
}
