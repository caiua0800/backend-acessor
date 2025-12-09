import { pool } from "../db";
import axios from "axios";
import moment from "moment-timezone";
import { sendTextMessage } from "./whatsappService"; // <--- REUTILIZAR AQUI

const WHATSAPP_API_URL = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const UTILITY_TEMPLATE_NAME = "generic_alert";

export const scheduleNotification = async (
  userId: string,
  message: string,
  sendAt: Date
) => {
  console.log(
    `⏰ [NOTIFICATION] Agendando para ${sendAt.toLocaleString()}: "${message}"`
  );

  await pool.query(
    `INSERT INTO notification_queue (user_id, message_body, send_at)
     VALUES ($1, $2, $3)`,
    [userId, message, sendAt]
  );
  return true;
};

// 2. PROCESSAR FILA (CRON)
export const processNotificationQueue = async () => {
  const client = await pool.connect();

  try {
    const res = await client.query(
      `SELECT n.id, n.message_body, u.phone_number, u.last_interaction_at
       FROM notification_queue n
       JOIN users u ON u.id = n.user_id
       WHERE n.status = 'pending' 
       AND n.send_at <= NOW()
       FOR UPDATE SKIP LOCKED 
       LIMIT 15` 
    );

    if (res.rows.length === 0) return;

    console.log(`🔔 [CRON] Processando ${res.rows.length} notificações...`);

    for (const item of res.rows) {
      try {
        const lastInteraction = item.last_interaction_at
          ? moment(item.last_interaction_at)
          : moment("1970-01-01");

        const now = moment();
        const hoursDiff = now.diff(lastInteraction, "hours", true);

        if (hoursDiff < 23.5) {
          console.log(
            `🟢 [CRON] Janela ABERTA (${hoursDiff.toFixed(
              1
            )}h). Enviando Texto.`
          );
          await sendTextMessage(
            item.phone_number,
            `🔔 *Lembrete:* ${item.message_body}`
          );
        } else {
          console.log(
            `🟠 [CRON] Janela FECHADA (${hoursDiff.toFixed(
              1
            )}h). Enviando Template.`
          );
          await sendWhatsAppUtility(item.phone_number, item.message_body);
        }

        await client.query(
          "UPDATE notification_queue SET status = 'sent', updated_at = NOW() WHERE id = $1",
          [item.id]
        );
      } catch (error: any) {
        console.error(
          `❌ [CRON] Falha ao enviar ID ${item.id}:`,
          error.message
        );
        await client.query(
          "UPDATE notification_queue SET status = 'failed', updated_at = NOW() WHERE id = $1",
          [item.id]
        );
      }
    }
  } catch (error) {
    console.error("❌ [CRON ERROR]", error);
  } finally {
    client.release();
  }
};

// --- ENVIO 2: TEMPLATE (MANTER MANUALMENTE POIS É ESPECÍFICO) ---
export async function sendWhatsAppUtility(to: string, bodyText: string) {
  const payload = {
    messaging_product: "whatsapp",
    to: to,
    type: "template",
    template: {
      name: UTILITY_TEMPLATE_NAME,
      language: { code: "pt_BR" },
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: bodyText,
            },
          ],
        },
      ],
    },
  };

  await axios.post(WHATSAPP_API_URL, payload, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
}
