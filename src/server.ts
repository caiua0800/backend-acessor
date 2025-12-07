// server.ts
import "dotenv/config"; // Garante que .env carregue primeiro
import express from "express";
import cors from "cors";
import fs from "fs";

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

// CORREÇÃO: Importa a função de setup de memória
import { setupMemoryTable } from "./services/memoryService";


const app = express();
app.use(cors({
  origin: '*'
}));
app.use(express.json());

const PORT = process.env.PORT || 3000;

// O código de criação de pasta de uploads foi movido para o bloco de inicialização.

app.use("/auth", authRoutes);
app.use("/calendar", calendarRoutes);
app.use("/finance", financeRoutes);
app.use("/gmail", gmailRoutes);
app.use("/media", mediaRoutes);
app.use("/users", userRoutes);
app.use('/webhook/whatsapp', whatsappRoutes);
app.use("/market-list", marketListRoutes);
app.use('/investments', investmentRoutes);
app.use('/ideas', ideaRoutes);
app.use('/goals', goalsRoutes);
app.use('/docs', docsRoutes);
app.use('/sheets', sheetsRoutes);
app.use('/drive', driveRoutes);

// Função principal de inicialização
async function startServer() {
  // CRIAÇÃO DA PASTA DE UPLOADS (CÓDIGO ORIGINAL SEU)
  if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
  
  // CORREÇÃO CRÍTICA: GARANTE QUE A TABELA DE MEMÓRIA EXISTA ANTES DE TUDO
  await setupMemoryTable(); 

  app.listen(PORT, () => {
    console.log(`🚀 Servidor refatorado rodando na porta ${PORT}`);
    console.log(`✅ Memória de chat configurada e pronta.`);
  });
}

// Chama a função de inicialização
startServer();