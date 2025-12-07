import { Request, Response } from "express";
import { createNewUser } from "../services/userService";

export const createUser = async (req: Request, res: Response) => {
  try {
    // Extrai todos os campos, incluindo os opcionais
    const {
      full_name,
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
    if (!full_name || !country_code || !area_code || !phone_number) {
      return res.status(400).json({
        error:
          "Campos obrigatórios: full_name, country_code, area_code, phone_number",
      });
    }

    // Passa todos os dados para o serviço
    const newUser = await createNewUser({
      fullName: full_name,
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
      message: "Usuário e configurações criados com sucesso!",
      user: newUser,
    });
  } catch (e: any) {
    if (e.code === "23505") {
      // Erro de telefone duplicado
      return res.status(409).json({
        error: "Já existe um usuário cadastrado com este número de telefone.",
      });
    }
    // Outros erros
    res.status(500).json({ error: e.message });
  }
};
