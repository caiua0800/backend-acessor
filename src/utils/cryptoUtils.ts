// src/utils/cryptoUtils.ts
import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
// A chave deve vir do .env e ter 32 caracteres.
// Se não tiver, usamos um hash para garantir o tamanho, mas o ideal é definir certo no .env
const SECRET_KEY =
  process.env.ENCRYPTION_KEY || "chave_padrao_insegura_mude_no_env_32";
const KEY = crypto
  .createHash("sha256")
  .update(String(SECRET_KEY))
  .digest("base64")
  .substr(0, 32);

// Criptografa um Objeto JSON ou String
export const encryptData = (data: any): string => {
  // Transforma objeto em string
  const text = JSON.stringify(data);

  // Cria um IV aleatório (Vetor de Inicialização) para cada criptografia
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  // Retorna IV:ConteudoCriptografado (tudo em Hex)
  return iv.toString("hex") + ":" + encrypted.toString("hex");
};

// Descriptografa de volta para Objeto
export const decryptData = (text: string): any => {
  try {
    const textParts = text.split(":");
    const iv = Buffer.from(textParts.shift()!, "hex");
    const encryptedText = Buffer.from(textParts.join(":"), "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return JSON.parse(decrypted.toString());
  } catch (error) {
    console.error("Erro ao descriptografar:", error);
    return {
      error:
        "Falha ao ler dados criptografados (Chave incorreta ou dados corrompidos)",
    };
  }
};
