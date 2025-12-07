import { Request, Response } from "express";
import {
  getAuthUrl,
  createEvent,
  checkAvailability,
  listEvents,
  deleteEvent,
} from "../services/googleService";

export const createCalendarEvent = async (req: Request, res: Response) => {
  try {
    const { wa_id, summary, start, end, description, attendees } = req.body;
    let attendeesArray: string[] | undefined = undefined;
    if (attendees) {
      if (Array.isArray(attendees)) attendeesArray = attendees;
      else if (typeof attendees === "string" && attendees.includes(","))
        attendeesArray = attendees.split(",");
      else if (typeof attendees === "string" && attendees.trim() !== "")
        attendeesArray = [attendees];
    }
    const result = await createEvent(wa_id, {
      summary,
      start,
      end,
      description,
      attendees: attendeesArray,
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
        authUrl: getAuthUrl(req.body.wa_id),
      });
    res.status(500).json({ error: e.message });
  }
};

export const checkCalendarAvailability = async (
  req: Request,
  res: Response
) => {
  try {
    const { wa_id, start, end } = req.body;
    const events = await checkAvailability(wa_id, start, end);
    res.json({ status: "success", busy: events && events.length > 0, events });
  } catch (e: any) {
    if (e.message === "AUTH_REQUIRED")
      return res.json({
        status: "auth_required",
        authUrl: getAuthUrl(req.body.wa_id),
      });
    res.status(500).json({ error: e.message });
  }
};

export const listCalendarEvents = async (req: Request, res: Response) => {
  try {
    const { wa_id } = req.body;
    const events = await listEvents(wa_id);
    res.json({ events });
  } catch (e: any) {
    if (e.message === "AUTH_REQUIRED")
      return res.json({
        status: "auth_required",
        authUrl: getAuthUrl(req.body.wa_id),
      });
    res.status(500).json({ error: e.message });
  }
};

export const deleteCalendarEvent = async (req: Request, res: Response) => {
  try {
    const { wa_id, event_id } = req.body;
    await deleteEvent(wa_id, event_id);
    res.json({ status: "success", message: "Evento cancelado." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
