// src/specialists/calendarSpecialist.ts
import * as googleService from "../services/googleService";
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
  event_id?: string;
  cancel?: boolean;
}

type EventList = EventData[];

export async function calendarSpecialist(context: UserContext): Promise<any> {
  // RETORNA ANY (JSON)
  const { waId, fullMessage } = context;

  const extractionPrompt = `
        Você é um Extrator de Eventos. Sua tarefa é extrair os detalhes de agendamento OU cancelamento.
        Converta TODAS as datas/horas para o formato ISO 8601 (yyyy-MM-ddTHH:mm:ss-03:00) usando a DATA ATUAL fornecida.
        
        ### REGRAS CRÍTICAS ###
        1. RECORRÊNCIA: Use 'recurrence_freq' e 'recurrence_count'.
        2. CANCELAMENTO: Se a intenção for "cancelar", a ÚNICA CHAVE que o objeto deve ter é 'event_id' (com o termo de busca).

        Retorne APENAS um ARRAY JSON de objetos.
    `;

  try {
    const jsonString = await aiService.extractData(
      extractionPrompt,
      fullMessage
    );
    const events: EventList = JSON.parse(jsonString);

    if (!events || events.length === 0)
      return { task: "calendar", status: "NOT_APPLICABLE" };

    // --- 1. DETECÇÃO DE CANCELAMENTO ---
    const firstItem = events[0];
    if (firstItem && (firstItem.event_id || firstItem.cancel)) {
      const searchTerm = firstItem.event_id as string;

      const deletedCount = await googleService.deleteEventsByTerm(
        waId,
        searchTerm
      );

      if (deletedCount > 0) {
        return {
          task: "calendar",
          status: "SUCCESS",
          action: "delete",
          deleted_count: deletedCount,
          search_term: searchTerm,
        };
      }
      // Retorna falha específica
      return {
        task: "calendar",
        status: "FAILURE",
        action: "delete",
        reason: `Nenhum evento encontrado com o termo: ${searchTerm}`,
      };
    }

    // --- 2. EXECUÇÃO DO AGENDAMENTO (PARA CADA ITEM) ---
    const scheduledEvents = [];
    let authRequired = false;

    for (const event of events) {
      if (!event.summary || !event.start || !event.end) continue;

      try {
        const eventResult = await googleService.createEvent(waId, event);
        scheduledEvents.push({
          summary: event.summary,
          start: event.start,
          link: eventResult.link,
        });
      } catch (e) {
        if ((e as any).message.includes("AUTH_REQUIRED")) {
          authRequired = true;
          break;
        }
        throw e; // Propaga outros erros
      }
    }

    if (authRequired) {
      const authUrl = googleService.getAuthUrl(waId);
      return {
        task: "calendar",
        status: "FAILURE",
        reason: "AUTH_REQUIRED",
        detail: `*Parece que preciso da sua permissão para acessar sua agenda do Google.* Por favor, clique no link abaixo para autorizar: ${authUrl}`,
      };
    }

    if (scheduledEvents.length === 0) {
      return {
        task: "calendar",
        status: "FAILURE",
        reason: "Nenhuma extração válida para agendamento.",
      };
    }

    return {
      task: "calendar",
      status: "SUCCESS",
      action: "schedule",
      events: scheduledEvents,
    };
  } catch (error) {
    return {
      task: "calendar",
      status: "FAILURE",
      reason: (error as any).message,
    };
  }
}
