// src/specialists/vaultSpecialist.ts

import * as vaultService from "../services/vaultService";
import * as aiService from "../services/aiService";
import { UserContext } from "../services/types";

interface VaultItem {
  action: "save" | "search" | "delete" | "list";
  title?: string; // Nubank, Netflix, Wi-Fi Casa
  category?: "financeiro" | "login" | "nota" | "outros";
  content?: any; // { pix: "...", agencia: "..." }
}

function cleanJsonOutput(rawOutput: string): string {
  const start = rawOutput.indexOf("{");
  const end = rawOutput.lastIndexOf("}");
  if (start !== -1 && end !== -1) {
    return rawOutput.substring(start, end + 1);
  }
  return rawOutput;
}

export async function vaultSpecialist(context: UserContext): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  const extractionPrompt = `
    Você é um Gerente de Informações Pessoais (Cofre). Analise a mensagem e extraia a ação.

    AÇÕES ("action"):
    1. "save": Guardar informação.
       - Extraia um TÍTULO curto (ex: "Nubank", "Netflix").
       - Extraia a CATEGORIA (financeiro, login, nota).
       - Coloque TODOS os detalhes úteis num objeto "content".
       
    2. "search": Buscar informação. (Ex: "Qual meu pix?", "Minha senha da Netflix")
       - "title": termo de busca.
       
    3. "delete": Apagar.
    4. "list": Listar tudo.

    EXEMPLOS:
    - "Meu pix do Nubank é email@teste.com" -> {"action": "save", "title": "Nubank", "category": "financeiro", "content": {"pix": "email@teste.com"}}
    - "Anota aí: login do Gmail é user, senha 123" -> {"action": "save", "title": "Gmail", "category": "login", "content": {"user": "user", "pass": "123"}}
    - "Qual minha conta do Itaú?" -> {"action": "search", "title": "Itaú"}

    Retorne JSON PURO.
  `;

  try {
    const rawJson = await aiService.extractData(extractionPrompt, fullMessage);
    const jsonStr = cleanJsonOutput(rawJson);
    const data: VaultItem = JSON.parse(jsonStr);

    console.log("🔐 [VAULT DEBUG]", data);

    let responseMsg = "";
    let isSensitiveData = false;

    // 1. SALVAR
    if (data.action === "save" && data.title && data.content) {
      const result = await vaultService.saveAnnotation(waId, {
        title: data.title,
        category: data.category || "outros",
        content: data.content,
      });

      // Verifica se é dado sensível para avisar sobre criptografia
      const contentStr = JSON.stringify(data.content).toLowerCase();
      if (
        contentStr.includes("senha") ||
        contentStr.includes("pass") ||
        contentStr.includes("key") ||
        contentStr.includes("chave") ||
        contentStr.includes("token") ||
        contentStr.includes("pin")
      ) {
        isSensitiveData = true;
      }

      const securityNote = isSensitiveData
        ? " 🔒 (Dados criptografados e seguros)"
        : "";

      responseMsg =
        result.action === "created"
          ? `📝 Informações de '${data.title}' salvas no cofre.${securityNote}`
          : `📝 Informações de '${data.title}' atualizadas.${securityNote}`;
    }

    // 2. BUSCAR
    else if (data.action === "search" && data.title) {
      const items = await vaultService.searchAnnotations(waId, data.title);
      if (items.length === 0) {
        responseMsg = `Não encontrei nada sobre "${data.title}" no seu cofre.`;
      } else {
        // Formata o JSON para texto legível
        const formatted = items
          .map((i) => {
            const details = Object.entries(i.content_json)
              .map(([k, v]) => `- ${k}: ${v}`)
              .join("\n");
            return `*${i.title}* (${i.category}):\n${details}`;
          })
          .join("\n\n");
        responseMsg = `🔎 Descriptografei e encontrei isso:\n\n${formatted}`;
      }
    }

    // 3. DELETAR
    else if (data.action === "delete" && data.title) {
      const deleted = await vaultService.deleteAnnotation(waId, data.title);
      responseMsg = deleted
        ? `🗑️ '${data.title}' removido do cofre.`
        : `Não encontrei '${data.title}' para apagar.`;
    }

    // 4. LISTAR
    else if (data.action === "list") {
      const list = await vaultService.listAllAnnotations(waId);
      if (list.length === 0) responseMsg = "Seu cofre está vazio.";
      else {
        const itens = list
          .map((i) => `- ${i.title} (${i.category})`)
          .join("\n");
        responseMsg = `📂 Seus registros:\n${itens}`;
      }
    }

    if (!responseMsg) return "";

    // Instrução final para a IA de personalidade
    let systemInstruction = `Transforme esta mensagem técnica em uma resposta direta: "${responseMsg}"`;

    if (isSensitiveData) {
      systemInstruction += `\n*IMPORTANTE:* Reforce para o usuário que a senha/chave foi criptografada e que só ele tem acesso.`;
    }

    return await aiService.generatePersonaResponse(
      systemInstruction,
      fullMessage,
      userConfig
    );
  } catch (error: any) {
    console.error("❌ [VAULT ERROR]", error);
    return "Erro ao acessar o cofre de dados.";
  }
}
