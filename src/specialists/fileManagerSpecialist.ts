import * as googleService from "../services/googleService";
import * as aiService from "../services/aiService";
import { UserContext } from "../services/types";

interface DocCreationData {
  title: string;
  content: string;
}
interface SheetCreationData {
  title: string;
}
interface AppendSheetData {
  spreadsheet_name: string;
  values: string[];
}
interface FileOperationData {
  file_name: string;
  action: "read" | "append" | "delete";
  text_content?: string;
}
interface ListData {
  list_all: boolean;
}

type FileManagerData =
  | DocCreationData
  | SheetCreationData
  | AppendSheetData
  | FileOperationData
  | ListData;

function cleanJsonOutput(rawOutput: string): string {
  const start = rawOutput.indexOf("{");
  const end = rawOutput.lastIndexOf("}");
  if (start !== -1 && end !== -1) return rawOutput.substring(start, end + 1);
  return rawOutput;
}

export async function fileManagerSpecialist(
  context: UserContext
): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  const extractionPrompt = `
    Gerente de Arquivos Google (Drive/Docs/Sheets). Extraia a intenção em JSON.

    INTENÇÕES:
    1. CRIAR DOC: "Crie um documento sobre X" -> {"title": "X", "content": "..."}
    2. CRIAR PLANILHA: "Crie uma planilha de gastos" -> {"title": "Gastos"}
    3. ESCREVER EM PLANILHA: "Adiciona na planilha gastos: almoço 20 reais" -> {"spreadsheet_name": "gastos", "values": ["almoço", "20"]}
    4. LER/EDITAR DOC: "O que tem no arquivo X?", "Escreve no doc X" -> {"file_name": "X", "action": "read"|"append", "text_content": "..."}
    5. LISTAR: "Meus arquivos" -> {"list_all": true}

    JSON OBRIGATÓRIO.
  `;

  try {
    const rawJson = await aiService.extractData(extractionPrompt, fullMessage);
    const data: FileManagerData = JSON.parse(cleanJsonOutput(rawJson));
    console.log("📂 [FILES DEBUG]", data);

    let responseMsg = "";

    // A. CRIAR DOC
    if ("content" in data && "title" in data) {
      const res = await googleService.createDoc(waId, data.title, data.content);
      responseMsg = `✅ Documento criado: ${res.title}\nLink: ${res.link}`;
    }
    // B. CRIAR SHEET
    else if ("title" in data && !("content" in data)) {
      const res = await googleService.createSheet(waId, data.title);
      responseMsg = `✅ Planilha criada: ${res.title}\nLink: ${res.link}`;
    }
    // C. ADICIONAR EM PLANILHA
    else if ("spreadsheet_name" in data && "values" in data) {
      // Busca ID
      const files = await googleService.listFiles(waId, data.spreadsheet_name);
      // Filtra só planilhas
      const sheet = files.find((f) => f.mimeType?.includes("spreadsheet"));

      if (!sheet || !sheet.id)
        throw new Error(`Não encontrei a planilha "${data.spreadsheet_name}".`);

      await googleService.appendToSheet(waId, sheet.id, data.values);
      responseMsg = `📝 Adicionado à planilha "${
        sheet.name
      }": [${data.values.join(", ")}]`;
    }
    // D. OPERAÇÃO EM DOC
    else if ("file_name" in data && "action" in data) {
      const files = await googleService.listFiles(waId, data.file_name);
      const file = files[0]; // Pega o primeiro

      if (!file || !file.id)
        throw new Error(`Arquivo "${data.file_name}" não encontrado.`);

      if (data.action === "read") {
        const doc = await googleService.readDoc(waId, file.id);
        responseMsg = `📄 Conteúdo de "${
          doc.title
        }":\n\n${doc.content.substring(0, 800)}...`;
      } else if (data.action === "append" && data.text_content) {
        await googleService.appendToDoc(waId, file.id, data.text_content);
        responseMsg = `📝 Texto adicionado ao final de "${file.name}".`;
      } else if (data.action === "delete") {
        await googleService.deleteFile(waId, file.id);
        responseMsg = `🗑️ Arquivo "${file.name}" movido para a lixeira.`;
      }
    }
    // E. LISTAR
    else if ("list_all" in data) {
      const files = await googleService.listFiles(waId);
      if (files.length === 0) responseMsg = "Seu Drive está vazio.";
      else {
        const list = files
          .map((f) => `- ${f.name} (${f.mimeType?.split(".").pop()})`)
          .join("\n");
        responseMsg = `📂 Seus arquivos recentes:\n${list}`;
      }
    }

    if (!responseMsg) return "";

    return await aiService.generatePersonaResponse(
      `Confirme a ação de arquivos: "${responseMsg}"`,
      fullMessage,
      userConfig
    );
  } catch (error: any) {
    console.error("❌ [FILES ERROR]", error);

    if (error.message.includes("AUTH_REQUIRED")) {
      const url = googleService.getAuthUrl(waId);
      return `⚠️ Preciso que você renove a permissão do Google para eu acessar seus arquivos.\n\nClique aqui: ${url}`;
    }

    return `Tive um erro com os arquivos: ${error.message}`;
  }
}
