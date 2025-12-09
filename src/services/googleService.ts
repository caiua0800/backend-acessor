import { google } from "googleapis";
import { pool } from "../db";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import moment from "moment-timezone";

const TIME_ZONE = "America/Sao_Paulo";

// ============================================================================
// 🔐 AUTENTICAÇÃO E OAUTH2
// ============================================================================
const DEFAULT_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
// URL Específica para o Cadastro (troca de CODE por TOKEN)
const REGISTRATION_REDIRECT_URI = process.env.GOOGLE_REG_REDIRECT_URI; 

// const createOAuthClient = () => {
//   return new google.auth.OAuth2(
//     process.env.GOOGLE_CLIENT_ID,
//     process.env.GOOGLE_CLIENT_SECRET,
//     process.env.GOOGLE_REDIRECT_URI
//   );
// };
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

const createOAuthClient = (redirectUri?: string) => {
  return new google.auth.OAuth2(
    CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri || DEFAULT_REDIRECT_URI 
  );
};

export const getGoogleAuthUrlRegistration = (state: string) => {
  const oauth2Client = createOAuthClient(REGISTRATION_REDIRECT_URI); // <--- USA A URL DE CADASTRO
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
    state: state,
  });
};

/**
 * Valida o ID Token do Google e retorna o e-mail do usuário.
 * @param idToken O token JWT emitido pelo Google após o login.
 * @returns O e-mail verificado do usuário.
 */
export const verifyGoogleIdToken = async (idToken: string): Promise<string> => {
  // Usamos a biblioteca google-auth-library para verificar o token
  // Nota: A função getAuthenticatedClient usa a mesma biblioteca, mas em outro contexto
  const client = new google.auth.OAuth2(CLIENT_ID);
  
  try {
      const ticket = await client.verifyIdToken({
          idToken: idToken,
          audience: CLIENT_ID, // Deve bater com o seu Client ID
      });
      
      const payload = ticket.getPayload();
      
      if (!payload || !payload.email || !payload.email_verified) {
          throw new Error("Token do Google inválido ou e-mail não verificado.");
      }
      
      return payload.email.toLowerCase(); // Retorna o e-mail normalizado

  } catch (e: any) {
      console.error("❌ Erro ao verificar Google ID Token:", e.message);
      throw new Error("Falha na autenticação com o Google.");
  }
};


// --- HELPER CRÍTICO: Retorna Cliente, ID do Usuário e TOKEN DE SYNC ---
const getAuthenticatedClient = async (whatsappId: string) => {
  const res = await pool.query(
    `SELECT i.google_refresh_token, i.google_calendar_sync_token, u.id as user_id 
     FROM user_integrations i 
     JOIN users u ON u.id = i.user_id 
     WHERE u.phone_number = $1`,
    [whatsappId]
  );

  if (res.rows.length === 0 || !res.rows[0].google_refresh_token) {
    throw new Error("AUTH_REQUIRED");
  }

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    refresh_token: res.rows[0].google_refresh_token,
  });

  try {
    const tokenInfo = await oauth2Client.getAccessToken();
    if (!tokenInfo.token) throw new Error("Falha na renovação do token");
  } catch (error) {
    console.error("Erro ao renovar token Google:", error);
    throw new Error("AUTH_REQUIRED");
  }

  return {
    client: oauth2Client,
    userId: res.rows[0].user_id,
    syncToken: res.rows[0].google_calendar_sync_token,
  };
};

export const getAuthUrl = (whatsappId: string) => {
  const oauth2Client = createOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
    state: whatsappId,
  });
};

export const getGoogleAuthUrl = (state: string) => { // <--- CORREÇÃO AQUI
  const oauth2Client = createOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
    state: state,
  });
};

export const handleGoogleCallbackForRegistration = async (code: string) => {
  const oauth2Client = createOAuthClient(REGISTRATION_REDIRECT_URI); // <--- USA A URL DE CADASTRO
  
  try {
      const { tokens } = await oauth2Client.getToken(code);
      if (!tokens.refresh_token) throw new Error("O Google não forneceu um Refresh Token.");
      return { refreshToken: tokens.refresh_token };
  } catch (error) {
      throw error;
  }
};

export const handleCallback = async (code: string, whatsappId: string) => {
  const oauth2Client = createOAuthClient();
  const cleanWaId = whatsappId.trim().replace(/\D/g, "");

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (tokens.refresh_token) {
      const userRes = await pool.query(
        `SELECT id FROM users WHERE phone_number = $1 OR phone_number = $2`,
        [whatsappId, cleanWaId]
      );

      if (userRes.rows.length === 0) throw new Error("Usuário não encontrado.");

      await pool.query(
        `INSERT INTO user_integrations (user_id, google_refresh_token, google_home_connected, updated_at) 
           VALUES ($1, $2, TRUE, NOW()) 
           ON CONFLICT (user_id) 
           DO UPDATE SET 
              google_refresh_token = $2, 
              google_home_connected = TRUE,
              updated_at = NOW()`,
        [userRes.rows[0].id, tokens.refresh_token]
      );
      return "Integração Google realizada com sucesso! ✅";
    } else {
      return "O Google não enviou o token. Tente novamente.";
    }
  } catch (error: any) {
    console.error("Erro no Callback Google:", error);
    return "Erro ao processar login do Google.";
  }
};

// ============================================================================
// 🔄 SINCRONIZAÇÃO INTELIGENTE (CORE DO SISTEMA)
// ============================================================================

async function saveGoogleEventToDb(userId: string, ev: any) {
  if (!ev.summary) return;
  const start = ev.start?.dateTime || ev.start?.date;
  const end = ev.end?.dateTime || ev.end?.date;
  if (!start || !end) return;

  await pool.query(
    `INSERT INTO local_calendar_events 
         (user_id, google_event_id, summary, start_time, end_time, meet_link, attendees, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (google_event_id) 
         DO UPDATE SET
            summary = EXCLUDED.summary,
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time,
            meet_link = EXCLUDED.meet_link,
            attendees = EXCLUDED.attendees,
            updated_at = NOW()`,
    [
      userId,
      ev.id,
      ev.summary,
      start,
      end,
      ev.htmlLink,
      JSON.stringify(ev.attendees || []),
    ]
  );
}

async function removeGoogleEventFromDb(userId: string, googleId: string) {
  await pool.query(
    `DELETE FROM local_calendar_events WHERE user_id = $1 AND google_event_id = $2`,
    [userId, googleId]
  );
}

export const syncCalendar = async (whatsappId: string): Promise<number> => {
  const { client, userId, syncToken } = await getAuthenticatedClient(
    whatsappId
  );
  const calendar = google.calendar({ version: "v3", auth: client });

  let nextSyncToken = syncToken;
  let pageToken: string | undefined = undefined;
  let operationCount = 0;

  try {
    const isFullSync = !syncToken;
    // console.log(`🔄 [SYNC] Iniciando sincronização ${isFullSync ? 'COMPLETA' : 'INCREMENTAL'}...`);

    do {
      const listParams: any = {
        calendarId: "primary",
        singleEvents: true,
        maxResults: 2500,
        pageToken: pageToken,
      };

      if (syncToken) {
        listParams.syncToken = syncToken;
      } else {
        listParams.timeMin = new Date(
          new Date().getFullYear(),
          0,
          1
        ).toISOString();
      }

      const response: any = await calendar.events.list(listParams);
      const items = response.data.items || [];

      // Processa em Paralelo
      const promises = items.map(async (ev: any) => {
        if (ev.status === "cancelled") {
          await removeGoogleEventFromDb(userId, ev.id);
        } else {
          await saveGoogleEventToDb(userId, ev);
        }
      });

      await Promise.all(promises);
      operationCount += items.length;
      pageToken = response.data.nextPageToken;
      nextSyncToken = response.data.nextSyncToken;
    } while (pageToken);

    if (nextSyncToken) {
      await pool.query(
        `UPDATE user_integrations SET google_calendar_sync_token = $1 WHERE user_id = $2`,
        [nextSyncToken, userId]
      );
    }

    if (operationCount > 0) {
      console.log(
        `✅ [SYNC] Atualizado! ${operationCount} mudanças processadas.`
      );
    }
    return operationCount;
  } catch (error: any) {
    if (error.code === 410) {
      console.warn("⚠️ [SYNC] Token expirado. Resetando...");
      await pool.query(
        `UPDATE user_integrations SET google_calendar_sync_token = NULL WHERE user_id = $1`,
        [userId]
      );
      return syncCalendar(whatsappId);
    }
    throw error;
  }
};

export const syncFullCalendar = syncCalendar; // Alias

// ============================================================================
// 📅 FUNÇÕES PÚBLICAS (USAM SYNC + BANCO LOCAL)
// ============================================================================

export const listEvents = async (whatsappId: string) => {
  await syncCalendar(whatsappId);
  const { userId } = await getAuthenticatedClient(whatsappId);

  const localRes = await pool.query(
    `SELECT id, summary, start_time, end_time 
     FROM local_calendar_events 
     WHERE user_id = $1 AND start_time >= NOW() 
     ORDER BY start_time ASC LIMIT 30`,
    [userId]
  );

  return localRes.rows.map((row) => ({
    id: row.id,
    summary: row.summary,
    start: row.start_time.toISOString(),
    end: row.end_time.toISOString(),
  }));
};

// --- A FUNÇÃO QUE ESTAVA FALTANDO ---
export const listEventsByDate = async (whatsappId: string, dateIso: string) => {
  await syncCalendar(whatsappId);
  const { userId } = await getAuthenticatedClient(whatsappId);

  // Usa moment para definir o intervalo do dia inteiro no fuso correto
  const startOfDay = moment(dateIso).tz(TIME_ZONE).startOf("day").toISOString();
  const endOfDay = moment(dateIso).tz(TIME_ZONE).endOf("day").toISOString();

  const localRes = await pool.query(
    `SELECT summary, start_time, end_time FROM local_calendar_events 
         WHERE user_id = $1 
         AND start_time >= $2 AND start_time <= $3
         ORDER BY start_time ASC`,
    [userId, startOfDay, endOfDay]
  );

  return localRes.rows.map((row) => ({
    summary: row.summary,
    start: row.start_time.toISOString(),
    end: row.end_time.toISOString(),
  }));
};

export const checkAvailability = async (
  whatsappId: string,
  start: string,
  end: string
) => {
  await syncCalendar(whatsappId);
  const { userId } = await getAuthenticatedClient(whatsappId);

  const localRes = await pool.query(
    `SELECT summary, start_time, end_time FROM local_calendar_events 
     WHERE user_id = $1 
     AND (start_time < $2 AND end_time > $1)`,
    [userId, start, end]
  );

  return localRes.rows.map((row) => ({
    summary: row.summary,
    start: { dateTime: row.start_time.toISOString() },
    end: { dateTime: row.end_time.toISOString() },
  }));
};

export const countEvents = async (
  whatsappId: string,
  searchTerm: string,
  year?: number
) => {
  const { userId } = await getAuthenticatedClient(whatsappId);
  const term = `%${searchTerm.trim()}%`;

  let query = `
    SELECT COUNT(*) 
    FROM local_calendar_events 
    WHERE user_id = $1 
    AND unaccent(summary) ILIKE unaccent($2)
  `;
  const params: any[] = [userId, term];

  if (year) {
    query += ` AND EXTRACT(YEAR FROM start_time) = $3`;
    params.push(year);
  }

  const res = await pool.query(query, params);
  return parseInt(res.rows[0].count, 10);
};

export const createEvent = async (
  whatsappId: string,
  eventDetails: {
    summary: string;
    description?: string;
    start: string;
    end: string;
    attendees?: string[];
    recurrence_freq?: string;
    recurrence_count?: number;
  }
) => {
  const { client, userId } = await getAuthenticatedClient(whatsappId);
  const calendar = google.calendar({ version: "v3", auth: client });

  let requestBody: any = {
    summary: eventDetails.summary,
    description: eventDetails.description,
    start: { dateTime: eventDetails.start, timeZone: TIME_ZONE },
    end: { dateTime: eventDetails.end, timeZone: TIME_ZONE },
    // CORREÇÃO: Força a criação do Meet para todos os eventos
    conferenceData: {
      createRequest: {
        requestId: uuidv4(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  if (eventDetails.recurrence_freq) {
    const freq = eventDetails.recurrence_freq.toUpperCase();
    const count = eventDetails.recurrence_count || 365;
    requestBody.recurrence = [`RRULE:FREQ=${freq};COUNT=${count}`];
  }

  if (eventDetails.attendees && eventDetails.attendees.length > 0) {
    requestBody.attendees = eventDetails.attendees.map((email) => ({ email }));
  }

  const event = await calendar.events.insert({
    calendarId: "primary",
    conferenceDataVersion: 1, // Essencial para o Meet
    requestBody,
  });

  await saveGoogleEventToDb(userId, event.data);

  return {
    link: event.data.htmlLink,
    meetLink: event.data.hangoutLink || null, // Pega o link do Meet
  };
};

export const deleteEvents = async (
  whatsappId: string,
  searchTerm?: string,
  timeMin?: string,
  timeMax?: string
): Promise<number> => {
  await syncCalendar(whatsappId);
  const { client, userId } = await getAuthenticatedClient(whatsappId);
  const calendar = google.calendar({ version: "v3", auth: client });

  let query = `SELECT google_event_id FROM local_calendar_events WHERE user_id = $1`;
  const params: any[] = [userId];

  if (searchTerm && searchTerm.toLowerCase() !== "tudo") {
    query += ` AND unaccent(summary) ILIKE unaccent($2)`;
    params.push(`%${searchTerm}%`);
  }
  if (timeMin) {
    query += ` AND start_time >= $${params.length + 1}`;
    params.push(timeMin);
  }

  const localEvents = await pool.query(query, params);
  if (localEvents.rows.length === 0) return 0;

  const deletePromises = localEvents.rows.map(async (row) => {
    try {
      await calendar.events.delete({
        calendarId: "primary",
        eventId: row.google_event_id,
      });
    } catch (e: any) {
      if (e.code !== 404 && e.code !== 410) throw e;
    }

    await removeGoogleEventFromDb(userId, row.google_event_id);
  });

  await Promise.all(deletePromises);
  return localEvents.rows.length;
};

export const deleteEvent = async (whatsappId: string, eventId: string) => {
  const { client, userId } = await getAuthenticatedClient(whatsappId);
  const calendar = google.calendar({ version: "v3", auth: client });

  try {
    await calendar.events.delete({ calendarId: "primary", eventId });
  } catch (e) {}
  await removeGoogleEventFromDb(userId, eventId);
  return true;
};

// ============================================================================
// 📂 ARQUIVOS, DOCS, SHEETS, GMAIL
// ============================================================================

const extractTextFromDoc = (content: any[]): string => {
  let text = "";
  content.forEach((e) => {
    if (e.paragraph)
      e.paragraph.elements.forEach((el: any) => {
        if (el.textRun) text += el.textRun.content;
      });
    else if (e.table) text += "[Tabela]\n";
  });
  return text;
};

export const createDoc = async (
  waId: string,
  title: string,
  content?: string
) => {
  const { client } = await getAuthenticatedClient(waId);
  const docs = google.docs({ version: "v1", auth: client });
  const res = await docs.documents.create({ requestBody: { title } });
  const docId = res.data.documentId!;
  if (content)
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [{ insertText: { location: { index: 1 }, text: content } }],
      },
    });
  return {
    id: docId,
    title,
    link: `https://docs.google.com/document/d/${docId}`,
  };
};
export const readDoc = async (waId: string, docId: string) => {
  const { client } = await getAuthenticatedClient(waId);
  const res = await google
    .docs({ version: "v1", auth: client })
    .documents.get({ documentId: docId });
  return {
    title: res.data.title,
    content: extractTextFromDoc(res.data.body?.content || []),
  };
};
export const appendToDoc = async (
  waId: string,
  docId: string,
  text: string
) => {
  const { client } = await getAuthenticatedClient(waId);
  const docs = google.docs({ version: "v1", auth: client });
  const doc = await docs.documents.get({ documentId: docId });
  const endIndex =
    doc.data.body?.content?.[doc.data.body.content.length - 1]?.endIndex || 1;
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: Math.max(1, endIndex - 1) },
            text: "\n" + text,
          },
        },
      ],
    },
  });
  return { message: "Adicionado." };
};
export const createSheet = async (waId: string, title: string) => {
  const { client } = await getAuthenticatedClient(waId);
  const res = await google
    .sheets({ version: "v4", auth: client })
    .spreadsheets.create({ requestBody: { properties: { title } } });
  return { id: res.data.spreadsheetId, title, link: res.data.spreadsheetUrl };
};
export const getSheetValues = async (
  waId: string,
  sheetId: string,
  range: string
) => {
  const { client } = await getAuthenticatedClient(waId);
  const res = await google
    .sheets({ version: "v4", auth: client })
    .spreadsheets.values.get({ spreadsheetId: sheetId, range });
  return { values: res.data.values || [] };
};
export const appendToSheet = async (
  waId: string,
  sheetId: string,
  values: string[]
) => {
  const { client } = await getAuthenticatedClient(waId);
  await google
    .sheets({ version: "v4", auth: client })
    .spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "A1",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] },
    });
  return { message: "Adicionado." };
};
export const listFiles = async (waId: string, query?: string) => {
  const { client } = await getAuthenticatedClient(waId);
  let q = "trashed = false";
  if (query) q += ` and name contains '${query}'`;
  const res = await google.drive({ version: "v3", auth: client }).files.list({
    q,
    pageSize: 10,
    fields: "files(id, name, mimeType, webViewLink)",
    orderBy: "createdTime desc",
  });
  return res.data.files || [];
};
export const deleteFile = async (waId: string, fileId: string) => {
  const { client } = await getAuthenticatedClient(waId);
  await google.drive({ version: "v3", auth: client }).files.delete({ fileId });
  return { message: "Deletado." };
};
export const uploadToDrive = async (
  waId: string,
  filePath: string,
  fileName: string
) => {
  const { client } = await getAuthenticatedClient(waId);
  const res = await google.drive({ version: "v3", auth: client }).files.create({
    requestBody: { name: fileName, parents: [] },
    media: { body: fs.createReadStream(filePath) },
    fields: "id, webViewLink",
  });
  return res.data.webViewLink;
};
export const listEmails = async (waId: string, query: string) => {
  const { client } = await getAuthenticatedClient(waId);
  const gmail = google.gmail({ version: "v1", auth: client });
  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: 5,
  });
  const msgs = res.data.messages || [];
  return Promise.all(
    msgs.map(async (m) => {
      const d = await gmail.users.messages.get({
        userId: "me",
        id: m.id!,
        format: "metadata",
      });
      const h = d.data.payload?.headers;
      return {
        id: m.id,
        from: h?.find((x) => x.name === "From")?.value,
        subject: h?.find((x) => x.name === "Subject")?.value,
        snippet: d.data.snippet,
      };
    })
  );
};
export const readEmail = async (waId: string, msgId: string) => {
  const { client } = await getAuthenticatedClient(waId);
  const res = await google
    .gmail({ version: "v1", auth: client })
    .users.messages.get({ userId: "me", id: msgId, format: "full" });
  const h = res.data.payload?.headers;
  const decode = (d: string) => Buffer.from(d, "base64").toString("utf-8");
  let body = "";
  if (res.data.payload?.body?.data) body = decode(res.data.payload.body.data);
  else if (res.data.payload?.parts)
    body = decode(
      res.data.payload.parts.find((p: any) => p.mimeType === "text/plain")?.body
        ?.data ||
        res.data.payload.parts[0].body?.data ||
        ""
    );
  return {
    id: res.data.id,
    from: h?.find((x) => x.name === "From")?.value,
    subject: h?.find((x) => x.name === "Subject")?.value,
    body: body.substring(0, 2000),
  };
};


export const getWhatsappIdFromUserId = async (userId: string): Promise<string> => {
  const res = await pool.query(
      "SELECT phone_number FROM users WHERE id = $1",
      [userId]
  );
  if (res.rows.length === 0) {
      throw new Error("Usuário não encontrado.");
  }
  return res.rows[0].phone_number;
};
