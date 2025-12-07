import { google } from "googleapis";
import { pool } from "../db";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";

// --- CONFIGURAÇÃO DO CLIENTE OAUTH2 ---
const createOAuthClient = () => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
};

// --- HELPER: OBTER CLIENTE AUTENTICADO (Reutilizável) ---
// Evita repetir a lógica de buscar no banco e montar o cliente em toda função
const getAuthenticatedClient = async (whatsappId: string) => {
  const res = await pool.query(
    `SELECT i.google_refresh_token 
     FROM user_integrations i 
     JOIN users u ON u.id = i.user_id 
     WHERE u.phone_number = $1`,
    [whatsappId]
  );

  if (res.rows.length === 0) throw new Error("AUTH_REQUIRED");

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    refresh_token: res.rows[0].google_refresh_token,
  });

  return oauth2Client;
};

// --- AUTH URL (ATUALIZADO COM TODOS OS ESCOPOS) ---
export const getAuthUrl = (whatsappId: string) => {
  const oauth2Client = createOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    // Força o Google a mandar refresh_token novo mesmo se já tiver conectado antes
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/calendar", // Agenda
      "https://www.googleapis.com/auth/gmail.readonly", // Ler E-mails
      "https://www.googleapis.com/auth/drive", // Drive Completo (Criar/Deletar/Upload)
      "https://www.googleapis.com/auth/documents", // Google Docs
      "https://www.googleapis.com/auth/spreadsheets", // Google Sheets
    ],
    state: whatsappId,
  });
};

// --- CALLBACK DE AUTENTICAÇÃO ---
export const handleCallback = async (code: string, whatsappId: string) => {
  console.log(`🔎 LOGIN INICIADO para: '${whatsappId}'`);
  const oauth2Client = createOAuthClient();

  // Limpeza robusta do número
  const cleanWaId = whatsappId.trim().replace(/\D/g, "");

  const { tokens } = await oauth2Client.getToken(code);

  console.log("📦 Tokens recebidos. Escopos:", tokens.scope);

  // Verificação de escopos críticos
  // Nota: O escopo 'drive' cobre 'drive.file', então verificamos a presença dos principais
  const requiredScopes = ["gmail.readonly", "calendar"];
  const hasExampleScope = requiredScopes.some((s) => tokens.scope?.includes(s));

  if (!hasExampleScope) {
    console.warn(
      "⚠️ ALERTA: Alguns escopos podem não ter sido aceitos pelo usuário."
    );
  }

  if (tokens.refresh_token) {
    const userRes = await pool.query(
      `SELECT id FROM users WHERE phone_number = $1 OR phone_number = $2`,
      [whatsappId, cleanWaId]
    );

    if (userRes.rows.length === 0) {
      throw new Error(
        `Usuário não encontrado. Cadastre o número ${whatsappId} primeiro.`
      );
    }

    const userId = userRes.rows[0].id;

    // Atualização com Log de Debug do Banco
    const updateRes = await pool.query(
      `INSERT INTO user_integrations (user_id, google_refresh_token, google_home_connected, updated_at) 
         VALUES ($1, $2, TRUE, NOW()) 
         ON CONFLICT (user_id) 
         DO UPDATE SET 
            google_refresh_token = $2, 
            google_home_connected = TRUE,
            updated_at = NOW()`,
      [userId, tokens.refresh_token]
    );

    console.log(`✅ Banco atualizado! Linhas afetadas: ${updateRes.rowCount}`);
    return "Integração realizada com sucesso! Google Docs, Sheets, Drive, Gmail e Agenda ativados.";
  } else {
    console.warn("⚠️ Google não mandou refresh_token.");
    return "O Google não enviou um novo token. Vá em myaccount.google.com/permissions, remova o acesso do App e tente de novo.";
  }
};

// ==========================================
// 1. GOOGLE DOCS
// ==========================================

// Helper para extrair texto do JSON complexo do Google Docs
const extractTextFromDoc = (content: any[]): string => {
  let text = "";
  content.forEach((element) => {
    if (element.paragraph) {
      element.paragraph.elements.forEach((el: any) => {
        if (el.textRun) {
          text += el.textRun.content;
        }
      });
    } else if (element.table) {
      text += "[Tabela detectada - Conteúdo ignorado]\n";
    }
  });
  return text;
};

export const createDoc = async (
  whatsappId: string,
  title: string,
  initialContent?: string
) => {
  const auth = await getAuthenticatedClient(whatsappId);
  const docs = google.docs({ version: "v1", auth });

  // A. Cria o arquivo vazio
  const createRes = await docs.documents.create({
    requestBody: { title },
  });
  const docId = createRes.data.documentId!;

  // B. Insere conteúdo inicial se houver
  if (initialContent) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 }, // Índice 1 é o início do corpo
              text: initialContent,
            },
          },
        ],
      },
    });
  }

  return {
    id: docId,
    title,
    link: `https://docs.google.com/document/d/${docId}`,
  };
};

export const readDoc = async (whatsappId: string, docId: string) => {
  const auth = await getAuthenticatedClient(whatsappId);
  const docs = google.docs({ version: "v1", auth });

  try {
    const res = await docs.documents.get({ documentId: docId });
    const text = extractTextFromDoc(res.data.body?.content || []);
    return { title: res.data.title, content: text };
  } catch (e: any) {
    if (e.code === 404)
      throw new Error("Documento não encontrado ou sem permissão.");
    throw e;
  }
};

export const appendToDoc = async (
  whatsappId: string,
  docId: string,
  text: string
) => {
  const auth = await getAuthenticatedClient(whatsappId);
  const docs = google.docs({ version: "v1", auth });

  // Busca o documento para descobrir o índice final
  const doc = await docs.documents.get({ documentId: docId });
  const content = doc.data.body?.content;
  const endIndex = content?.[content.length - 1]?.endIndex || 1;
  // O último índice é o caractere de fim de arquivo, então subtraímos 1
  const safeIndex = Math.max(1, endIndex - 1);

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: safeIndex },
            text: "\n" + text, // Adiciona quebra de linha por segurança
          },
        },
      ],
    },
  });

  return { message: "Texto adicionado ao final do documento." };
};

// ==========================================
// 2. GOOGLE SHEETS
// ==========================================

export const createSheet = async (whatsappId: string, title: string) => {
  const auth = await getAuthenticatedClient(whatsappId);
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
    },
  });

  return {
    id: res.data.spreadsheetId,
    title,
    link: res.data.spreadsheetUrl,
  };
};

export const getSheetValues = async (
  whatsappId: string,
  spreadsheetId: string,
  range: string = "A1:E10"
) => {
  const auth = await getAuthenticatedClient(whatsappId);
  const sheets = google.sheets({ version: "v4", auth });

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    return { values: res.data.values || [] };
  } catch (e: any) {
    throw new Error("Erro ao ler planilha: " + e.message);
  }
};

export const appendToSheet = async (
  whatsappId: string,
  spreadsheetId: string,
  values: string[]
) => {
  const auth = await getAuthenticatedClient(whatsappId);
  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "A1", // O Google encontra a próxima linha vazia automaticamente
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [values], // Array de arrays (linhas)
    },
  });

  return { message: "Linha adicionada à planilha." };
};

// ==========================================
// 3. DRIVE GERAL (LISTAR E DELETAR)
// ==========================================

export const listFiles = async (whatsappId: string, queryName?: string) => {
  const auth = await getAuthenticatedClient(whatsappId);
  const drive = google.drive({ version: "v3", auth });

  let q = "trashed = false";
  if (queryName) {
    q += ` and name contains '${queryName}'`;
  }

  const res = await drive.files.list({
    q,
    pageSize: 10,
    fields: "nextPageToken, files(id, name, mimeType, webViewLink)",
    orderBy: "createdTime desc",
  });

  return res.data.files;
};

export const deleteFile = async (whatsappId: string, fileId: string) => {
  const auth = await getAuthenticatedClient(whatsappId);
  const drive = google.drive({ version: "v3", auth });

  try {
    await drive.files.delete({ fileId });
    return { message: "Arquivo deletado com sucesso." };
  } catch (e: any) {
    throw new Error("Erro ao deletar arquivo: " + e.message);
  }
};

export const uploadToDrive = async (
  whatsappId: string,
  filePath: string,
  fileName: string
) => {
  const auth = await getAuthenticatedClient(whatsappId);
  const drive = google.drive({ version: "v3", auth });

  try {
    const response = await drive.files.create({
      requestBody: {
        name: `Recibo - ${fileName}`,
        mimeType: "image/jpeg",
        parents: [],
      },
      media: {
        mimeType: "image/jpeg",
        body: fs.createReadStream(filePath),
      },
      fields: "id, webViewLink, webContentLink",
    });

    return response.data.webViewLink;
  } catch (error: any) {
    if (error.code === 403) throw new Error("AUTH_REQUIRED");
    throw new Error("Erro no upload do Drive: " + error.message);
  }
};

// ==========================================
// 4. CALENDAR (AGENDA)
// ==========================================

export const listEvents = async (whatsappId: string) => {
  const now = new Date();
  const endRange = new Date();
  endRange.setDate(now.getDate() + 30);

  const events = await checkAvailability(
    whatsappId,
    now.toISOString(),
    endRange.toISOString()
  );

  const simplifiedEvents = events?.map((e: any) => ({
    id: e.id,
    summary: e.summary,
    start: e.start.dateTime || e.start.date,
  }));

  return simplifiedEvents;
};

export const checkAvailability = async (
  whatsappId: string,
  start: string,
  end: string
) => {
  const auth = await getAuthenticatedClient(whatsappId);
  const calendar = google.calendar({ version: "v3", auth });

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: start,
    timeMax: end,
    singleEvents: true,
    orderBy: "startTime",
  });
  return response.data.items;
};

export const createEvent = async (
  whatsappId: string,
  eventDetails: {
    summary: string;
    description?: string;
    start: string;
    end: string;
    attendees?: string[];
  }
) => {
  const auth = await getAuthenticatedClient(whatsappId);
  const calendar = google.calendar({ version: "v3", auth });

  const hasAttendees =
    eventDetails.attendees && eventDetails.attendees.length > 0;

  const attendeesList = hasAttendees
    ? eventDetails.attendees?.map((email) => ({ email: email.trim() }))
    : [];

  let requestBody: any = {
    summary: eventDetails.summary,
    description: eventDetails.description,
    start: { dateTime: eventDetails.start },
    end: { dateTime: eventDetails.end },
  };

  if (hasAttendees) {
    requestBody.attendees = attendeesList;
    requestBody.conferenceData = {
      createRequest: {
        requestId: uuidv4(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const event = await calendar.events.insert({
    calendarId: "primary",
    conferenceDataVersion: 1,
    sendUpdates: hasAttendees ? "all" : "none",
    requestBody: requestBody,
  });

  return {
    link: event.data.htmlLink,
    meetLink: event.data.hangoutLink || null,
  };
};

export const deleteEvent = async (whatsappId: string, eventId: string) => {
  const auth = await getAuthenticatedClient(whatsappId);
  const calendar = google.calendar({ version: "v3", auth });

  try {
    await calendar.events.delete({ calendarId: "primary", eventId: eventId });
    return true;
  } catch (error) {
    throw new Error("Erro ao deletar: Evento não encontrado.");
  }
};

// ==========================================
// 5. GMAIL (E-MAILS)
// ==========================================

// Auxiliares de E-mail
const decodeBase64 = (data: string) => {
  const buff = Buffer.from(data, "base64");
  return buff.toString("utf-8");
};

const extractBody = (payload: any): string => {
  if (!payload) return "";
  if (payload.body && payload.body.data) {
    return decodeBase64(payload.body.data);
  }
  if (payload.parts) {
    let part = payload.parts.find((p: any) => p.mimeType === "text/plain");
    if (part && part.body && part.body.data) {
      return decodeBase64(part.body.data);
    }
    part = payload.parts.find((p: any) => p.mimeType === "text/html");
    if (part && part.body && part.body.data) {
      return decodeBase64(part.body.data).replace(/<[^>]*>?/gm, "");
    }
  }
  return "Conteúdo vazio.";
};

export const listEmails = async (whatsappId: string, query: string) => {
  const auth = await getAuthenticatedClient(whatsappId);
  const gmail = google.gmail({ version: "v1", auth });

  try {
    // Força a renovação do access_token se necessário
    await auth.getAccessToken();

    const response = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 5,
    });

    const messages = response.data.messages || [];

    const summaries = await Promise.all(
      messages.map(async (msg) => {
        const details = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "metadata",
        });
        const headers = details.data.payload?.headers;
        const subject =
          headers?.find((h) => h.name === "Subject")?.value || "(Sem Assunto)";
        const from =
          headers?.find((h) => h.name === "From")?.value || "Desconhecido";

        return { id: msg.id, from, subject, snippet: details.data.snippet };
      })
    );
    return summaries;
  } catch (error: any) {
    console.error("Erro no Gmail API:", error.message);
    if (
      error.code === 403 ||
      error.message.includes("insufficient authentication scopes")
    ) {
      throw new Error("AUTH_REQUIRED");
    }
    throw error;
  }
};

export const readEmail = async (whatsappId: string, messageId: string) => {
  const auth = await getAuthenticatedClient(whatsappId);
  const gmail = google.gmail({ version: "v1", auth });

  try {
    const response = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    const headers = response.data.payload?.headers;
    const subject = headers?.find((h) => h.name === "Subject")?.value;
    const from = headers?.find((h) => h.name === "From")?.value;
    const date = headers?.find((h) => h.name === "Date")?.value;
    const body = extractBody(response.data.payload);

    return {
      id: response.data.id,
      from,
      date,
      subject,
      body: body.substring(0, 2000),
    };
  } catch (error: any) {
    if (
      error.code === 403 ||
      error.message.includes("insufficient authentication scopes")
    ) {
      throw new Error("AUTH_REQUIRED");
    }
    throw error;
  }
};
