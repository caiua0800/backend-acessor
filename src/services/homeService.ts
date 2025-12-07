import { google } from "googleapis";
import { pool } from "../db";

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const PROJECT_ID = process.env.GOOGLE_HOME_PROJECT_ID;

export const getHomeAuthUrl = (whatsappId: string) => {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    state: whatsappId,
    scope: [
      "https://www.googleapis.com/auth/sdm.service", // Casa
      "https://www.googleapis.com/auth/calendar", // Calendar
    ],
  });
};

const getSdmClient = async (whatsappId: string) => {
  const res = await pool.query(
    `SELECT i.google_refresh_token 
         FROM user_integrations i
         JOIN users u ON u.id = i.user_id
         WHERE u.phone_number = $1`,
    [whatsappId]
  );

  if (res.rows.length === 0) throw new Error("AUTH_REQUIRED");

  const refreshToken = res.rows[0].google_refresh_token;
  // O token é achado, mas não tem o escopo SDM, então a próxima chamada falha
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  // ESTA CHAMADA FALHA POR PERMISSÃO:
  return google.smartdevicemanagement({ version: "v1", auth: oauth2Client });
};

export const listDevices = async (whatsappId: string) => {
  const sdm = await getSdmClient(whatsappId);
  const res = await sdm.enterprises.devices.list({
    parent: `enterprises/${PROJECT_ID}`,
  });

  return (
    res.data.devices?.map((d) => {
      const deviceId = d.name?.split("/").pop();
      let type = d.type;
      const traits = d.traits || {};
      let status = "Desconhecido";

      if (traits["sdm.devices.traits.OnOff"]) {
        status = traits["sdm.devices.traits.OnOff"].on ? "Ligado" : "Desligado";
      }

      return {
        id: deviceId,
        full_name: d.name,
        type: type,
        status: status,
        traits: Object.keys(traits),
      };
    }) || []
  );
};

export const executeHomeCommand = async (
  whatsappId: string,
  deviceId: string,
  action: string,
  value?: any
) => {
  const sdm = await getSdmClient(whatsappId);
  let commandName = "";
  let params = {};

  if (action === "on" || action === "off") {
    commandName = "sdm.devices.commands.OnOff.SetOnOff";
    params = { on: action === "on" };
  } else if (action === "set_temp") {
    commandName = "sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat";
    params = { heatCelsius: value };
  }

  const res = await sdm.enterprises.devices.executeCommand({
    name: `enterprises/${PROJECT_ID}/devices/${deviceId}`,
    requestBody: {
      command: commandName,
      params: params,
    },
  });

  return res.data;
};
