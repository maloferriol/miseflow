// Prints an access token for this checkout's test user, for curl:
//   TOKEN=$(npm run -s token)
// It resets the user's password (see scripts/test-user.ts), so a `dev:user` password stops working.
import "./load-env.ts";
import { checkoutUser } from "./test-user.ts";

process.stdout.write((await checkoutUser()).token + "\n");
