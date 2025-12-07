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


const app = express();
app.use(cors({
  origin: '*'
}));
app.use(express.json());

const PORT = process.env.PORT || 3000;

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

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

app.listen(PORT, () => {
  console.log(`🚀 Servidor refatorado rodando na porta ${PORT}`);
});
