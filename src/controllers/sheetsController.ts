import { Request, Response } from "express";
import * as googleService from "../services/googleService";
import { createSheet, getSheetValues, appendToSheet } from "../services/googleService";

const handleAuthError = (e: any, req: Request, res: Response) => {
  if (e.message === "AUTH_REQUIRED") {
    return res.json({
      status: "auth_required",
      authUrl: googleService.getAuthUrl(req.body.wa_id),
    });
  }
  res.status(500).json({ error: e.message });
};

export const create = async (req: Request, res: Response) => {
  try {
    const { wa_id, title } = req.body;
    const result = await createSheet(wa_id, title);
    res.json(result);
  } catch (e: any) {
    handleAuthError(e, req, res);
  }
};

export const read = async (req: Request, res: Response) => {
  try {
    const { wa_id, sheetId, range } = req.body;
    const result = await getSheetValues(wa_id, sheetId, range);
    res.json(result);
  } catch (e: any) {
    handleAuthError(e, req, res);
  }
};
 
export const append = async (req: Request, res: Response) => {
  try {
    const { wa_id, sheetId, values } = req.body;
    // values deve ser um array de strings ["val1", "val2"]
    const result = await appendToSheet(wa_id, sheetId, values);
    res.json(result);
  } catch (e: any) {
    handleAuthError(e, req, res);
  }
};
