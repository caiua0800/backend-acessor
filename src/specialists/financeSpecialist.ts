// src/specialists/financeSpecialist.ts

import * as financeService from "../services/financeService";
import * as googleService from "../services/googleService";
import * as aiService from "../services/aiService";
import { UserContext } from "../services/types";
import moment from "moment-timezone";

// --- INTERFACES ---
interface FinanceItem {
  amount: string;
  description: string;
  type: "income" | "expense";
  category?: string;
  date?: string; // ISO String para gastos pontuais
  day_of_month?: number; // Para recorrentes
  is_recurring?: boolean;
}

interface FinanceIntention {
  intent:
    | "process_items"
    | "add_investment"
    | "configure_settings"
    | "list_report"
    | "export_report"
    | "clarification_needed"
    | "check_recurring"
    | "check_budget_forecast"
    | "confirmation";

  amount?: string;
  description?: string;
  current_balance?: string;
  monthly_income?: string;
  spending_limit?: string;
  currency?: string;
  export_format?: "sheet" | "doc";
  asset_name?: string;
  items?: FinanceItem[];
  missing_info_question?: string;
}

// --- HELPERS ---

function cleanJsonOutput(rawOutput: string): string {
  const start = rawOutput.indexOf("{");
  const end = rawOutput.lastIndexOf("}");
  if (start !== -1 && end !== -1) {
    return rawOutput.substring(start, end + 1);
  }
  return rawOutput;
}

function buildDateFromDay(day: number, userTimezone: string): string {
  const now = moment().tz(userTimezone); // <--- Usa o fuso do usuário
  const date = now.clone().date(day);
  return date.format();
}

function sanitizeItem(item: FinanceItem, userTimezone: string): FinanceItem {
  let cleanDesc = item.description;
  let cleanDay = item.day_of_month;

  // Tenta extrair dia do texto se não veio no JSON (ex: "Netflix dia 15")
  const dayRegex = /\b(?:dia|dt|vence|vencimento)\s*(\d{1,2})\b/gi;
  const match = dayRegex.exec(cleanDesc);

  if (match) {
    if (!cleanDay) {
      const d = parseInt(match[1]);
      if (d >= 1 && d <= 31) cleanDay = d;
    }
    // Remove o "dia X" da descrição para ficar limpo
    cleanDesc = cleanDesc.replace(dayRegex, "").trim();
    cleanDesc = cleanDesc.replace(/\s+[-–,.]+\s*$/, "").trim();
  }

  // Detecta intenção de recorrência por palavras-chave
  const isReallyRecurring =
    item.is_recurring || /todo|mensal|fixo|assinatura/i.test(cleanDesc);

  let finalDate = item.date;
  // Se for recorrente, não precisa de data exata (usa day_of_month).
  // Se for pontual e tiver dia, constrói a data desse mês.
  if (!isReallyRecurring && cleanDay && !finalDate) {
    finalDate = buildDateFromDay(cleanDay, userTimezone); // <--- Passa aqui
  }

  return {
    ...item,
    description: cleanDesc,
    day_of_month: cleanDay,
    is_recurring: isReallyRecurring,
    date: finalDate,
  };
}

// --- FUNÇÃO PRINCIPAL (EXPORTADA) ---
export async function financeSpecialist(context: UserContext): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  const extractionPrompt = `
    Você é um Especialista Financeiro. Converta o texto do usuário em JSON.

    INTENÇÕES:
    - "process_items": Registrar gastos ou ganhos.
      IMPORTANTE: Se o usuário disser "dia 1" ou "data tal", inclua isso.
      IMPORTANTE: Só marque "is_recurring": true se for algo FIXO (Todo mês, Assinatura, Aluguel). Se for gasto comum ("Uber dia 1"), é false.
    
    - "check_recurring": Consultar total de gastos fixos.
    - "check_budget_forecast": O usuário quer saber "Quanto sobra do Teto?", "Quanto tenho pra gastar?", "Previsão de caixa".
    - "add_investment": Investimentos (Aportes).
    - "configure_settings": Definir Renda, TETO/LIMITE ou Saldo.
    - "list_report": Relatório geral ("Manda escrito", "Resumo", "Situação").
    - "export_report": Exportar planilha.
    
    - "confirmation": SE O USUÁRIO DISSER APENAS "Sim", "Ok", "Certo", "Confirmo", "Está certo". (Isso serve para encerrar o assunto).
    
    - "clarification_needed": Use APENAS se o usuário falar de dinheiro de forma vaga sem valores ("quanto custou?").

    JSON RESPOSTA:
    {
      "intent": "...",
      "items": [ { "amount": "...", "description": "...", "is_recurring": false, "day_of_month": 10 } ],
      "current_balance": "...",
      "spending_limit": "...",
      "monthly_income": "..."
    }
  `;

  try {
    // 1. EXTRAÇÃO DE DADOS (IA)
    const rawJsonString = await aiService.extractData(
      extractionPrompt,
      fullMessage
    );
    const jsonString = cleanJsonOutput(rawJsonString);
    const data: FinanceIntention = JSON.parse(jsonString);

    // Tratamento de Confirmação Simples
    if (data.intent === "confirmation") {
      return await aiService.generatePersonaResponse(
        "O usuário confirmou que está tudo certo. Responda com algo curto e positivo tipo 'Show!', 'Maravilha!', 'Combinado'.",
        fullMessage,
        userConfig
      );
    }

    // Tratamento de Dúvida
    if (data.intent === "clarification_needed") {
      return await aiService.generatePersonaResponse(
        `Faltou informação. Pergunte: "${
          data.missing_info_question || "Pode detalhar melhor?"
        }"`,
        fullMessage,
        userConfig
      );
    }
    const userTz = userConfig.timezone || "America/Sao_Paulo";
    let actionConfirmedMessage = "";
    let processedCount = 0;

    // Busca relatório atual para contextos de cálculo
    const currentReport = await financeService.getFinanceReport(waId);

    // A. PROCESSAR ITENS (GASTOS/GANHOS)
    if (
      data.intent === "process_items" ||
      (data.items && data.items.length > 0)
    ) {
      const items = data.items || [];
      const responses: string[] = [];

      for (let item of items) {
        item = sanitizeItem(item, userTz);
        
        if (!item.amount || !item.description) continue;

        if (item.is_recurring && item.day_of_month) {
          // GASTO FIXO/RECORRENTE
          try {
            const created = await financeService.addRecurringTransaction(waId, {
              amount: item.amount,
              type: item.type || "expense",
              category: item.category || "Fixo",
              description: item.description,
              day_of_month: item.day_of_month,
            });
            responses.push(
              `🔄 Fixo Agendado: ${item.description} (Dia ${created.day_of_month})`
            );
          } catch (err) {
            console.error(err);
            responses.push(`❌ Erro em: ${item.description}`);
          }
        } else {
          // GASTO COMUM
          try {
            await financeService.addTransaction(waId, {
              amount: item.amount,
              type: item.type || "expense",
              category: item.category || "Geral",
              description: item.description,
              date: item.date,
            });

            const dateInfo = item.date
              ? ` (${moment(item.date).format("DD/MM")})`
              : "";
            responses.push(
              `✅ Registrado: ${item.description}: R$ ${item.amount}${dateInfo}`
            );
          } catch (err) {
            console.error(err);
            responses.push(`❌ Erro em: ${item.description}`);
          }
        }
        processedCount++;
      }
      if (processedCount > 0) {
        actionConfirmedMessage =
          processedCount > 5
            ? `📝 Processados ${processedCount} itens.`
            : responses.join("\n");
      }
    }

    // B. PLANEJAMENTO (TETO - GASTOS - FIXOS PENDENTES)
    else if (data.intent === "check_budget_forecast") {
      const limit = currentReport.config.limite_estipulado || 0;

      if (limit <= 0) {
        actionConfirmedMessage = `⚠️ Você ainda não configurou um **Teto de Gastos**. Defina um limite (ex: "Meu teto é 3000") para eu calcular quanto você ainda pode gastar.`;
      } else {
        const spentSoFar = currentReport.resumo_mes.gastos || 0;
        const pendingRecurring =
          await financeService.getPendingRecurringExpensesTotal(waId);

        const available = limit - spentSoFar - pendingRecurring;
        const currentBalance = currentReport.saldo_atual_conta;

        actionConfirmedMessage =
          `📊 *Previsão de Caixa*\n\n` +
          `🎯 *Seu Teto:* R$ ${limit.toFixed(2)}\n` +
          `💸 *Já Gastou:* - R$ ${spentSoFar.toFixed(2)}\n` +
          `📅 *Contas Fixas (Pendentes):* - R$ ${pendingRecurring.toFixed(
            2
          )}\n` +
          `--------------------------\n` +
          `💰 *Disponível pra Gastar:* R$ ${available.toFixed(2)}\n` +
          (available < 0
            ? `⚠️ *Atenção:* Você já estourou seu orçamento planejado!\n`
            : ``) +
          `\n🏦 *Saldo Atual na Conta:* R$ ${currentBalance.toFixed(2)}`;
      }
    }

    // C. CHECAR RECORRENTES (FIXOS)
    else if (data.intent === "check_recurring") {
      const recurringData = await financeService.getRecurringExpensesTotal(
        waId
      );
      if (recurringData.total === 0) {
        actionConfirmedMessage = "Sem gastos fixos cadastrados.";
      } else {
        const itemList = recurringData.items
          .map((i: any) => `• Dia ${i.day}: ${i.description} (R$ ${i.amount})`)
          .join("\n");
        actionConfirmedMessage = `📅 *Total Fixos:* R$ ${recurringData.total.toFixed(
          2
        )}\n\n${itemList}`;
      }
    }

    // D. CONFIGURAR (RENDA, TETO, SALDO)
    else if (data.intent === "configure_settings") {
      // Se vier ajuste de saldo como item, trata aqui
      let balanceVal = data.current_balance;
      if (
        !balanceVal &&
        data.items &&
        data.items.length === 1 &&
        data.items[0].description.toLowerCase().includes("saldo")
      ) {
        balanceVal = data.items[0].amount;
      }
      
      // Ajuste de saldo via transação de correção
      if (balanceVal) {
        const diff =
          financeService.parseMoney(balanceVal) -
          currentReport.saldo_atual_conta;
        if (Math.abs(diff) > 0.01) {
          await financeService.addTransaction(waId, {
            amount: Math.abs(diff),
            type: diff > 0 ? "income" : "expense",
            category: "Ajuste",
            description: "Ajuste Saldo",
            date: new Date().toISOString(),
          });
        }
      }

      // Chama o serviço para salvar configurações (Teto/Renda)
      // Nota: Passamos null no saldo se já ajustamos via transação para não conflitar
      await financeService.setFinanceSettings(
        waId,
        data.monthly_income,
        data.spending_limit,
        null, 
        data.currency
      );
      actionConfirmedMessage = "✅ Configurações financeiras atualizadas.";
    }

    // E. RELATÓRIOS E EXPORTAÇÃO
    else if (data.intent === "list_report" || data.intent === "export_report") {
      const updatedReport = await financeService.getFinanceReport(waId);

      if (data.intent === "export_report") {
        try {
          const sheet = await googleService.createSheet(waId, `Extrato`);
          if (sheet.id) {
            await googleService.appendToSheet(waId, sheet.id, [
              "DATA",
              "TIPO",
              "DESCRIÇÃO",
              "VALOR",
            ]);
            const trans = await financeService.getLastTransactions(waId, 50);
            for (const t of trans)
              await googleService.appendToSheet(waId, sheet.id, [
                t.date,
                t.type,
                t.description,
                t.amount.toString(),
              ]);
            actionConfirmedMessage = `✅ Planilha criada: ${sheet.link}`;
          }
        } catch (e) {
          actionConfirmedMessage = "Erro ao criar planilha. Verifique a integração com Google.";
        }
      } else {
        const limit = updatedReport.config.limite_estipulado || 0;
        let forecastText = "";

        if (limit > 0) {
          const pendingRecurring =
            await financeService.getPendingRecurringExpensesTotal(waId);
          const available =
            limit - updatedReport.resumo_mes.gastos - pendingRecurring;

          forecastText = `\n🎯 *Teto:* R$ ${limit}\n📅 *Fixos (Falta cair):* R$ ${pendingRecurring.toFixed(
            2
          )}\n💵 *Livre pra Gastar:* R$ ${available.toFixed(2)}\n`;
        }

        actionConfirmedMessage =
          `📝 *Resumo Financeiro:*\n\n` +
          `💰 *Saldo Atual:* R$ ${updatedReport.saldo_atual_conta}\n` +
          `📉 *Gastos do Mês:* R$ ${updatedReport.resumo_mes.gastos}\n` +
          `${forecastText}\n` +
          `_Estes são os dados registrados no momento._`;
      }
    }

    // F. INVESTIMENTOS
    else if (data.intent === "add_investment") {
      if (data.items && data.items.length > 0) {
        await financeService.addInvestment(
          waId,
          data.items[0].description,
          data.items[0].amount
        );
        actionConfirmedMessage = "Investimento registrado com sucesso!";
      }
    }

    // G. RESPOSTA PADRÃO SE NADA FOI FEITO
    if (!actionConfirmedMessage && processedCount === 0) {
      return await aiService.generatePersonaResponse(
        "Não entendi a movimentação financeira. Peça para repetir com valores claros.",
        fullMessage,
        userConfig
      );
    }

    // 2. RESPOSTA FINAL (COM PERSONA)
    return await aiService.generatePersonaResponse(
      `Confirme a ação financeira: """${actionConfirmedMessage}""". Se for um gasto pontual, apenas confirme que foi registrado.`,
      fullMessage,
      userConfig
    );
  } catch (error: any) {
    console.error(error);
    return await aiService.generatePersonaResponse(
      `Erro técnico: ${error.message}`,
      fullMessage,
      userConfig
    );
  }
}