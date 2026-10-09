import { z } from "zod";

export const getDashboardSchema = z.object({
  timeframe: z.enum(["today", "7days", "30days"]).optional().default("30days"),
});

