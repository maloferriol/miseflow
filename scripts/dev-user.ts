// Resets this checkout's test user to a new random password and prints the email and password,
// for signing in by hand in `npm run dev:web`:
//   npm run dev:user
import "./load-env.ts";
import { checkoutUser } from "./test-user.ts";

const { email, password } = await checkoutUser();
console.log(`Email:    ${email}\nPassword: ${password}`);
