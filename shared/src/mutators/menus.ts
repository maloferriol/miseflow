import { z } from "zod";
import { menus } from "../schema.ts";
import { defineMutator } from "./define.ts";

const name = z.string().trim().min(1).max(200);

export const createMenu = defineMutator({
  name: "createMenu",
  args: z.strictObject({
    menuId: z.uuid(),
    name,
    guestCount: z.int().min(1).max(10_000),
  }),
  async run(tx, args, { ownerId }) {
    await tx.insert(menus).values({
      id: args.menuId,
      ownerId,
      name: args.name,
      guestCount: args.guestCount,
    });
  },
});
