import { Request, Response } from "express";
import { deleteFile, listFiles, getAuthUrl } from "../services/googleService";

const handleAuthError = (e: any, req: Request, res: Response) => {
  if (e.message === "AUTH_REQUIRED") {
    return res.json({
      status: "auth_required",
      authUrl: getAuthUrl(req.body.wa_id),
    });
  }
  res.status(500).json({ error: e.message });
};

export const deleteDriveFile = async (req: Request, res: Response) => {
  try {
    const { wa_id, fileId } = req.body;
    const result = await deleteFile(wa_id, fileId);
    res.json(result);
  } catch (e: any) {
    handleAuthError(e, req, res);
  }
};

export const listDriveFiles = async (req: Request, res: Response) => {
  try {
    const { wa_id, query } = req.body;
    const result = await listFiles(wa_id, query);
    console.log(result)
    res.json(result);
  } catch (e: any) {
    handleAuthError(e, req, res);
  }
};
