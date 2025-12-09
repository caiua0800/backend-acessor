import { Request, Response } from "express";
import { createNewUser } from "../services/userService";

export const createUser = async (req: Request, res: Response) => {
  try {
    const {
      full_name,
      email,          // <--- NOVO
      password,       // <--- NOVO
      country_code,
      area_code,
      phone_number,
      user_nickname,
      agent_nickname,
      agent_gender,
      agent_voice_id,
      agent_personality,
    } = req.body;

    // Validação dos campos obrigatórios
    if (!full_name || !email || !password || !country_code || !area_code || !phone_number) {
      return res.status(400).json({
        error:
          "Campos obrigatórios: full_name, email, password, country_code, area_code, phone_number",
      });
    }

    // Passa todos os dados para o serviço
    const newUser = await createNewUser({
      fullName: full_name,
      email: email,       
      password: password,
      countryCode: country_code,
      areaCode: area_code,
      rawNumber: phone_number,
      userNickname: user_nickname,
      agentNickname: agent_nickname,
      agentGender: agent_gender,
      agentVoiceId: agent_voice_id,
      agentPersonality: agent_personality,
    });

    res.json({
      status: "success",
      message: "Usuário criado com sucesso!",
      user: newUser,
    });
  } catch (e: any) {
    // Tratamento de erro de duplicidade (Postgres Error 23505)
    if (e.code === "23505") {
      // Verifica qual constraint violou para dar msg melhor
      if (e.detail && e.detail.includes("email")) {
        return res.status(409).json({
            error: "Este e-mail já está cadastrado.",
        });
      }
      if (e.detail && e.detail.includes("phone_number")) {
        return res.status(409).json({
            error: "Este número de telefone já está cadastrado.",
        });
      }
      
      return res.status(409).json({
        error: "Dados duplicados (e-mail ou telefone).",
      });
    }
    // Outros erros
    res.status(500).json({ error: e.message });
  }
};