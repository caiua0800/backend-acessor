// src/specialists/fileManagerSpecialist.ts
import * as googleService from '../services/googleService';
import * as aiService from '../services/aiService';
import { UserContext } from '../services/types';

interface DocCreationData { title: string; content: string; }

export async function fileManagerSpecialist(context: UserContext): Promise<string> {
    const { waId, fullMessage } = context;

    // Focando na tarefa de maior probabilidade de acontecer: criar um doc.
    const extractionPrompt = `
        Você é um Extrator de Criação de Documentos. Sua única tarefa é extrair o título e o conteúdo de um novo documento a ser criado.
        Retorne APENAS o JSON no formato: {"title": "Titulo do Doc", "content": "Conteúdo inicial"}.
    `;
    
    try {
        const jsonString = await aiService.extractData(extractionPrompt, fullMessage);
        const docData: DocCreationData = JSON.parse(jsonString);

        if (!docData.title || docData.title.length < 5) return "";

        const docResult = await googleService.createDoc(waId, docData.title, docData.content);
        
        return `📝 Documento *${docResult.title}* criado. Link: ${docResult.link}`;

    } catch (error: any) {
        if (error.message.includes("AUTH_REQUIRED")) {
            const authUrl = googleService.getAuthUrl(waId);
            return `*Preciso de permissão para gerenciar seus arquivos.* Autorize aqui: ${authUrl}`;
        }
        return "❌ Ocorreu um erro ao criar o documento.";
    }
}