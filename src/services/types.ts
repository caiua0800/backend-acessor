// src/services/types.ts

// Mapeia o objeto de configuração que vem do seu banco de dados
export interface UserConfig {
    agent_nickname: string;
    agent_gender: string;
    agent_personality: string[]; // Array de strings (ex: ["Amigo", "Carióca"])
    user_nickname: string;
    full_name: string;
    ai_send_audio: boolean;
    // ... adicione outros campos da tabela user_configs que você precisar
}

// O objeto de contexto que passamos para cada especialista
export interface UserContext {
    waId: string;
    fullMessage: string; // original_user_message
    userName: string; // user_name
    userConfig: UserConfig; 
    // ... você pode adicionar outros dados importantes aqui
}

// Interface para o Market Specialist
export interface MarketItem {
    itemName: string;
    quantity: number;
}