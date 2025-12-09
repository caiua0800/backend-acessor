import { Request, Response } from "express";
import { AuthRequest } from "../middlewares/authMiddleware"; // Assumindo este import
import {
  getAuthUrl,
  createEvent,
  checkAvailability,
  listEvents,
  deleteEvent,
  getWhatsappIdFromUserId,
} from "../services/googleService";

export const getAuthUrlFallback = async (req: AuthRequest) => {
  const userId = req.userId!;
  const waId = await getWhatsappIdFromUserId(userId);
  return getAuthUrl(waId);
};

export const createCalendarEvent = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const {
      summary,
      start,
      end,
      description,
      attendees,
      recurrence_freq,
      recurrence_count,
    } = req.body;

    let attendeesArray: string[] | undefined = undefined;
    if (attendees) {
      if (Array.isArray(attendees)) attendeesArray = attendees;
      else if (typeof attendees === "string" && attendees.includes(","))
        attendeesArray = attendees.split(",");
      else if (typeof attendees === "string" && attendees.trim() !== "")
        attendeesArray = [attendees];
    }

    // O Google Service (createEvent) foi atualizado para aceitar o waId (para auth)
    // Então, precisamos pegar o waId do banco
    const waId = await getWhatsappIdFromUserId(userId);

    const result = await createEvent(waId, {
      summary,
      start,
      end,
      description,
      attendees: attendeesArray,
      recurrence_freq,
      recurrence_count,
    });

    let message = "Evento criado na agenda.";
    if (result.meetLink)
      message = "Reunião agendada com Google Meet e convites enviados!";

    res.json({
      status: "success",
      message,
      link: result.link,
      meetLink: result.meetLink,
    });
  } catch (e: any) {
    if (e.message === "AUTH_REQUIRED")
      return res.json({
        status: "auth_required",
        authUrl: await getAuthUrlFallback(req), // Usa o fallback
      });
    res.status(500).json({ error: e.message });
  }
};

export const checkCalendarAvailability = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userId = req.userId!; // Pega do Token
    const waId = await getWhatsappIdFromUserId(userId); // Pega o waId
    const { start, end } = req.body;

    const events = await checkAvailability(waId, start, end);

    res.json({ status: "success", busy: events && events.length > 0, events });
  } catch (e: any) {
    if (e.message === "AUTH_REQUIRED")
      return res.json({
        status: "auth_required",
        authUrl: await getAuthUrlFallback(req),
      });
    res.status(500).json({ error: e.message });
  }
};

export const listCalendarEvents = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!; // Pega do Token
    const waId = await getWhatsappIdFromUserId(userId); // Pega o waId

    const events = await listEvents(waId);
    res.json({ events });
  } catch (e: any) {
    if (e.message === "AUTH_REQUIRED")
      return res.json({
        status: "auth_required",
        authUrl: await getAuthUrlFallback(req),
      });
    res.status(500).json({ error: e.message });
  }
};

export const deleteCalendarEvent = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!; // Pega do Token
    const waId = await getWhatsappIdFromUserId(userId); // Pega o waId
    const { event_id } = req.body;

    await deleteEvent(waId, event_id);
    res.json({ status: "success", message: "Evento cancelado." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
