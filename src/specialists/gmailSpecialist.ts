// src/specialists/gmailSpecialist.ts
import * as googleService from '../services/googleService';
import * as aiService from '../services/aiService';
import { UserContext } from '../services/types';

export async function gmailSpecialist(context: UserContext): Promise<string> {
    const { waId, fullMessage } = context;

    const extractionPrompt = `
        Você é um Extrator de Query de E-mail. Sua única tarefa é extrair a intenção de busca (ex: 'hoje', 'da Amazon').
        Retorne APENAS a string de busca mais adequada para o Gmail (Ex: "newer_than:1d AND from:amazon").
    `;
    
    try {
        const query = await aiService.extractData(extractionPrompt, fullMessage);
        
        if (!query || query.length < 3) return ""; 

        const emails = await googleService.listEmails(waId, query);
        
        if (emails.length === 0) return "📧 Não encontrei e-mails que correspondam à sua busca.";

        // Formatação da lista de e-mails para o Summarizer
        const summary = emails.slice(0, 3).map((e, index) => 
            `[${index + 1}] De: ${e.from} - Assunto: ${e.subject}`
        ).join('\n');
        
        return `📧 Encontrei ${emails.length} e-mails. Os 3 mais recentes são:\n${summary}`;

    } catch (error: any) {
        if (error.message.includes("AUTH_REQUIRED")) {
            const authUrl = googleService.getAuthUrl(waId);
            return `*Preciso de permissão para ler seus e-mails.* Autorize aqui:\n${authUrl}`;
        }
        return "❌ Ocorreu um erro ao buscar seus e-mails.";
    }
}