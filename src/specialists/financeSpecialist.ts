// src/specialists/financeSpecialist.ts

import * as financeService from "../services/financeService";
import * as googleService from "../services/googleService";
import * as aiService from "../services/aiService";
import { UserContext } from "../services/types";

interface FinanceIntention {
  intent: string;
  amount?: string;
  type?: "income" | "expense";
  category?: string;
  description?: string;
  asset_name?: string;
  monthly_income?: string;
  spending_limit?: string;
  current_balance?: string; // Campo crucial para configurar saldo
  currency?: string;
  items?: any[];
  export_format?: "sheet" | "doc";

  // Campos de transação pontual
  date?: string;

  // Campos de Recorrência (Novos)
  is_recurring?: boolean;
  day_of_month?: number;
}

function cleanJsonOutput(rawOutput: string): string {
  const start = rawOutput.indexOf("{");
  const end = rawOutput.lastIndexOf("}");
  if (start !== -1 && end !== -1) {
    return rawOutput.substring(start, end + 1);
  }
  return rawOutput;
}

// Helper para verificar intenção de config
function isConfigIntent(
  intent: string,
  msg: string,
  isConfigured: boolean,
  data: any
) {
  return (
    intent === "configure_settings" ||
    (!isConfigured && intent === "add_transaction" && !data.items) ||
    msg.toLowerCase().includes("organizar") ||
    msg.toLowerCase().includes("ajuda com dinheiro")
  );
}

export async function financeSpecialist(context: UserContext): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  const extractionPrompt = `
    Você é um Especialista Financeiro. Analise a mensagem e extraia os dados em JSON.

    INTENÇÕES ("intent"):
    - "add_transaction": Gastos ou Ganhos pontuais.
    - "add_recurring": Gastos ou Ganhos FIXOS/MENSAIS.
    - "add_investment": Investimentos.
    - "configure_settings": Definir Renda, Limite ou Saldo.
    - "list_report": Ver relatórios no chat.
    - "export_report": Criar planilha/doc.

    REGRAS DE EXTRAÇÃO:
    1. VALOR, TIPO E DATA SÃO PRIORIDADE.
    2. SALDO/CONFIGURAÇÃO: Se o usuário pedir para *atualizar o saldo*, use o campo "current_balance" com o valor.
    3. DESCRIÇÃO: Extraia o máximo de detalhes possível sobre O QUE FOI PAGO ou O QUE FOI RECEBIDO e a DATA. (Ex: "jantar com a namorada dia 5").
    4. FLUXO: "Gastei 170" -> "add_transaction" (expense).
    
    RESPOSTA OBRIGATÓRIA (JSON PURO):
    {
      "intent": "...",
      "amount": "valor",
      "type": "income ou expense",
      "description": "Detalhe da transação e data/dia", 
      "category": "Categoria (se mencionada)",
      "date": "YYYY-MM-DD",
      "current_balance": "valor do saldo atualizado (se for uma atualização de saldo)"
    }
  `;

  try {
    const rawJsonString = await aiService.extractData(
      extractionPrompt,
      fullMessage
    );
    const jsonString = cleanJsonOutput(rawJsonString);
    const data: FinanceIntention = JSON.parse(jsonString);

    const intent = data.intent || "unknown";
    console.log("🔍 [FINANCE DEBUG] Dados Extraídos (Partial):", {
      intent,
      amount: data.amount,
      description: data.description,
      date: data.date,
      current_balance: data.current_balance,
    });

    let actionConfirmedMessage = "";
    let isNewInvestment = false;
    let initialSetupComplete = false;

    const currentReport = await financeService.getFinanceReport(waId);
    const isConfigured =
      currentReport.config.limite_estipulado > 0 ||
      currentReport.config.renda_estipulada > 0;

    // A. CONFIGURAR
    if (isConfigIntent(intent, fullMessage, isConfigured, data)) {
      const incomeToSave = data.monthly_income
        ? financeService.parseMoney(data.monthly_income)
        : null;
      const limitToSave = data.spending_limit
        ? financeService.parseMoney(data.spending_limit)
        : null;

      let balanceToPassToSettings = null;

      // 🛑 FALLBACK CRÍTICO: Move 'amount' para 'current_balance' se a intenção for configurar.
      if (
        !data.current_balance &&
        data.amount &&
        intent === "configure_settings"
      ) {
        data.current_balance = data.amount;
        console.log(
          `🔍 [FINANCE DEBUG] FALLBACK: Movendo 'amount' (${data.amount}) para 'current_balance' para forçar ajuste.`
        );
      }

      if (data.current_balance) {
        const newBalanceVal = financeService.parseMoney(data.current_balance);
        const oldBalanceVal = currentReport.saldo_atual_conta;
        const diff = newBalanceVal - oldBalanceVal;

        console.log(
          `🔍 [FINANCE DEBUG] Saldo - Novo: ${newBalanceVal}, Antigo: ${oldBalanceVal}, Diff: ${diff}`
        );

        if (Math.abs(diff) > 0.01) {
          const type = diff > 0 ? "income" : "expense";
          const description =
            oldBalanceVal === 0 ? "Saldo Inicial" : "Ajuste Manual de Saldo";

          console.log(
            `🔍 [FINANCE DEBUG] Criando transação de ajuste: ${type}, Valor: ${Math.abs(
              diff
            )}`
          );

          try {
            await financeService.addTransaction(waId, {
              amount: Math.abs(diff),
              type: type,
              category: "Ajuste de Saldo",
              description: description,
              date: new Date().toISOString(),
            });
            console.log(
              `🔍 [FINANCE DEBUG] Transação de ajuste CONCLUÍDA com sucesso.`
            );
          } catch (e) {
            console.error(
              `❌ [FINANCE ERROR] Falha CRÍTICA ao criar transação de ajuste:`,
              e
            );
            // Se falhar a transação, a próxima função manterá o saldo antigo.
          }

          balanceToPassToSettings = null; // CRÍTICO: Deixa null para setFinanceSettings não sobrescrever o saldo que já foi ajustado pela transação.
        }
      }

      console.log(
        `🔍 [FINANCE DEBUG] Chamando setFinanceSettings (Renda: ${incomeToSave}, Limite: ${limitToSave}, Saldo Passado: ${balanceToPassToSettings})`
      );

      await financeService.setFinanceSettings(
        waId,
        incomeToSave,
        limitToSave,
        balanceToPassToSettings,
        data.currency || "BRL"
      );

      const updatedReport = await financeService.getFinanceReport(waId);
      actionConfirmedMessage = `Perfil atualizado! Renda: ${updatedReport.config.renda_estipulada}, Limite: ${updatedReport.config.limite_estipulado}, Saldo: ${updatedReport.saldo_atual_conta}`;
      initialSetupComplete = true;
    }

    // B. ADICIONAR RECORRÊNCIA
    else if (data.intent === "add_recurring" || data.is_recurring) {
      if (data.amount && data.type) {
        console.log(`🔍 [FINANCE DEBUG] Registrando transação recorrente.`);
        const created = await financeService.addRecurringTransaction(waId, {
          amount: data.amount,
          type: data.type,
          category: data.category,
          description: data.description,
          day_of_month: data.day_of_month,
        });

        actionConfirmedMessage = `🔄 Configurado! ${
          data.type === "income" ? "Entrada" : "Saída"
        } fixa de R$ ${data.amount} cadastrada para todo dia ${
          created.day_of_month
        }.`;
      }
    }

    // C. ADICIONAR TRANSAÇÃO PONTUAL
    else if (intent === "add_transaction") {
      let transactionsToProcess: any[] = [];
      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        transactionsToProcess = data.items;
      } else if (data.amount && data.type) {
        transactionsToProcess = [
          {
            amount: data.amount,
            type: data.type,
            description: data.description,
            category: data.category,
            date: data.date,
          },
        ];
      }

      if (transactionsToProcess.length > 0) {
        let totalIncome = 0;
        let totalExpense = 0;

        console.log(
          `🔍 [FINANCE DEBUG] Processando ${transactionsToProcess.length} transações pontuais.`
        );

        for (const item of transactionsToProcess) {
          if (!item.amount) continue;

          await financeService.addTransaction(waId, {
            amount: item.amount,
            type: item.type,
            category:
              item.category || (item.type === "income" ? "Entrada" : "Geral"),
            description: item.description || "",
            date: item.date,
          });
          const val = financeService.parseMoney(item.amount);
          if (item.type === "income") totalIncome += val;
          else totalExpense += val;
        }

        const updatedReport = await financeService.getFinanceReport(waId);
        actionConfirmedMessage = `Registrado! Saldo atual: ${updatedReport.saldo_atual_conta}.`;
      }
    }

    // D. INVESTIMENTO
    else if (intent === "add_investment") {
      if (data.amount && data.asset_name) {
        console.log(`🔍 [FINANCE DEBUG] Registrando novo investimento.`);
        await financeService.addInvestment(waId, data.asset_name, data.amount);
        actionConfirmedMessage = `Investimento de ${data.amount} em '${data.asset_name}' registrado.`;
        isNewInvestment = true;
      }
    }

    // E. RELATÓRIOS E EXPORTAÇÃO
    else if (intent === "list_report" || intent === "export_report") {
      const report = await financeService.getFinanceReport(waId);
      const transactions = await financeService.getLastTransactions(waId, 50);

      console.log(`🔍 [FINANCE DEBUG] Gerando relatório/exportação.`);

      // --- EXPORTAR PARA GOOGLE SHEETS ---
      if (intent === "export_report" && data.export_format === "sheet") {
        try {
          const dateStr = new Date()
            .toLocaleDateString("pt-BR")
            .replace(/\//g, "-");
          const sheetTitle = `Relatório Financeiro - ${dateStr}`;
          const sheet = await googleService.createSheet(waId, sheetTitle);

          if (!sheet.id)
            throw new Error("Erro: O Google não retornou o ID da planilha.");

          await googleService.appendToSheet(waId, sheet.id, [
            "DATA",
            "TIPO",
            "CATEGORIA",
            "DESCRIÇÃO",
            "VALOR",
          ]);

          for (const t of transactions) {
            const tDate = new Date(t.date).toLocaleDateString("pt-BR");
            const tType = t.type === "income" ? "Entrada" : "Saída";
            const tVal = t.amount.toString().replace(".", ",");

            const tCategory = t.category || "-";
            const tDesc = t.description || "-";

            await googleService.appendToSheet(waId, sheet.id, [
              tDate,
              tType,
              tCategory,
              tDesc,
              tVal,
            ]);
          }

          await googleService.appendToSheet(waId, sheet.id, [
            "",
            "",
            "",
            "",
            "",
          ]);
          await googleService.appendToSheet(waId, sheet.id, [
            "RESUMO",
            "",
            "",
            "SALDO ATUAL",
            report.saldo_atual_conta.toString(),
          ]);

          actionConfirmedMessage = `✅ Criei sua planilha com todas as movimentações!\nLink: ${sheet.link}`;
        } catch (sheetError: any) {
          console.error("Erro ao criar sheet:", sheetError);
          if (sheetError.message.includes("AUTH_REQUIRED")) {
            const url = googleService.getAuthUrl(waId);
            return `Preciso de permissão no Google para criar a planilha. Autorize aqui: ${url}`;
          }
          actionConfirmedMessage =
            "Tentei criar a planilha mas tive um erro técnico.";
        }
      }

      // --- RELATÓRIO NO CHAT ---
      else {
        let statementText = "";
        if (transactions.length > 0) {
          const list = transactions
            .slice(0, 10)
            .map((t) => {
              const symbol = t.type === "income" ? "🟢" : "🔴";
              const dateStr = new Date(t.date).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
              });
              return `${symbol} ${dateStr} - ${
                t.description || t.category || "Geral"
              }: R$ ${t.amount}`;
            })
            .join("\n");
          statementText = `\n\n📜 *Últimas Movimentações:*\n${list}`;
        } else {
          statementText = "\n\n(Sem transações recentes)";
        }

        actionConfirmedMessage = `
          💰 *Saldo Atual:* R$ ${report.saldo_atual_conta}
          📊 *Mês Atual:* Entradas R$ ${report.resumo_mes.ganhos} | Saídas R$ ${report.resumo_mes.gastos}
          ${statementText}
          `;
      }
    } else if (intent === "list_investments") {
      const investments = await financeService.listInvestments(waId);
      const items = investments.summary_by_asset
        .map((i) => `${i.asset}: ${i.total}`)
        .join(", ");
      actionConfirmedMessage = `Carteira: ${items}`;
    }

    if (!actionConfirmedMessage) return "";

    let systemInstruction = `Transforme esta mensagem técnica em resposta natural:\n"""${actionConfirmedMessage}"""`;

    if (initialSetupComplete)
      systemInstruction += `\n*ADICIONE NO FINAL:* "Tudo pronto!"`;
    if (isNewInvestment)
      systemInstruction += `\n*PERGUNTE:* "Quer lançar como saída da conta corrente também?"`;

    return await aiService.generatePersonaResponse(
      systemInstruction,
      fullMessage,
      userConfig
    );
  } catch (error: any) {
    console.error(`❌ [FINANCE ERROR] Erro não capturado:`, error);
    return await aiService.generatePersonaResponse(
      `Erro técnico: "${error.message}".`,
      fullMessage,
      userConfig
    );
  }
}
