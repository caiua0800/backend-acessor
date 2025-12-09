# ESTÁGIO 1: Build (Compilação do TypeScript)
# Usamos uma imagem base que tenha ferramentas como 'apt' para instalar o FFmpeg
FROM node:20 AS builder
WORKDIR /app

# 1. Instala o FFmpeg e dependências críticas
# Usamos 'node:20' em vez de 'node:20-slim' para garantir que 'apt' esteja pronto
RUN apt-get update && \
    apt-get install -y ffmpeg libopus-dev && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install
COPY . .

# Comando de compilação (tsc)
RUN npm run build

# --- FIM DO ESTÁGIO DE BUILD ---

# ESTÁGIO 2: Produção (Imagem de Execução)
# Usamos a mesma base que agora contém o FFmpeg
FROM node:20
WORKDIR /app

# 1. Instala o FFmpeg novamente (no container de produção)
# CRÍTICO: Este é o passo que garante que o FFmpeg esteja no container que irá rodar
RUN apt-get update && \
    apt-get install -y ffmpeg libopus-dev && \
    rm -rf /var/lib/apt/lists/*

# 2. Copia SOMENTE o necessário do estágio de build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# Copia o package.json para o npm start funcionar
COPY package.json ./
# O arquivo server.ts não é necessário se você estiver rodando de 'dist'
# COPY src/server.ts ./src/ 

# O comando de execução deve apontar para o código compilado em 'dist'
# Você deve ter um 'start' no seu package.json que roda 'node dist/server.js'
CMD [ "npm", "run", "start" ]