import { betterAuth, type Auth } from "better-auth";
import { createDatabase, type Database } from "@lavega/database";

let database: Database | null = null;
let instance: Auth<any> | null = null;

export function getAuth(): Auth<any> | null {
  if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET) return null;
  if (instance) return instance;
  database ??= createDatabase();
  instance = betterAuth({
    database,
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:8787",
    trustedOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "http://localhost:8787").split(",").map((origin) => origin.trim()).filter(Boolean),
    emailAndPassword: { enabled: true },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  });
  return instance;
}

export async function verifiedSession(request: Request) {
  const auth = getAuth();
  if (!auth) return null;
  return auth.api.getSession({ headers: request.headers });
}
