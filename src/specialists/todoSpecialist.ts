import * as todoService from "../services/todoService";
import * as notificationService from "../services/notificationService";
import * as aiService from "../services/aiService";
import * as memoryService from "../services/memoryService";
import { pool } from "../db";
import { UserContext } from "../services/types";
import moment from "moment";

interface TodoItem {
  task: string;
  deadline?: string;
}

interface TodoIntention {
  intent: "add" | "complete" | "list" | "delete" | "schedule_reminder";
  items?: TodoItem[];
  task?: string;
  deadline?: string;
  reminder_requested?: boolean;
}

const getUserId = async (waId: string) => {
  const res = await pool.query("SELECT id FROM users WHERE phone_number = $1", [
    waId,
  ]);
  return res.rows[0]?.id;
};

// Sub-especialista Matcher
async function findBestTaskMatch(
  userMessage: string,
  failedTerm: string,
  pendingTasks: any[]
): Promise<string | null> {
  if (pendingTasks.length === 0) return null;
  const tasksListStr = pendingTasks.map((t) => `- "${t.task}"`).join("\n");
  const prompt = `Matcher de Tarefas. MSG: "${userMessage}". FALHOU: "${failedTerm}". LISTA: ${tasksListStr}. Retorne JSON { "found": true, "exact_text": "..." } ou { "found": false }`;
  try {
    const rawJson = await aiService.extractData(prompt, userMessage);
    const result = JSON.parse(
      rawJson.substring(rawJson.indexOf("{"), rawJson.lastIndexOf("}") + 1)
    );
    return result.found && result.exact_text ? result.exact_text : null;
  } catch (e) {
    return null;
  }
}

function cleanJsonOutput(rawOutput: string): string {
  const start = rawOutput.indexOf("{");
  const end = rawOutput.lastIndexOf("}");
  if (start !== -1 && end !== -1) return rawOutput.substring(start, end + 1);
  return rawOutput;
}

export async function todoSpecialist(context: UserContext): Promise<string> {
  const { waId, fullMessage, userConfig } = context;
  console.log("🚀 [TODO SPECIALIST] Processando:", fullMessage);
  const userTz = userConfig.timezone || "America/Sao_Paulo";

  // CORREÇÃO: Chama a nova função loadRecentHistory
  const recentHistory = await memoryService.loadRecentHistory(waId, 2);

  const extractionPrompt = `
    Gerente de Tarefas. Extraia a intenção em JSON.
    
    AGORA: ${moment().tz(userTz).format("YYYY-MM-DD HH:mm:ss")}
    
    INTENÇÕES:
    1. "add": Adicionar tarefa.
       - SE TIVER PRAZO RELATIVO ("daqui 3 min"), CALCULE A DATA/HORA EXATA formato ISO.
       - "reminder_requested": true se o usuário disser "me lembre", "avise", "notifique".
    2. "complete": Concluir (Fiz X).
    3. "list": Listar.
    4. "delete": Apagar.
    5. "schedule_reminder": Se o usuário responder "Sim", "Quero", "Pode ser" a uma oferta de lembrete anterior (veja o histórico).

    HISTÓRICO RECENTE:
    ${recentHistory}

    JSON: { 
      "intent": "...", 
      "items": [{ "task": "...", "deadline": "YYYY-MM-DDTHH:mm:ss" }],
      "reminder_requested": true/false
    }
  `;

  try {
    const rawJson = await aiService.extractData(extractionPrompt, fullMessage);
    const data: TodoIntention = JSON.parse(cleanJsonOutput(rawJson));
    console.log("📝 [TODO DATA]", JSON.stringify(data));

    let responseMsg = "";
    let offerReminder = false;
    const userId = await getUserId(waId);

    // Normalização
    let tasksToProcess: TodoItem[] = [];
    if (data.items && data.items.length > 0) tasksToProcess = data.items;
    else if (data.task)
      tasksToProcess.push({ task: data.task, deadline: data.deadline });

    // 1. ADICIONAR (ADD)
    if (data.intent === "add") {
      const addedNames: string[] = [];
      const explicitReminder =
        fullMessage.toLowerCase().match(/(lembre|avise|notifique|alerta)/) ||
        data.reminder_requested;

      for (const item of tasksToProcess) {
        const created = await todoService.createTask(
          waId,
          item.task,
          item.deadline
        );
        let infoExtra = "";

        if (created.deadline) {
          const deadlineDate = new Date(created.deadline);
          if (explicitReminder) {
            await notificationService.scheduleNotification(
              userId,
              `🔔 Lembrete: ${item.task} (Prazo agora!)`,
              deadlineDate
            );
            console.log(
              `⏰ [TODO] Notificação agendada para: ${deadlineDate.toLocaleString()}`
            );
            infoExtra = " (🔔 Alerta ativado)";
          } else {
            offerReminder = true;
          }
        }

        const dateStr = created.deadline
          ? ` 🕒 ${new Date(created.deadline).toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : "";
        addedNames.push(`"${created.task}"${dateStr}${infoExtra}`);
      }

      if (addedNames.length > 0)
        responseMsg = `✅ Adicionado:\n- ${addedNames.join("\n- ")}`;
    }

    // 2. AGENDAR LEMBRETE (CONTEXTO DE "SIM")
    else if (data.intent === "schedule_reminder") {
      const tasks = await todoService.listTasks(waId);
      const recentTask = tasks.find((t) => t.deadline && !t.done);

      if (recentTask) {
        const deadlineDate = new Date(recentTask.deadline);
        await notificationService.scheduleNotification(
          userId,
          `🔔 Lembrete Tardia: ${recentTask.task}`,
          deadlineDate
        );
        responseMsg = `✅ Combinado! Agendei o lembrete para "${
          recentTask.task
        }" às ${deadlineDate.toLocaleTimeString()}.`;
      } else {
        responseMsg =
          "Tentei agendar o lembrete, mas não achei qual tarefa recente tinha prazo. Pode me dizer o nome da tarefa?";
      }
    }

    // 3. CONCLUIR
    else if (data.intent === "complete") {
      const completedNames: string[] = [];
      for (const item of tasksToProcess) {
        let completed = await todoService.completeTaskByTerm(waId, item.task);
        if (!completed) {
          const pendingTasks = await todoService.listTasks(waId, false);
          const matched = await findBestTaskMatch(
            fullMessage,
            item.task,
            pendingTasks
          );
          if (matched)
            completed = await todoService.completeTaskByTerm(waId, matched);
        }
        if (completed) completedNames.push(completed.task);
      }
      if (completedNames.length > 0)
        responseMsg = `👏 Concluído: ${completedNames.join(", ")}!`;
      else return "";
    }

    // 4. LISTAR
    else if (data.intent === "list") {
      const tasks = await todoService.listTasks(waId);
      if (tasks.length === 0) responseMsg = "Lista vazia!";
      else {
        const listTxt = tasks
          .map((t) => {
            const date = t.deadline
              ? ` 🕒 ${new Date(t.deadline).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "";
            return `- ${t.task}${date}`;
          })
          .join("\n");
        responseMsg = `📝 Pendências:\n${listTxt}`;
      }
    }

    // 5. DELETAR
    else if (data.intent === "delete") {
      const deletedNames: string[] = [];
      for (const item of tasksToProcess) {
        const deleted = await todoService.deleteTask(waId, item.task);
        if (deleted) deletedNames.push(deleted.task);
      }
      if (deletedNames.length > 0)
        responseMsg = `🗑️ Deletado: ${deletedNames.join(", ")}.`;
      else responseMsg = "Não encontrei para deletar.";
    }

    if (!responseMsg) return "";

    let systemInstruction = `Confirme a ação: "${responseMsg}"`;

    if (offerReminder) {
      systemInstruction += `\n\n### IMPORTANTE ###\nO usuário definiu um prazo. PERGUNTE NO FINAL: "Quer que eu te mande um lembrete no WhatsApp perto do horário pra você não esquecer?"`;
    }

    return await aiService.generatePersonaResponse(
      systemInstruction,
      fullMessage,
      userConfig
    );
  } catch (error: any) {
    console.error("❌ [TODO ERROR]", error);
    return `Erro na lista: ${error.message}`;
  }
}
