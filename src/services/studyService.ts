// src/services/studyService.ts

import { pool } from "../db";
import { Subject, StudyPlan, StudyPlanStatus, GeneratedPlan } from "./types";

// --- HELPER CRÍTICO: Obtém ID do usuário ---
const getUserId = async (whatsappId: string): Promise<string> => {
  const res = await pool.query("SELECT id FROM users WHERE phone_number = $1", [
    whatsappId,
  ]);
  if (res.rows.length === 0)
    throw new Error("Usuário não encontrado. Crie sua conta primeiro.");
  return res.rows[0].id;
};

// --- FUNÇÕES DE MATÉRIAS (SUBJECTS) ---

// 1. Criar ou Atualizar Matéria
export const createSubject = async (
  whatsappId: string,
  name: string,
  category?: string
): Promise<Subject> => {
  const userId = await getUserId(whatsappId);
  const normalizedName = name.trim().toLowerCase();

  const res = await pool.query(
    `INSERT INTO study_subjects (user_id, name, category, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, name)
     DO UPDATE SET 
        category = COALESCE(EXCLUDED.category, study_subjects.category),
        updated_at = NOW()
     RETURNING id, name, category`,
    [userId, normalizedName, category || null]
  );
  return res.rows[0];
};

// 2. Listar Matérias
export const listSubjects = async (whatsappId: string): Promise<Subject[]> => {
  const userId = await getUserId(whatsappId);
  const res = await pool.query(
    "SELECT id, name, category FROM study_subjects WHERE user_id = $1 ORDER BY name ASC",
    [userId]
  );
  return res.rows;
};

// 3. Encontrar Matéria por Nome (para iniciar um plano)
export const findSubjectByName = async (
  whatsappId: string,
  name: string
): Promise<Subject | null> => {
  const userId = await getUserId(whatsappId);
  const normalizedName = name.trim().toLowerCase();

  const res = await pool.query(
    "SELECT id, name, category FROM study_subjects WHERE user_id = $1 AND name ILIKE $2 LIMIT 1",
    [userId, `%${normalizedName}%`]
  );
  return res.rows[0] || null;
};

// --- FUNÇÕES DE PLANOS (PLANS) ---

// 4. Iniciar/Criar Rascunho de Plano (Draft)
export const createDraftPlan = async (
  whatsappId: string,
  subjectId: string,
  contentToStudy: string
): Promise<StudyPlan> => {
  const userId = await getUserId(whatsappId);

  // 1. Arquiva planos ativos anteriores
  await pool.query(
    `UPDATE study_plans SET status = 'archived', updated_at = NOW() 
     WHERE user_id = $1 AND status IN ('draft', 'active')`,
    [userId]
  );

  // 2. Cria o novo rascunho
  const res = await pool.query(
    `INSERT INTO study_plans (user_id, subject_id, content_to_study, status, current_step)
     VALUES ($1, $2, $3, 'draft', 0)
     RETURNING id, user_id, subject_id, content_to_study, status, current_step`,
    [userId, subjectId, contentToStudy]
  );
  return res.rows[0];
};

// 5. Obter o Plano Mais Recente (Draft ou Active)
export const getLatestPlanByWaId = async (
  whatsappId: string
): Promise<StudyPlan | null> => {
  const userId = await getUserId(whatsappId);
  const res = await pool.query(
    `SELECT id, user_id, subject_id, content_to_study, generated_plan, status, current_step
     FROM study_plans 
     WHERE user_id = $1 AND status IN ('draft', 'active')
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  return res.rows[0] || null;
};

// 6. Atualizar Plano com Estrutura Gerada pela IA
export const updatePlanWithGeneratedPlan = async (
  planId: string,
  generatedPlan: GeneratedPlan
): Promise<StudyPlan> => {
  const res = await pool.query(
    `UPDATE study_plans 
     SET generated_plan = $1, status = 'active', current_step = 1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, user_id, subject_id, content_to_study, generated_plan, status, current_step`,
    [generatedPlan, planId]
  );

  if (res.rows.length === 0) throw new Error("Plano de estudo não encontrado.");

  return res.rows[0];
};

// 7. Avançar para o Próximo Passo
export const advancePlanStep = async (planId: string): Promise<StudyPlan> => {
  const res = await pool.query(
    `UPDATE study_plans 
     SET current_step = current_step + 1, updated_at = NOW()
     WHERE id = $1 AND status = 'active'
     RETURNING id, user_id, subject_id, content_to_study, generated_plan, status, current_step`,
    [planId]
  );

  if (res.rows.length === 0) throw new Error("Plano ativo não encontrado.");

  return res.rows[0];
};

// 8. Marcar Plano como Concluído
export const completePlan = async (planId: string): Promise<boolean> => {
  const res = await pool.query(
    `UPDATE study_plans 
     SET status = 'completed', updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [planId]
  );
  return res.rowCount === 1;
};

// 9. Encontrar uma Matéria pelo ID do Plano
export const getSubjectByPlanId = async (planId: string): Promise<Subject> => {
  const res = await pool.query(
    `SELECT s.id, s.name, s.category FROM study_subjects s
     JOIN study_plans p ON p.subject_id = s.id
     WHERE p.id = $1`,
    [planId]
  );
  if (res.rows.length === 0)
    throw new Error("Matéria do plano não encontrada.");
  return res.rows[0];
};
