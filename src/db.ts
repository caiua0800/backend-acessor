import { Pool } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Carrega as variáveis de ambiente, garantindo que o DB_CERT_CONTENT seja lido
dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não definida no arquivo .env');
}

// --- LÓGICA DE CARREGAMENTO DO CERTIFICADO ---
let sslConfig: any = { 
    rejectUnauthorized: true, // Sempre ativo para segurança
};

// Opção A (Recomendada para Produção): Usar o conteúdo da variável de ambiente (Secret)
if (process.env.DB_CERT_CONTENT) {
    console.log('🔒 Conexão Segura: Usando conteúdo do certificado da variável de ambiente.');
    sslConfig.ca = process.env.DB_CERT_CONTENT;
} 
// Opção B (Fallback para Desenvolvimento Local): Tenta ler o arquivo local
else {
    const certPath = path.join(__dirname, '..', 'cert.crt');
    if (!fs.existsSync(certPath)) {
        // Se não achou o arquivo E não tem a variável, o DB não vai funcionar.
        console.error(`❌ ERRO CRÍTICO: Não encontrei o arquivo de certificado em: ${certPath}`);
        console.error('Para deploy, por favor, defina a variável de ambiente DB_CERT_CONTENT.');
        process.exit(1);
    }
    console.log('🔒 Conexão Segura: Usando arquivo "cert.crt" local.');
    sslConfig.ca = fs.readFileSync(certPath).toString();
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig // Usa a configuração SSL que montamos
});

pool.on('error', (err) => {
  console.error('Erro inesperado no DB', err);
});

console.log('✅ Conexão com PostgreSQL configurada.');