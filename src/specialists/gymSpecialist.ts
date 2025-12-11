import * as gymService from "../services/gymService";
import * as calendarService from "../services/googleService";
import * as aiService from "../services/aiService";
import * as youtubeService from "../services/youtubeService";
import { UserContext } from "../services/types";
import moment from "moment-timezone";

interface GymIntention {
  intent: "config_health" | "set_workout" | "generate_plan" | "list_plan";
  weight?: number;
  height?: number;
  age?: number;
  goal?: string;
  workouts?: { day: string; focus: string; exercises: any[] }[];
  schedule_request?: {
    should_schedule: boolean;
    times?: { day: string; time: string }[];
  };
}

function cleanJsonOutput(rawOutput: string): string {
  const start = rawOutput.indexOf("{");
  const end = rawOutput.lastIndexOf("}");
  if (start !== -1 && end !== -1) return rawOutput.substring(start, end + 1);
  return rawOutput;
}

function getNextDayDate(
  dayName: string,
  timeStr: string,
  userTimezone: string
): { start: string; end: string } | null {
  const daysMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    domingo: 0,
    segunda: 1,
    terca: 2,
    quarta: 3,
    quinta: 4,
    sexta: 5,
    sabado: 6,
  };

  const targetDay =
    daysMap[
      dayName
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
    ];
  if (targetDay === undefined) return null;

  const now = moment().tz(userTimezone);
  const today = now.day();

  let diff = targetDay - today;
  if (diff <= 0) diff += 7;

  const eventDate = now.clone().add(diff, "days");
  const [hour, minute] = timeStr.split(":");
  eventDate.set({ hour: parseInt(hour), minute: parseInt(minute), second: 0 });

  const startIso = eventDate.format();
  const endIso = eventDate.add(1, "hour").format();

  return { start: startIso, end: endIso };
}

export async function gymSpecialist(context: UserContext): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  const extractionPrompt = `
    Você é um Personal Trainer IA. Analise a mensagem e extraia a intenção em JSON.

    INTENÇÕES:
    1. "config_health": Definir peso, altura, idade, objetivo. (Ex: "Tenho 80kg, 1.75m")
    2. "set_workout": O usuário informa o treino dele MANUALMENTE.
    3. "generate_plan": O usuário pede para VOCÊ montar/criar/analisar um treino.
    4. "list_plan": Ver o treino atual.

    REGRAS DE EXTRAÇÃO:
    - Weight (Peso): Número (ex: 84.5).
    - Height (Altura): Número (ex: 173 ou 1.73).
    - Age (Idade): Número inteiro.

    AGENDAMENTO (schedule_request):
    - Se o usuário pedir para marcar/agendar na agenda.
    - "day": use 'monday', 'tuesday'... (em inglês)
    - "time": formato 'HH:mm' (24h).

    JSON OBRIGATÓRIO:
    {
      "intent": "...",
      "weight": 0, "height": 0, "age": 0, "goal": "...",
      "workouts": [ { "day": "monday", "focus": "...", "exercises": ["..."] } ],
      "schedule_request": { 
          "should_schedule": true/false,
          "times": [{ "day": "monday", "time": "18:00" }]
      }
    }
  `;

  try {
    const rawJson = await aiService.extractData(extractionPrompt, fullMessage);
    const data: GymIntention = JSON.parse(cleanJsonOutput(rawJson));
    console.log("🏋️ [GYM DEBUG]", data);

    let responseMsg = "";
    let isPlanGenerated = false;

    // 1. CONFIGURAR PERFIL
    if (data.intent === "config_health") {
      const weight = data.weight && data.weight > 0 ? data.weight : undefined;
      const height = data.height && data.height > 0 ? data.height : undefined;
      const age = data.age && data.age > 0 ? data.age : undefined;

      await gymService.setHealthSettings(waId, {
        weight,
        height,
        age,
        goal: data.goal,
      });

      responseMsg = `Perfil de saúde atualizado! (Peso: ${weight}, Altura: ${height}, Objetivo: ${data.goal}).`;
    }

    // 2. SALVAR TREINO MANUAL
    else if (data.intent === "set_workout" && data.workouts) {
      for (const w of data.workouts) {
        await gymService.saveWorkout(waId, {
          day_of_week: w.day,
          focus: w.focus || "Treino do dia",
          exercises: w.exercises,
        });
      }
      responseMsg = "Anotei seu treino manual!";
    }

    // 3. GERAR TREINO (IA CRIA O PLANO + BUSCA VÍDEOS)
    else if (data.intent === "generate_plan") {
      const health = await gymService.getHealthSettings(waId);

      if (!health || !health.weight || !health.goal) {
        return await aiService.generatePersonaResponse(
          `O usuário quer um treino, mas faltam dados (peso, altura, objetivo). Peça educadamente essas informações.`,
          fullMessage,
          userConfig
        );
      }

      const generationPrompt = `
        ATUE COMO UM PERSONAL TRAINER DE ELITE.
        Monte um plano de treino para: Peso ${health.weight}kg, Altura ${health.height}, Objetivo ${health.goal}.
        Pedido do usuário: "${fullMessage}"

        REGRAS RÍGIDAS DE JSON:
        1. Retorne APENAS o JSON.
        2. "day": use 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'.
        3. "exercises": Array de strings com Nome + Séries + Reps (Ex: "Supino Reto 3x12").

        Exemplo de Saída:
        {
          "workouts": [
             { "day": "monday", "focus": "Peito e Tríceps", "exercises": ["Supino Reto 4x10", "Tríceps Corda 4x12"] }
          ]
        }
      `;

      const planJsonRaw = await aiService.extractData(
        generationPrompt,
        "Gere o treino agora."
      );
      const planData = JSON.parse(cleanJsonOutput(planJsonRaw));

      console.log("🏋️ [GYM PLAN GENERATED]", JSON.stringify(planData, null, 2));

      if (
        planData.workouts &&
        Array.isArray(planData.workouts) &&
        planData.workouts.length > 0
      ) {
        let summaryText = "";

        for (const w of planData.workouts) {
          await gymService.saveWorkout(waId, {
            day_of_week: w.day,
            focus: w.focus,
            exercises: w.exercises,
          });

          summaryText += `*${w.day.toUpperCase()}* (${w.focus}):\n`;

          for (const exerciseString of w.exercises) {
            const exerciseName = exerciseString
              .replace(/[0-9].*/, "")
              .replace(/x/gi, "")
              .trim();
            const videoLink = await youtubeService.getExerciseVideo(
              exerciseName
            );

            if (videoLink) {
              summaryText += `  - ${exerciseString} [Ver Execução](${videoLink})\n`;
            } else {
              summaryText += `  - ${exerciseString}\n`;
            }
          }
          summaryText += "\n";
        }

        responseMsg = `Montei esta proposta de treino para você com base no seu perfil:\n\n${summaryText}`;
        isPlanGenerated = true;
      } else {
        responseMsg =
          "Tentei montar o treino, mas precisei de mais detalhes. Quantos dias na semana você quer treinar?";
      }
    }

    // 4. LISTAR
    else if (data.intent === "list_plan") {
      const plan = await gymService.getFullWeeklyPlan(waId);
      if (plan.length === 0) responseMsg = "Você não tem treinos cadastrados.";
      else {
        const txt = plan
          .map(
            (p: any) =>
              `*${p.day_of_week.toUpperCase()}* (${p.focus}):\n${JSON.stringify(
                p.exercises_json,
                null,
                2
              )}`
          )
          .join("\n\n");
        responseMsg = `Seu plano atual:\n${txt}`;
      }
    }

    // 5. AGENDAMENTO REAL
    if (data.schedule_request?.should_schedule) {
      if (
        data.schedule_request.times &&
        data.schedule_request.times.length > 0
      ) {
        let successCount = 0;

        for (const t of data.schedule_request.times) {
          const userTz = userConfig.timezone || "America/Sao_Paulo";
          const dates = getNextDayDate(t.day, t.time, userTz);
          if (dates) {
            const workout = await gymService.getFullWeeklyPlan(waId);
            const dayWorkout = workout.find(
              (w: any) => w.day_of_week.toLowerCase() === t.day.toLowerCase()
            );
            const title = dayWorkout
              ? `Treino: ${dayWorkout.focus}`
              : "Academia";

            await calendarService.createEvent(waId, {
              summary: title,
              start: dates.start,
              end: dates.end,
              description: `Treino gerado pelo Assistente IA.\nFoco: ${
                dayWorkout?.focus || "Geral"
              }.`,
            });
            successCount++;
          }
        }
        if (successCount > 0)
          responseMsg += `\n\n✅ Agendei ${successCount} treino(s) na sua agenda do Google!`;
      } else {
        responseMsg += `\n\n📅 Quer que eu marque na agenda? Me diga os dias e horários.`;
      }
    } else if (data.intent === "generate_plan") {
      responseMsg += `\n\nQuer que eu já deixe esses treinos marcados na sua agenda? Só me falar os horários!`;
    }

    if (!responseMsg) return "";

    // ==========================================================
    // 6. RESPOSTA FINAL (PERSONA)
    // ==========================================================
    let systemInstruction = `Transforme esta mensagem técnica em uma resposta motivadora de Personal Trainer: "${responseMsg}"`;

    if (isPlanGenerated) {
      // --- AQUI ESTÁ A ALTERAÇÃO SOLICITADA ---
      systemInstruction += `
        ### INSTRUÇÕES OBRIGATÓRIAS DE FINALIZAÇÃO ###
        1. Pergunte: "O que achou? Posso manter assim ou quer mudar algo?"
        2. DICA DE EXECUÇÃO: "Se tiver dúvida em algum exercício, clique nos links [Ver Execução] que eu coloquei na lista! 📹"
        3. FONTES EXTRAS: "Você também pode pesquisar detalhes técnicos no site 'hipertrofia.org/exercicios'. Ou, se preferir, é só me pedir: 'Manda um vídeo do exercício X' que eu busco pra você! 💪"
        `;
    }

    return await aiService.generatePersonaResponse(
      systemInstruction,
      fullMessage,
      userConfig
    );
  } catch (error: any) {
    console.error("❌ [GYM ERROR]", error);
    return await aiService.generatePersonaResponse(
      `Ocorreu um erro técnico ao processar seu pedido de academia. (${error.message}).`,
      fullMessage,
      userConfig
    );
  }
}
