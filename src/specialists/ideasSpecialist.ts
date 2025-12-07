// src/specialists/ideasSpecialist.ts
import * as ideaService from '../services/ideaService';
import * as aiService from '../services/aiService';
import { UserContext } from '../services/types';

interface IdeaData { content: string; tags: string; }

export async function ideasSpecialist(context: UserContext): Promise<string> {
    const { waId, fullMessage } = context;
    
    const extractionPrompt = `
        Você é um Extrator de Ideias. Extraia o conteúdo da ideia e gere de 1 a 3 tags relevantes.
        Retorne APENAS o JSON no formato: {"content": "O texto da ideia", "tags": "tag1, tag2"}.
    `;

    try {
        const jsonString = await aiService.extractData(extractionPrompt, fullMessage);
        const ideaData: IdeaData = JSON.parse(jsonString);

        if (!ideaData.content || ideaData.content.length < 5) return ""; 

        const tagsArray = ideaData.tags.split(',').map(tag => tag.trim());
        const newIdea = await ideaService.createIdea(waId, ideaData.content, tagsArray);
        
        const tagsFormatted = tagsArray.length > 0 ? ` (Tags: ${tagsArray.join(', ')})` : '';
        
        return `✨ Ideia salva: ${newIdea.idea_content.substring(0, 50)}...${tagsFormatted}`;

    } catch (error) {
        return "❌ Ocorreu um erro ao salvar sua ideia ou anotação.";
    }
}