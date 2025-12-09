import { Request, Response } from "express";
import * as userService from "../services/userService";
import { AuthRequest } from "../middlewares/authMiddleware"; // Assumindo este caminho

// POST /users/create (Rota de cadastro - SEM PROTEÇÃO JWT)
export const createUser = async (req: Request, res: Response) => {
  try {
    const {
      full_name,
      email,
      password,
      country_code,
      area_code,
      phone_number,
      user_nickname,
      agent_nickname,
      agent_gender,
      agent_voice_id,
      agent_personality,
      // NOVO: Recebe o token do Google do Frontend
      google_refresh_token 
    } = req.body;

    if (!full_name || !email || !password || !country_code || !area_code || !phone_number) {
      return res.status(400).json({ error: "Campos obrigatórios faltando." });
    }

    const newUser = await userService.createNewUser({
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
      googleRefreshToken: google_refresh_token,
    });

    res.json({
      status: "success",
      message: "Usuário criado com sucesso!",
      user: newUser,
    });
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "E-mail ou telefone já cadastrado." });
    }
    res.status(500).json({ error: e.message });
  }
};

// PUT /users/phone (Rota protegida - USA JWT)
export const updatePhone = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!; // Pega o ID do Token
    const { country_code, area_code, phone_number } = req.body;

    if (!country_code || !area_code || !phone_number) {
      return res
        .status(400)
        .json({ error: "Todos os campos do telefone são obrigatórios." });
    }

    const updated = await userService.updatePhoneNumber(
      userId,
      country_code,
      area_code,
      phone_number
    );

    res.json({
      status: "success",
      message: "Telefone atualizado com sucesso.",
      user: updated,
    });
  } catch (e: any) {
    // Erro de duplicidade no update
    if (e.message.includes("já está sendo usado")) {
      return res.status(409).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
};

// PATCH /users/config (Rota protegida - USA JWT)
export const updateConfig = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!; // Pega o ID do Token
    const dataToUpdate = req.body; // Aceita userNickname, ai_send_audio, etc.

    const updated = await userService.updateUserConfigs(userId, dataToUpdate);

    if (!updated) {
      return res.status(404).json({ error: "Configurações não encontradas." });
    }

    res.json({
      status: "success",
      message: "Configurações atualizadas com sucesso.",
      config: updated,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
