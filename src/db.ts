import { Pool } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não definida no arquivo .env');
}

// Caminho para o certificado na raiz do projeto (backend/cert.crt)
// O ".." serve para sair da pasta 'src' e ir para a raiz
const certPath = path.join(__dirname, '..', 'cert.crt');

// Verificação de segurança: se o arquivo não existir, avisa e para.
if (!fs.existsSync(certPath)) {
    console.error(`❌ ERRO: Não encontrei o arquivo de certificado em: ${certPath}`);
    console.error('Certifique-se de que o arquivo "cert.crt" está na pasta backend (junto com package.json).');
    process.exit(1);
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: true, // Segurança máxima ATIVADA
    ca: fs.readFileSync(certPath).toString(), // Lê o conteúdo do seu cert.crt
  }
});

pool.on('error', (err) => {
  console.error('Erro inesperado no DB', err);
});

console.log('🔒 Conexão Segura (SSL) configurada com sucesso usando cert.crt');