import * as financeService from "../services/financeService";
import * as googleService from "../services/googleService";
import * as aiService from "../services/aiService";
import { UserContext } from "../services/types";
import moment from "moment-timezone";

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
    | "confirmation"; // <--- NOVO: Para parar o loop do "Sim"

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

// Helper para construir data ISO baseada no dia informado pelo usuário
function buildDateFromDay(day: number): string {
  const now = moment().tz("America/Sao_Paulo");
  // Se o dia informado for maior que o dia de hoje, assume que foi no mês passado (ex: hoje é 10, usuário diz "dia 28")
  // Ou mantém no mês atual se for intenção futura. 
  // Lógica padrão: Mesma competência (Mês atual).
  const date = now.clone().date(day);
  return date.format(); // Retorna ISO
}

function sanitizeItem(item: FinanceItem): FinanceItem {
  let cleanDesc = item.description;
  let cleanDay = item.day_of_month;

  // Regex para capturar "dia 1", "vence dia 10", etc.
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

  // CORREÇÃO CRÍTICA:
  // Só marca como RECORRENTE se a IA identificou explicitamente (is_recurring)
  // OU se a descrição contém palavras chave de repetição.
  // NÃO força recorrente só porque tem dia.
  const isReallyRecurring = item.is_recurring || /todo|mensal|fixo|assinatura/i.test(cleanDesc);

  // Se tem dia mas NÃO é recorrente, calculamos a data ISO para ser um gasto pontual
  let finalDate = item.date;
  if (!isReallyRecurring && cleanDay && !finalDate) {
      finalDate = buildDateFromDay(cleanDay);
  }

  return {
    ...item,
    description: cleanDesc,
    day_of_month: cleanDay,
    is_recurring: isReallyRecurring,
    date: finalDate
  };
}

export async function financeSpecialist(context: UserContext): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  const extractionPrompt = `
    Você é um Especialista Financeiro. Converta o texto do usuário em JSON.

    INTENÇÕES:
    - "process_items": Registrar gastos ou ganhos.
      IMPORTANTE: Se o usuário disser "dia 1" ou "data tal", inclua isso.
      IMPORTANTE: Só marque "is_recurring": true se for algo FIXO (Todo mês, Assinatura, Aluguel). Se for gasto comum ("Uber dia 1"), é false.
    
    - "check_recurring": Consultar total de gastos fixos.
    - "check_budget_forecast": O usuário quer saber "Quanto sobra do Teto menos Fixos?".
    - "add_investment": Investimentos.
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
      "spending_limit": "..."
    }
  `;

  try {
    const rawJsonString = await aiService.extractData(
      extractionPrompt,
      fullMessage
    );
    const jsonString = cleanJsonOutput(rawJsonString);
    const data: FinanceIntention = JSON.parse(jsonString);

    // --- BLOQUEIO DO LOOP DE IDIOTA ---
    if (data.intent === "confirmation") {
        return await aiService.generatePersonaResponse(
            "O usuário confirmou que está tudo certo. Responda com algo curto e positivo tipo 'Show!', 'Maravilha!', 'Combinado'.",
            fullMessage,
            userConfig
        );
    }

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
        item = sanitizeItem(item); // Agora sanitizeItem não força recorrente erradamente
        if (!item.amount || !item.description) continue;

        // SE FOR RECORRENTE (FIXO)
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
              `🔄 Fixo Agendado: ${item.description} (Dia ${created.day_of_month})`
            );
          } catch (err) {
            console.error(err);
            responses.push(`❌ Erro em: ${item.description}`);
          }
        } 
        // SE FOR TRANSAÇÃO COMUM (MESMO QUE TENHA DATA ESPECÍFICA)
        else {
          try {
            await financeService.addTransaction(waId, {
              amount: item.amount,
              type: item.type || "expense",
              category: item.category || "Geral",
              description: item.description,
              date: item.date, // Passa a data calculada (ex: dia 1 do mês atual)
            });
            
            // Formata a data para a resposta ficar clara
            const dateInfo = item.date ? ` (${moment(item.date).format('DD/MM')})` : "";
            responses.push(`✅ Registrado: ${item.description}: R$ ${item.amount}${dateInfo}`);
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

    // E. RELATÓRIOS
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
        actionConfirmedMessage = "Investimento registrado!";
      }
    }

    if (!actionConfirmedMessage && processedCount === 0) {
      return await aiService.generatePersonaResponse(
        "Não entendi a movimentação financeira. Peça para repetir com valores claros.",
        fullMessage,
        userConfig
      );
    }

    return await aiService.generatePersonaResponse(
      `Confirme a ação financeira: """${actionConfirmedMessage}""". Se for um gasto pontual, apenas confirme que foi registrado.`,
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