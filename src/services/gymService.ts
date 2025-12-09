import { pool } from "../db";

// Interfaces
export interface HealthSettings {
  weight?: number;
  height?: number;
  age?: number;
  gender?: string;
  goal?: string;
  restrictions?: string;
}

export interface WorkoutData {
  day_of_week: string; // 'monday', 'tuesday'...
  focus: string; // 'Peito', 'Leg Day'
  exercises: any[]; // Array de objetos
}

// Helper interno para o BOT (não usado pelas rotas de API direta)
const getUserId = async (whatsappId: string) => {
  const res = await pool.query("SELECT id FROM users WHERE phone_number = $1", [
    whatsappId,
  ]);
  if (res.rows.length === 0) throw new Error("Usuário não encontrado.");
  return res.rows[0].id;
};

// ============================================================================
// 🤖 FUNÇÕES PARA O BOT (VIA WHATSAPP ID) - MANTIDAS IGUAIS
// ============================================================================

export const getHealthSettings = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);
  const res = await pool.query(
    "SELECT * FROM user_health_settings WHERE user_id = $1",
    [userId]
  );
  return res.rows[0] || null;
};

export const setHealthSettings = async (
  whatsappId: string,
  data: HealthSettings
) => {
  const userId = await getUserId(whatsappId);

  // Upsert (Insere ou Atualiza)
  const res = await pool.query(
    `INSERT INTO user_health_settings (user_id, weight, height, age, gender, goal, restrictions, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
        weight = COALESCE(EXCLUDED.weight, user_health_settings.weight),
        height = COALESCE(EXCLUDED.height, user_health_settings.height),
        age = COALESCE(EXCLUDED.age, user_health_settings.age),
        goal = COALESCE(EXCLUDED.goal, user_health_settings.goal),
        restrictions = COALESCE(EXCLUDED.restrictions, user_health_settings.restrictions),
        updated_at = NOW()
     RETURNING *`,
    [
      userId,
      data.weight,
      data.height,
      data.age,
      data.gender,
      data.goal,
      data.restrictions,
    ]
  );
  return res.rows[0];
};

export const saveWorkout = async (whatsappId: string, workout: WorkoutData) => {
  const userId = await getUserId(whatsappId);
  const dayNormalized = workout.day_of_week.toLowerCase().trim();

  const res = await pool.query(
    `INSERT INTO user_workouts (user_id, day_of_week, focus, exercises_json, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, day_of_week) DO UPDATE SET
        focus = $3,
        exercises_json = $4,
        updated_at = NOW()
     RETURNING *`,
    [userId, dayNormalized, workout.focus, JSON.stringify(workout.exercises)]
  );
  return res.rows[0];
};

export const getFullWeeklyPlan = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);
  // Ordenação customizada para dias da semana
  const res = await pool.query(
    `
    SELECT * FROM user_workouts 
    WHERE user_id = $1
    ORDER BY CASE day_of_week
      WHEN 'monday' THEN 1
      WHEN 'tuesday' THEN 2
      WHEN 'wednesday' THEN 3
      WHEN 'thursday' THEN 4
      WHEN 'friday' THEN 5
      WHEN 'saturday' THEN 6
      WHEN 'sunday' THEN 7
      ELSE 8 END
  `,
    [userId]
  );

  return res.rows;
};

// ============================================================================
// 📱 FUNÇÕES PARA A API / CONTROLLER (VIA USER ID / TOKEN)
// ============================================================================

export const getHealthSettingsByUserId = async (userId: string) => {
  const res = await pool.query(
    "SELECT * FROM user_health_settings WHERE user_id = $1",
    [userId]
  );
  return res.rows[0] || null;
};

export const setHealthSettingsByUserId = async (
  userId: string,
  data: HealthSettings
) => {
  const res = await pool.query(
    `INSERT INTO user_health_settings (user_id, weight, height, age, gender, goal, restrictions, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
        weight = COALESCE(EXCLUDED.weight, user_health_settings.weight),
        height = COALESCE(EXCLUDED.height, user_health_settings.height),
        age = COALESCE(EXCLUDED.age, user_health_settings.age),
        goal = COALESCE(EXCLUDED.goal, user_health_settings.goal),
        restrictions = COALESCE(EXCLUDED.restrictions, user_health_settings.restrictions),
        updated_at = NOW()
     RETURNING *`,
    [
      userId,
      data.weight,
      data.height,
      data.age,
      data.gender,
      data.goal,
      data.restrictions,
    ]
  );
  return res.rows[0];
};

export const getFullWeeklyPlanByUserId = async (userId: string) => {
  const res = await pool.query(
    `
    SELECT * FROM user_workouts 
    WHERE user_id = $1
    ORDER BY CASE day_of_week
      WHEN 'monday' THEN 1
      WHEN 'tuesday' THEN 2
      WHEN 'wednesday' THEN 3
      WHEN 'thursday' THEN 4
      WHEN 'friday' THEN 5
      WHEN 'saturday' THEN 6
      WHEN 'sunday' THEN 7
      ELSE 8 END
  `,
    [userId]
  );

  return res.rows;
};

export const saveWorkoutByUserId = async (
  userId: string,
  workout: WorkoutData
) => {
  const dayNormalized = workout.day_of_week.toLowerCase().trim();

  const res = await pool.query(
    `INSERT INTO user_workouts (user_id, day_of_week, focus, exercises_json, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, day_of_week) DO UPDATE SET
        focus = $3,
        exercises_json = $4,
        updated_at = NOW()
     RETURNING *`,
    [userId, dayNormalized, workout.focus, JSON.stringify(workout.exercises)]
  );
  return res.rows[0];
};
