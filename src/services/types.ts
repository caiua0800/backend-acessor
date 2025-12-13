// src/services/types.ts

// Mapeia o objeto de configuração que vem do seu banco de dados
export interface UserConfig {
  agent_nickname: string;
  agent_gender: string;
  agent_personality: string[]; // Array de strings (ex: ["Amigo", "Carióca"])
  user_nickname: string;
  full_name: string;
  ai_send_audio: boolean;
  timezone: string;
  language: string;
}

export const getDevSettings = async () => {
  // Para fins deste requisito, assumimos que as configurações de dev mode estão
  // em variáveis de ambiente, que devem ser configuradas no servidor da Digital Ocean.
  // Ex: DEV_MODE=true, DEV_PHONE_NUMBER=5517992562727, NGROK_URL=https://abcde12345.ngrok-free.app
  
  // O número deve ser normalizado (apenas dígitos), como é feito no controller.
  const devPhoneNumber = process.env.DEV_PHONE_NUMBER ? process.env.DEV_PHONE_NUMBER.replace(/\D/g, '') : null;
  const ngrokUrl = process.env.NGROK_URL || null;
  const devMode = process.env.DEV_MODE === 'true'; // A variável deve ser 'true' para ativar

  return {
    devMode,
    devPhoneNumber,
    ngrokUrl,
  };
};

// O objeto de contexto que passamos para cada especialista
export interface UserContext {
  waId: string;
  fullMessage: string; // original_user_message
  userName: string; // user_name
  userConfig: UserConfig;
}

// Interface para o Market Specialist
export interface MarketItem {
  itemName: string;
  quantity: number;
}

// ============================================================================
// NOVAS INTERFACES PARA O SPECIALIST DE ESTUDO
// ============================================================================

export interface Subject {
  id?: string; // UUID
  name: string;
  category?: string;
  user_id?: string;
  created_at?: Date;
  updated_at?: Date;
}

// Passo individual do plano (estrutura JSON que a IA irá gerar)
export interface PlanStep {
  order: number;
  task: string;
  duration?: string; // Ex: "1h 30 min", "30 minutos"
}

export interface GeneratedPlan {
  plan_steps: PlanStep[];
}

export type StudyPlanStatus = "draft" | "active" | "completed" | "archived";

// O plano de estudo completo
export interface StudyPlan {
  id: string; // UUID
  user_id: string;
  subject_id: string; // UUID
  content_to_study: string;
  generated_plan: GeneratedPlan; // JSONB
  status: StudyPlanStatus;
  current_step: number; // Índice do array plan_steps
  created_at?: Date;
  updated_at?: Date;
}
