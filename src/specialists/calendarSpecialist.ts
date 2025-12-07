// src/specialists/calendarSpecialist.ts
import * as googleService from "../services/googleService"; // Importa a nova função deleteEventsByTerm
import * as aiService from "../services/aiService";
import { UserContext } from "../services/types";

interface EventData {
  summary: string;
  description?: string;
  start: string;
  end: string;
  attendees?: string[];
  recurrence_freq?: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | "";
  recurrence_count?: number;

  // CAMPOS PARA CANCELAMENTO (para a IA devolver)
  event_id?: string; // Termo de busca para cancelar/deletar
  cancel?: boolean;
}

type EventList = EventData[];

export async function calendarSpecialist(
  context: UserContext
): Promise<string> {
  const { waId, fullMessage } = context;

  const extractionPrompt = `
        Você é um Extrator de Eventos. Sua tarefa é extrair os detalhes de agendamento OU cancelamento.
        Converta TODAS as datas/horas para o formato ISO 8601 (yyyy-MM-ddTHH:mm:ss-03:00) usando a DATA ATUAL fornecida.
        
        ### REGRAS CRÍTICAS ###
        1. RECORRÊNCIA: Se for recorrência (Ex: "todos os dias"), use 'recurrence_freq' (DAILY, WEEKLY, etc.) e 'recurrence_count' (o número TOTAL de vezes).
        2. CANCELAMENTO: Se a intenção for "cancelar", a ÚNICA CHAVE que o objeto deve ter é 'event_id' (com o termo de busca).

        Retorne APENAS um ARRAY JSON de objetos.
        Exemplo (Agendamento): [ {"summary": "Reuniao", "start": "...", "end": "...", "recurrence_freq": "DAILY", "recurrence_count": 731} ]
        Exemplo (Cancelamento): [ {"event_id": "Reuniao com Pedro"} ]
    `;

  try {
    const jsonString = await aiService.extractData(
      extractionPrompt,
      fullMessage
    );
    const events: EventList = JSON.parse(jsonString);

    if (!events || events.length === 0) return "";

    // --- 1. DETECÇÃO DE CANCELAMENTO ---
    const firstItem = events[0];
    if (firstItem && (firstItem.event_id || firstItem.cancel)) {
      const searchTerm = firstItem.event_id as string;

      // CHAMA A NOVA FUNÇÃO DE DELEÇÃO EM LOTE POR TERMO
      const deletedCount = await googleService.deleteEventsByTerm(
        waId,
        searchTerm
      );

      if (deletedCount > 0) {
        return `✅ ${deletedCount} eventos com o termo: *${searchTerm}* foram cancelados com sucesso.`;
      }
      return `❌ Não encontrei nenhum evento para cancelar com o termo: *${searchTerm}*.`;
    }

    // --- 2. EXECUÇÃO DO AGENDAMENTO (PARA CADA ITEM) ---
    const successMessages: string[] = [];

    for (const event of events) {
      if (!event.summary || !event.start || !event.end) continue;

      const eventResult = await googleService.createEvent(waId, event);

      const dateFormatted = new Date(event.start).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      });
      const recurrenceNote = event.recurrence_freq
        ? ` (Repetição: *${event.recurrence_freq}*)`
        : "";

      successMessages.push(
        `✅ Evento agendado! *${event.summary}* para ${dateFormatted}${recurrenceNote}.`
      );
    }

    if (successMessages.length === 0) {
      return "❌ Não consegui agendar nenhum evento. Verifique os horários, datas e nomes.";
    }

    return successMessages.join("\n\n");
  } catch (error) {
    const typedError = error as any;

    if (typedError.message && typedError.message.includes("AUTH_REQUIRED")) {
      const authUrl = googleService.getAuthUrl(waId);
      return `*Parece que preciso da sua permissão para acessar sua agenda do Google.* Por favor, clique no link abaixo para autorizar: ${authUrl}`;
    }

    console.error("Erro Crítico no Calendar Specialist:", typedError);
    return "❌ Ocorreu um erro ao agendar o evento. Verifique a conexão com o Google ou se o formato da sua mensagem está correto.";
  }
}
