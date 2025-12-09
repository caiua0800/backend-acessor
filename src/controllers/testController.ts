import { Request, Response } from "express";
import { sendWhatsAppUtility } from "../services/notificationService";

export const sendTestTemplate = async (req: Request, res: Response) => {
  // O número que você pediu
  const targetNumber = "5517992562727";

  // O conteúdo da variável {{1}}
  const messageBody =
    req.body.message || "Teste manual do Template de Utilidade! 🔔";

  try {
    console.log(`🧪 Iniciando teste de Template para ${targetNumber}...`);

    await sendWhatsAppUtility(targetNumber, messageBody);

    res.status(200).json({
      success: true,
      message: `Template 'generic_alert' enviado com sucesso para ${targetNumber}`,
      content: messageBody,
    });
  } catch (error: any) {
    console.error(
      "❌ Erro no teste de Template:",
      error.response?.data || error.message
    );
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data,
    });
  }
};
