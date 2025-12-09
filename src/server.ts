// server.ts
import "dotenv/config"; // Garante que .env carregue primeiro
import express from "express";
import cors from "cors";
import fs from "fs";
import cron from "node-cron";

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
import gymRoutes from "./routes/gymRoutes"; // Adicionei o gymRoutes aqui caso tenha esquecido

// Importa serviços de inicialização
import { setupMemoryTable } from "./services/memoryService";
import { processNotificationQueue } from "./services/notificationService";
import todoRoutes from "./routes/todoRoutes";
import vaultRoutes from "./routes/vaultRoutes";

const app = express();

app.use(
  cors({
    origin: true, 
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"], // Todos os métodos
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "ngrok-skip-browser-warning"
    ], 
    credentials: true, // Permite envio de Cookies e Headers de Autenticação
  })
);

app.use(express.json());

const PORT = process.env.PORT || 3000;

// Configuração das Rotas
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
app.use('/vault', vaultRoutes);

async function startServer() {
  if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

  await setupMemoryTable();

  cron.schedule("* * * * *", async () => {
    await processNotificationQueue();
  });
  console.log("🕰️ Sistema de Notificações (Cron) ativado.");

  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`✅ Memória de chat configurada e pronta.`);
  });
}

startServer();
