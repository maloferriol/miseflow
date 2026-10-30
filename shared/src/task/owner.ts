import { z } from "zod";

// The owner of a Task (CONTEXT Task): the Dish or the Batch whose Recipe's Steps it holds.

export const ownerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("dish"), dishId: z.uuid() }),
  z.strictObject({ kind: z.literal("batch"), batchId: z.uuid() }),
]);

export type Owner = z.infer<typeof ownerSchema>;
