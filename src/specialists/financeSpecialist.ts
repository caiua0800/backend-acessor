// src/specialists/financeSpecialist.ts

import * as financeService from "../services/financeService";
import * as googleService from "../services/googleService";
import * as aiService from "../services/aiService";
import { UserContext } from "../services/types";

interface FinanceItem {
  amount: string;
  description: string;
  type: "income" | "expense";
  category?: string;
  date?: string;
  day_of_month?: number;
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
    | "check_budget_forecast";

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

function cleanJsonOutput(rawOutput: string): string {
  const start = rawOutput.indexOf("{");
  const end = rawOutput.lastIndexOf("}");
  if (start !== -1 && end !== -1) {
    return rawOutput.substring(start, end + 1);
  }
  return rawOutput;
}

function sanitizeItem(item: FinanceItem): FinanceItem {
  let cleanDesc = item.description;
  let cleanDay = item.day_of_month;

  const dayRegex = /\b(?:dia|dt|vence|vencimento)\s*(\d{1,2})\b/gi;
  const match = dayRegex.exec(cleanDesc);

  if (match) {
    if (!cleanDay) {
      const d = parseInt(match[1]);
      if (d >= 1 && d <= 31) cleanDay = d;
    }
    cleanDesc = cleanDesc.replace(dayRegex, "").trim();
    cleanDesc = cleanDesc.replace(/\s+[-–,.]+\s*$/, "").trim();
  }

  const isRecurring =
    item.is_recurring || (cleanDay !== undefined && cleanDay > 0);

  return {
    ...item,
    description: cleanDesc,
    day_of_month: cleanDay,
    is_recurring: isRecurring,
  };
}

export async function financeSpecialist(context: UserContext): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  // --- ATUALIZAÇÃO NO PROMPT ABAIXO ---
  const extractionPrompt = `
    Você é um Especialista Financeiro. Converta o texto do usuário em JSON.

    INTENÇÕES:
    - "process_items": Registrar gastos, ganhos ou contas fixas.
    - "check_recurring": Consultar total de gastos fixos.
    - "check_budget_forecast": CÁLCULO DE PLANEJAMENTO. O usuário quer saber "Quanto sobra do Teto menos Fixos?".
    - "add_investment": Investimentos.
    - "configure_settings": Definir Renda, TETO/LIMITE ou Saldo.
    - "list_report": Relatório geral. USE ISTO SE O USUÁRIO DISSER: "Manda escrito", "Lista pra mim", "Escreve", "Resumo", "Situação atual" (sem passar novos valores).
    - "export_report": Exportar planilha.
    - "clarification_needed": Use APENAS se o usuário falar algo vago que NÃO seja pedido de relatório (ex: "quanto custou?").

    JSON RESPOSTA:
    {
      "intent": "...",
      "items": [ ... ],
      "current_balance": "...",
      "spending_limit": "...",
      "missing_info_question": "..."
    }
  `;

  try {
    const rawJsonString = await aiService.extractData(
      extractionPrompt,
      fullMessage
    );
    const jsonString = cleanJsonOutput(rawJsonString);
    const data: FinanceIntention = JSON.parse(jsonString);

    if (data.intent === "clarification_needed") {
      return await aiService.generatePersonaResponse(
        `Faltou informação. Pergunte: "${
          data.missing_info_question || "Pode detalhar melhor?"
        }"`,
        fullMessage,
        userConfig
      );
    }

    let actionConfirmedMessage = "";
    let processedCount = 0;

    const currentReport = await financeService.getFinanceReport(waId);

    // A. PROCESSAR ITENS
    if (
      data.intent === "process_items" ||
      (data.items && data.items.length > 0)
    ) {
      const items = data.items || [];
      const responses: string[] = [];

      for (let item of items) {
        item = sanitizeItem(item);
        if (!item.amount || !item.description) continue;

        if (item.is_recurring && item.day_of_month) {
          try {
            const created = await financeService.addRecurringTransaction(waId, {
              amount: item.amount,
              type: item.type || "expense",
              category: item.category || "Fixo",
              description: item.description,
              day_of_month: item.day_of_month,
            });
            responses.push(
              `🔄 Fixo: ${item.description} (Dia ${created.day_of_month})`
            );
          } catch (err) {
            console.error(err);
            responses.push(`❌ Erro em: ${item.description}`);
          }
        } else {
          try {
            await financeService.addTransaction(waId, {
              amount: item.amount,
              type: item.type || "expense",
              category: item.category || "Geral",
              description: item.description,
              date: item.date,
            });
            responses.push(`✅ ${item.description}: R$ ${item.amount}`);
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

    // B. PLANEJAMENTO (TETO - FIXOS)
    else if (data.intent === "check_budget_forecast") {
      const limit = currentReport.config.limite_estipulado || 0;
      const recurringData = await financeService.getRecurringExpensesTotal(
        waId
      );
      const fixedTotal = recurringData.total || 0;

      if (limit <= 0) {
        actionConfirmedMessage = `⚠️ Seu Teto de Gastos é R$ 0,00. Defina um limite para eu calcular a sobra.`;
      } else {
        const remaining = limit - fixedTotal;
        actionConfirmedMessage =
          `📊 *Planejamento Financeiro*\n\n` +
          `🎯 *Teto:* R$ ${limit.toFixed(2)}\n` +
          `🔄 *Fixos:* - R$ ${fixedTotal.toFixed(2)}\n` +
          `------------------\n` +
          `💵 *Sobra Livre:* R$ ${remaining.toFixed(2)}\n`;
      }
    }

    // C. FIXOS
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

    // D. CONFIGURAR
    else if (data.intent === "configure_settings") {
      let balanceVal = data.current_balance;
      // Lógica de saldo manual
      if (
        !balanceVal &&
        data.items &&
        data.items.length === 1 &&
        data.items[0].description.toLowerCase().includes("saldo")
      ) {
        balanceVal = data.items[0].amount;
      }
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
      await financeService.setFinanceSettings(
        waId,
        data.monthly_income,
        data.spending_limit,
        null,
        data.currency
      );
      actionConfirmedMessage = "✅ Configurações financeiras atualizadas.";
    }

    // E. RELATÓRIOS (AQUI ESTÁ A MÁGICA DO "MANDA ESCRITO")
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
            actionConfirmedMessage = `✅ Planilha: ${sheet.link}`;
          }
        } catch (e) {
          actionConfirmedMessage = "Erro ao criar planilha.";
        }
      } else {
        // --- MELHORIA: TRAZER DADOS DE PLANEJAMENTO NO RELATÓRIO GERAL ---
        const limit = updatedReport.config.limite_estipulado || 0;
        let forecastText = "";

        if (limit > 0) {
          const recurringData = await financeService.getRecurringExpensesTotal(
            waId
          );
          const fixedTotal = recurringData.total || 0;
          const remaining = limit - fixedTotal;
          forecastText = `\n🎯 *Teto:* R$ ${limit}\n🔄 *Fixos:* -R$ ${fixedTotal}\n💵 *Sobra Planejada:* R$ ${remaining.toFixed(
            2
          )}\n`;
        }

        actionConfirmedMessage =
          `📝 *Resumo Financeiro Solicitado:*\n\n` +
          `💰 *Saldo Atual:* R$ ${updatedReport.saldo_atual_conta}\n` +
          `📉 *Gastos do Mês:* R$ ${updatedReport.resumo_mes.gastos}\n` +
          `${forecastText}\n` + // Inclui o cálculo se tiver teto
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
        actionConfirmedMessage = "Investimento registrado!";
      }
    }

    if (!actionConfirmedMessage && processedCount === 0) {
      return await aiService.generatePersonaResponse(
        "Não entendi. Peça para repetir.",
        fullMessage,
        userConfig
      );
    }

    // Adiciona instrução explicita para a IA gerar o texto formatado bonitinho
    return await aiService.generatePersonaResponse(
      `O usuário pediu para escrever/listar os dados. Formate esta resposta claramente: """${actionConfirmedMessage}"""`,
      fullMessage,
      userConfig
    );
  } catch (error: any) {
    console.error(error);
    return await aiService.generatePersonaResponse(
      `Erro: ${error.message}`,
      fullMessage,
      userConfig
    );
  }
}
