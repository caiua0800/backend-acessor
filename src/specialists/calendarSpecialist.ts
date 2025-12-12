// src/specialists/calendarSpecialist.ts
import * as googleService from "../services/googleService";
import * as notificationService from "../services/notificationService";
import * as aiService from "../services/aiService";
import * as memoryService from "../services/memoryService";
import * as whatsappService from "../services/whatsappService";
import { pool } from "../db";
import { UserContext } from "../services/types";
import moment from "moment-timezone";

// ============================================================================
// 1. INTERFACES DE DADOS
// ============================================================================

interface EventData {
  summary: string;
  description?: string;
  start: string;
  end: string;
  attendees?: string[];
  recurrence_freq?: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | "";
  recurrence_count?: number;
}
interface CreateEventIntent extends EventData {
  intent: "create_event" | "add_event";
}
interface ListData {
  list_all: boolean;
}
interface ListDateData {
  intent: "list_events";
  date: string;
}
interface DeleteData {
  search_term?: string;
  delete: boolean;
  start_date?: string;
  end_date?: string;
}
interface CheckData {
  check_availability: boolean;
  start: string;
  end: string;
}
interface ReminderData {
  intent: "add_reminder";
  search_term: string;
  offset_minutes?: number;
}
interface SyncData {
  sync_calendar: boolean;
}
interface CountData {
  intent: "count_events";
  search_term: string;
  year?: number;
}
interface ConfirmReminderData {
  intent: "confirm_reminder";
  search_term?: string;
}

type CalendarExtractionData =
  | EventData[]
  | CreateEventIntent
  | ListData
  | ListDateData
  | DeleteData
  | CheckData
  | ReminderData
  | SyncData
  | CountData
  | ConfirmReminderData;

// ============================================================================
// 2. HELPERS
// ============================================================================

const getUserId = async (waId: string) => {
  const res = await pool.query("SELECT id FROM users WHERE phone_number = $1", [
    waId,
  ]);
  return res.rows[0]?.id;
};

function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function cleanJsonOutput(rawOutput: string): string {
  const start = rawOutput.indexOf("{");
  const end = rawOutput.lastIndexOf("}");
  const arrayStart = rawOutput.indexOf("[");
  const arrayEnd = rawOutput.lastIndexOf("]");

  if (arrayStart !== -1 && (start === -1 || arrayStart < start)) {
    if (arrayEnd !== -1) return rawOutput.substring(arrayStart, arrayEnd + 1);
  }
  if (start !== -1 && end !== -1) return rawOutput.substring(start, end + 1);
  return rawOutput;
}

// --- FUNÇÃO ATUALIZADA PARA TIMEZONE ---
function parseEventDates(
  data: any,
  userTimezone: string
): { start: string; end: string } {
  let startIso = data.start;
  let endIso = data.end;

  // Caso 1: A IA extraiu data e hora separadas (Ex: "2025-12-11" e "14:30")
  if (!startIso && data.date && data.time) {
    const cleanTime = data.time.replace(/ -0[0-9]:00/, "").trim();
    const dateTimeStr = `${data.date}T${cleanTime}:00`;

    // Interpreta a string como sendo do fuso do usuário
    startIso = moment.tz(dateTimeStr, userTimezone).format();
  }

  // Caso 2: A IA extraiu um datetime completo
  if (!startIso && data.datetime) {
    startIso = moment.tz(data.datetime, userTimezone).format();
  }

  // Se temos o início mas não o fim, definimos 1 hora de duração padrão
  if (startIso && !endIso) {
    endIso = moment(startIso).add(1, "hour").format();
  }
  return { start: startIso, end: endIso };
}

function findEventByKeywords(searchTerm: string, events: any[]): any {
  const normalizedSearch = normalizeString(searchTerm);
  const stopWords = [
    "de",
    "da",
    "do",
    "com",
    "o",
    "a",
    "em",
    "no",
    "na",
    "para",
    "pra",
    "reuniao",
    "reunião",
  ];
  const searchTokens = normalizedSearch
    .split(" ")
    .filter((token) => !stopWords.includes(token) && token.length > 2);
  if (searchTokens.length === 0) return null;
  return events.find((e: any) => {
    const title = normalizeString(e.summary);
    return searchTokens.every((token) => title.includes(token));
  });
}

async function findBestEventMatch(
  userMessage: string,
  failedTerm: string,
  availableEvents: any[]
): Promise<string | null> {
  if (availableEvents.length === 0) return null;
  const eventsListStr = availableEvents
    .slice(0, 50)
    .map((e) => `- "${e.summary}" (Dia: ${new Date(e.start).getDate()})`)
    .join("\n");
  const prompt = `Matcher de Agenda. FALHOU: "${failedTerm}". MSG: "${userMessage}". LISTA: ${eventsListStr}. Qual o correto? JSON: {"found": true, "exact_summary": "..."}`;
  try {
    const rawJson = await aiService.extractData(prompt, userMessage);
    const result = JSON.parse(cleanJsonOutput(rawJson));
    if (result.found && result.exact_summary) return result.exact_summary;
    return null;
  } catch (e) {
    return null;
  }
}

async function semanticCount(
  userMessage: string,
  searchTerm: string,
  year: number,
  userId: string
): Promise<{ count: number; reason: string }> {
  const res = await pool.query(
    `SELECT DISTINCT summary FROM local_calendar_events WHERE user_id = $1 AND EXTRACT(YEAR FROM start_time) = $2 LIMIT 100`,
    [userId, year]
  );
  if (res.rows.length === 0) return { count: 0, reason: "Vazia" };
  const eventList = res.rows.map((r) => r.summary).join(", ");
  const prompt = `Analista. Termo: "${searchTerm}". Lista: [${eventList}]. Quais batem? JSON: { "matched_terms": ["A", "B"] }`;
  try {
    const raw = await aiService.extractData(prompt, userMessage);
    const result = JSON.parse(cleanJsonOutput(raw));
    if (result.matched_terms?.length > 0) {
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM local_calendar_events WHERE user_id = $1 AND EXTRACT(YEAR FROM start_time) = $2 AND summary = ANY($3)`,
        [userId, year, result.matched_terms]
      );
      return {
        count: parseInt(countRes.rows[0].count),
        reason: `(IA: ${result.matched_terms})`,
      };
    }
    return { count: 0, reason: "" };
  } catch {
    return { count: 0, reason: "" };
  }
}

// ============================================================================
// 3. FUNÇÃO PRINCIPAL
// ============================================================================

export async function calendarSpecialist(
  context: UserContext
): Promise<string> {
  const { waId, fullMessage, userConfig } = context;
  console.log("🚀 [CALENDAR SPECIALIST] Iniciado.", fullMessage);

  // 1. PEGA O TIMEZONE (Com Fallback para SP)
  const userTz = userConfig.timezone || "America/Sao_Paulo";

  // 2. GERA HORA ATUAL BASEADA NO FUSO DO USUÁRIO
  const userCurrentTime = moment().tz(userTz).format("YYYY-MM-DD HH:mm:ss Z");

  const recentHistory = await memoryService.loadRecentHistory(waId, 3);
  const currentYear = new Date().getFullYear();

  const extractionPrompt = `
    Extrator de Agenda.
    DATA/HORA ATUAL DO USUÁRIO: ${userCurrentTime}
    FUSO HORÁRIO: ${userTz}
    HISTÓRICO RECENTE: ${recentHistory}
    
    INTENÇÕES:
    1. AGENDAR / CRIAR ("add_event"):
       - Frases: "Marcar reunião", "Agendar médico", "Me lembra amanhã de acordar".
       - REGRA CRÍTICA: Se o usuário diz "Me lembra [futuro] de [ação]", isso é CRIAR evento, NÃO buscar.
       - JSON: {"intent": "add_event", "summary": "Título", "date": "YYYY-MM-DD", "time": "HH:mm"}
       
    2. SINCRONIZAR: "Integrar agenda". -> {"sync_calendar": true}
    3. CONTAR: "Quantas reuniões?". -> {"intent": "count_events", "search_term": "...", "year": 2025}
    
    4. CONFIGURAR LEMBRETE EM EVENTO JÁ EXISTENTE ("add_reminder"):
       - Frases: "Põe um alerta na reunião das 10", "Me avisa 15min antes do dentista".
       - Use APENAS se for para adicionar notificação a algo que JÁ EXISTE.
       - JSON: {"intent": "add_reminder", "search_term": "X", "offset_minutes": 15}
       
    5. CONFIRMAR OFERTA DE LEMBRETE ANTERIOR ("confirm_reminder"):
       - Se o usuário respondeu SIM/QUERO/MANDA à *oferta de lembrete* feita pelo assistente.
       - JSON: {"intent": "confirm_reminder"}
       
    6. LISTAR, CANCELAR, CHECAR (Padrão)
    
    Retorne APENAS o JSON.
  `;

  try {
    const jsonString = await aiService.extractData(
      extractionPrompt,
      fullMessage
    );
    console.log("🤖 [CALENDAR RAW]:", jsonString);
    const data: any = JSON.parse(cleanJsonOutput(jsonString));
    console.log("✅ [CALENDAR DATA]:", JSON.stringify(data));

    let actionConfirmedMessage = "";
    let offerReminder = false;
    const userId = await getUserId(waId);

    // 0. AGENDAR
    if (
      Array.isArray(data) ||
      data.intent === "create_event" ||
      data.intent === "add_event"
    ) {
      const eventsToCreate = Array.isArray(data) ? data : [data];
      const scheduledEvents = [];
      const wantsReminder = fullMessage
        .toLowerCase()
        .match(/(lembre|avise|notifique|alerta)/);

      for (const rawEvent of eventsToCreate) {
        const summary = rawEvent.summary || rawEvent.title;

        // --- CORREÇÃO: PASSANDO O FUSO DO USUÁRIO ---
        const dates = parseEventDates(rawEvent, userTz);

        if (!summary || !dates.start) continue;

        try {
          // Chama o serviço (passando timeZone para o Google)
          const result = await googleService.createEvent(waId, {
            summary,
            description: rawEvent.description || "Agendado via WhatsApp",
            start: dates.start,
            end: dates.end,
            attendees: rawEvent.attendees,
            timeZone: userTz, // <--- Importante para o Google Calendar
          });

          // --- FORMATAÇÃO DA RESPOSTA COM LINK ---
          let details = `🔗 Agenda: ${result.link}`;
          if (result.meetLink) {
            details += `\n📹 **Google Meet:** ${result.meetLink}`;
          }

          // Formata a data de exibição usando o fuso do usuário também
          const displayDate = moment(dates.start)
            .tz(userTz)
            .format("DD/MM HH:mm");

          scheduledEvents.push(
            `✅ *${summary}*\n🕒 ${displayDate}\n${details}`
          );

          // Notificação
          if (userId) {
            if (wantsReminder) {
              const reminderTime = new Date(
                new Date(dates.start).getTime() - 15 * 60000
              );
              await notificationService.scheduleNotification(
                userId,
                `📅 Lembrete: "${summary}"`,
                reminderTime
              );
            } else {
              offerReminder = true;
            }
          }
        } catch (e: any) {
          throw new Error(`Falha ao agendar: ${e.message}`);
        }
      }

      if (scheduledEvents.length > 0) {
        actionConfirmedMessage = `Agendamento realizado com sucesso!\n\n${scheduledEvents.join(
          "\n\n"
        )}`;
      }
    }

    // 1. CONFIRMAR LEMBRETE PENDENTE
    else if (data.intent === "confirm_reminder") {
      const events = await googleService.listEvents(waId);

      // Encontra o evento futuro mais recente
      const lastEvent = events.find((e: any) =>
        moment(e.start).isAfter(moment())
      );

      if (lastEvent && lastEvent.start && userId) {
        const time = new Date(lastEvent.start);
        const min = 15; // Padrão 15 minutos

        await notificationService.scheduleNotification(
          userId,
          `📅 Lembrete (Confirmação): "${lastEvent.summary}"`,
          new Date(time.getTime() - min * 60000)
        );

        actionConfirmedMessage = `Combinado, ${userConfig.user_nickname}! Lembrete agendado para *${lastEvent.summary}* 15 minutos antes!`;
      } else {
        actionConfirmedMessage =
          "Não achei um evento recente para configurar o lembrete. Qual evento você quer que eu te lembre?";
      }
    }

    // 2. SINCRONIZAR
    else if (data.sync_calendar) {
      try {
        await whatsappService.sendTextMessage(waId, "⏳ Sincronizando...");
        const count = await googleService.syncFullCalendar(waId);
        actionConfirmedMessage = `✅ Sincronizado! ${count} eventos.`;
      } catch (e: any) {
        if (e.message.includes("AUTH"))
          return `Preciso de permissão: ${googleService.getAuthUrl(waId)}`;
        throw e;
      }
    }

    // 3. LISTAR POR DATA
    else if (data.intent === "list_events" && data.date) {
      const ev = await googleService.listEventsByDate(waId, data.date);
      actionConfirmedMessage = ev.length
        ? `📅 **Agenda ${moment(data.date).format("DD/MM")}**:\n\n${ev
            .map(
              (e: any) =>
                `• ${moment(e.start).tz(userTz).format("HH:mm")} - ${e.summary}`
            )
            .join("\n")}`
        : `Nada agendado para ${moment(data.date).format("DD/MM")}.`;
    }

    // 4. CONTAR
    else if (data.intent === "count_events") {
      let count = await googleService.countEvents(
        waId,
        data.search_term,
        data.year || currentYear
      );
      let reason = "";
      if (count === 0 && userId) {
        const sem = await semanticCount(
          fullMessage,
          data.search_term,
          data.year || currentYear,
          userId
        );
        count = sem.count;
        reason = sem.reason;
      }
      actionConfirmedMessage =
        count > 0
          ? `Encontrei **${count}** eventos. ${reason}`
          : "Nenhum evento encontrado.";
    }

    // 5. LEMBRETE
    else if (data.intent === "add_reminder") {
      const events = await googleService.listEvents(waId);
      if (!events.length) return "Agenda vazia.";
      let target = findEventByKeywords(data.search_term, events);
      if (!target) {
        const match = await findBestEventMatch(
          fullMessage,
          data.search_term,
          events
        );
        if (match) target = events.find((e: any) => e.summary === match);
      }

      if (target && target.start && userId) {
        const time = new Date(target.start);
        if (time < new Date()) actionConfirmedMessage = "Evento já passou.";
        else {
          const min = data.offset_minutes || 15;
          await notificationService.scheduleNotification(
            userId,
            `📅 Lembrete: "${target.summary}"`,
            new Date(time.getTime() - min * 60000)
          );
          actionConfirmedMessage = `✅ Aviso agendado para "${target.summary}"!`;
        }
      } else {
        actionConfirmedMessage = `Não achei nada agendado como "${data.search_term}" para colocar alerta. Quer que eu agende isso como um novo compromisso?`;
      }
    }

    // 6. DELETAR
    else if (data.delete) {
      const count = await googleService.deleteEvents(
        waId,
        data.search_term,
        data.start_date,
        data.end_date
      );
      actionConfirmedMessage =
        count > 0 ? `Cancelei ${count} evento(s).` : "Não achei eventos.";
    }

    // 7. LISTAR TUDO
    else if (data.list_all) {
      const ev = await googleService.listEvents(waId);
      actionConfirmedMessage = ev.length
        ? `Próximos:\n${ev
            .map(
              (e: any) =>
                `• ${e.summary} (${moment(e.start)
                  .tz(userTz)
                  .format("DD/MM HH:mm")})`
            )
            .join("\n")}`
        : "Agenda vazia.";
    }

    // 8. CHECAR
    else if (data.check_availability) {
      const ev = await googleService.checkAvailability(
        waId,
        data.start,
        data.end
      );
      actionConfirmedMessage = ev.length
        ? `Ocupado! Conflitos:\n${ev.map((e: any) => e.summary).join(", ")}`
        : "Livre!";
    }

    if (!actionConfirmedMessage) {
      return "";
    }

    let systemInstruction = `Responda amigavelmente: "${actionConfirmedMessage}"`;
    if (offerReminder) {
      systemInstruction += `\n\n### IMPORTANTE ###\nAdicione ao final: "Quer que eu te mande um lembrete no WhatsApp 15 minutos antes pra garantir?"`;
    }

    return await aiService.generatePersonaResponse(
      systemInstruction,
      fullMessage,
      userConfig
    );
  } catch (error: any) {
    console.error("❌ [CALENDAR ERROR]", error);

    const errorMessage = error.message || "";

    // Verifica se é erro de falta de conta vinculada OU erro de permissões insuficientes (scopes)
    const isAuthError =
      errorMessage.includes("AUTH_REQUIRED") ||
      errorMessage.includes("insufficient authentication scopes") ||
      errorMessage.includes("invalid_grant");

    if (isAuthError) {
      const url = googleService.getAuthUrl(waId);

      // Retornamos uma mensagem direta que solicita a permissão, incluindo o link.
      // Isso ignora a tentativa da IA de explicar o erro técnico.
      return `⚠️ *Atenção:* Notei que sua integração com o Google precisa de uma renovação de permissões para eu conseguir agendar seus eventos.

        Clique no link abaixo para autorizar o acesso completo (Agenda, Docs e Planilhas):
        ${url}

        Após autorizar, você pode me pedir para agendar o compromisso novamente! 🚀`;
            }

    return `Erro na agenda: ${error.message}`;
  }
}
