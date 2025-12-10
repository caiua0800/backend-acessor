// src/server.ts

import "dotenv/config"; // Garante que .env carregue primeiro
import express from "express";
import cors from "cors";
import fs from "fs";
import cron from "node-cron";
import swaggerUi from "swagger-ui-express"; // NOVO: SWAGGER
import YAML from "yamljs"; // NOVO: SWAGGER

// Importa todas as suas rotas
import authRoutes from "./routes/authRoutes";
import calendarRoutes from "./routes/calendarRoutes";
import financeRoutes from "./routes/financeRoutes";
import gmailRoutes from "./routes/gmailRoutes";
import mediaRoutes from "./routes/mediaRoutes";
import userRoutes from "./routes/userRoutes";
import whatsappRoutes from "./routes/whatsappRoutes";
import marketListRoutes from "./routes/marketListRoutes";
import investmentRoutes from "./routes/investmentRoutes";
import ideaRoutes from "./routes/ideaRoutes";
import goalsRoutes from "./routes/goalsRoutes";
import docsRoutes from "./routes/docsRoutes";
import sheetsRoutes from "./routes/sheetsRoutes";
import driveRoutes from "./routes/driveRoutes";
import testRoutes from "./routes/testRoutes";
import gymRoutes from "./routes/gymRoutes";
import todoRoutes from "./routes/todoRoutes";
import vaultRoutes from "./routes/vaultRoutes";
import studyRoutes from "./routes/studyRoutes"; // NOVO: ROTAS DE ESTUDO

// Importa serviços de inicialização
import { setupMemoryTable } from "./services/memoryService";
import { processNotificationQueue } from "./services/notificationService";
import { processDailyRecurringTransactions } from "./services/financeService";

const app = express();

// --- CONFIGURAÇÃO SWAGGER / OPENAPI ---
// Carrega o arquivo de definição na raiz do projeto (swagger.yaml)
const swaggerDocument = YAML.load("./swagger.yaml");

// --- CONFIGURAÇÃO CORS PERMISSIVA (BLINDADA) ---
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "ngrok-skip-browser-warning",
    ],
    credentials: true,
  })
);

app.use(express.json());

// CRÍTICO: Usa a porta 8080 para o Health Check do DigitalOcean/Render
const PORT = process.env.PORT || 8080;

// ===========================================
// CONFIGURAÇÃO DAS ROTAS E MIDDLEWARE
// ===========================================

// 1. ROTAS DE DOCUMENTAÇÃO (SWAGGER UI)
// Configura a interface visual do Swagger UI em /api-docs
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerDocument, {
    // Personalização para dar o "estilo de IA"
    customCss: ".swagger-ui .topbar { background-color: #3f51b5; }",
    customSiteTitle: "AI Assistant Backend - Documentação API",
    customfavIcon: "https://seulogo.com/favicon-ai.png",
    customCssUrl:
      "https://fonts.googleapis.com/css2?family=Roboto:wght@300;700&display=swap",
  })
);

// 2. ROTAS DA APLICAÇÃO
app.use("/auth", authRoutes);
app.use("/calendar", calendarRoutes);
app.use("/finance", financeRoutes);
app.use("/gmail", gmailRoutes);
app.use("/media", mediaRoutes);
app.use("/users", userRoutes);
app.use("/webhook/whatsapp", whatsappRoutes);
app.use("/market-list", marketListRoutes);
app.use("/investments", investmentRoutes);
app.use("/ideas", ideaRoutes);
app.use("/goals", goalsRoutes);
app.use("/docs", docsRoutes);
app.use("/sheets", sheetsRoutes);
app.use("/drive", driveRoutes);
app.use("/test", testRoutes);
app.use("/gym", gymRoutes);
app.use("/todo", todoRoutes);
app.use("/vault", vaultRoutes);
app.use("/study", studyRoutes); // <-- NOVO: ROTAS DE ESTUDO

async function initializeServices() {
  try {
    // 1. Conexão lenta com o DB
    await setupMemoryTable();
    console.log("✅ Memória de chat configurada e pronta.");

    // --- EXECUÇÃO IMEDIATA (GARANTIA DE NÃO PERDA DE EVENTOS) ---
    console.log(
      "⏳ Executando tarefas pendentes (Notificações & Financeiro)..."
    );

    // Executa as Notificações pendentes
    await processNotificationQueue().catch((e) =>
      console.error("❌ Erro na Execução Inicial de Notificações:", e)
    );

    // Executa as Transações Fixas pendentes (se o servidor ficou offline)
    await processDailyRecurringTransactions().catch((e) =>
      console.error("❌ Erro na Execução Inicial Financeira:", e)
    );

    // -----------------------------------------------------------

    // 2. CRON DE NOTIFICAÇÕES (Minuto a minuto)
    cron.schedule("* * * * *", async () => {
      await processNotificationQueue().catch((e) =>
        console.error("❌ Erro no Cron Notificações:", e)
      );
    });

    // 3. CRON FINANCEIRO (Diário agendado)
    cron.schedule(
      "0 6 * * *",
      async () => {
        console.log("⏰ Iniciando verificação diária de gastos fixos...");
        await processDailyRecurringTransactions().catch((e) =>
          console.error("❌ Erro no Cron Financeiro:", e)
        );
      },
      {
        timezone: "America/Sao_Paulo", // Importante para garantir o dia certo
      }
    );

    console.log("🕰️ Sistema de Crons (Notificação e Financeiro) ativado.");
  } catch (e) {
    console.error("💥 ERRO FATAL NA INICIALIZAÇÃO DE SERVIÇOS:", e);
  }
}

// --- LÓGICA PRINCIPAL (Começa a Escutar Imediatamente) ---
(async () => {
  try {
    // 1. Cria a pasta (Rápido e não depende de nada)
    if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

    // 2. INICIA O SERVIDOR EXPRESS
    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando e RESPONDENDO na porta ${PORT}`);
      console.log(
        `📑 Documentação Swagger disponível em http://localhost:${PORT}/api-docs`
      );

      // 3. Inicia os serviços lentos em SEGUNDO PLANO
      initializeServices();
    });
  } catch (e) {
    console.error("💥 ERRO FATAL AO INICIAR SERVIDOR:", e);
    process.exit(1);
  }
})();
