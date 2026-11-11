/* Operator CLI for read-only MCP tokens (#285, ADR 0012).
 *
 *   DATABASE_URL=... tsx scripts/mcp-token.ts create --user <better-auth-user-id> [--label "cursor"]
 *   DATABASE_URL=... tsx scripts/mcp-token.ts list   --user <better-auth-user-id>
 *   DATABASE_URL=... tsx scripts/mcp-token.ts revoke --id <token-row-id>
 *
 * `create` prints the raw token exactly once. Only its SHA-256 digest is stored,
 * so a lost token is replaced, never recovered. Scopes are always `read`: ADR
 * 0012 §4 keeps write tools behind a separate decision. */
import { randomBytes } from "node:crypto";
import { createDatabase, createMcpTokenRepository } from "@lavega/database";
import { hashMcpToken } from "../apps/server/src/mcp/tokens.js";

const USAGE = `usage:
  tsx scripts/mcp-token.ts create --user <user-id> [--label <label>]
  tsx scripts/mcp-token.ts list   --user <user-id>
  tsx scripts/mcp-token.ts revoke --id <token-row-id>`;

type Command = "create" | "list" | "revoke";

function parseArgs(argv: readonly string[]): {
  command: Command;
  values: Map<string, string>;
} {
  const command = argv[0];
  if (command !== "create" && command !== "list" && command !== "revoke")
    throw new Error(USAGE);
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error(USAGE);
    values.set(flag.slice(2), value);
  }
  return { command, values };
}

const required = (values: Map<string, string>, name: string): string => {
  const value = values.get(name)?.trim();
  if (!value) throw new Error(`--${name} is required\n${USAGE}`);
  return value;
};

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const { command, values } = parseArgs(process.argv.slice(2));
  const database = createDatabase(connectionString);
  const repository = createMcpTokenRepository(database);
  try {
    if (command === "create") {
      const userId = required(values, "user");
      const raw = randomBytes(32).toString("base64url");
      const id = await repository.create({
        userId,
        tokenHash: hashMcpToken(raw),
        label: values.get("label")?.trim() || null,
        scopes: ["read"],
      });
      /* One line of JSON: the raw token is shown here and nowhere else. */
      console.log(
        JSON.stringify(
          {
            id,
            userId,
            scopes: ["read"],
            token: raw,
            note: "Copy the token now. Only its hash is stored; it cannot be shown again.",
          },
          null,
          2,
        ),
      );
      return;
    }

    if (command === "list") {
      const userId = required(values, "user");
      const result = (await database.http.query(
        `SELECT id, label, scopes, created_at, last_used_at, expires_at, revoked_at
           FROM investing.api_tokens
          WHERE user_id = $1
          ORDER BY created_at DESC`,
        [userId],
      )) as unknown as { rows: Array<Record<string, unknown>> };
      console.log(JSON.stringify(result.rows, null, 2));
      return;
    }

    const id = required(values, "id");
    const revoked = await repository.revoke(id, new Date());
    console.log(JSON.stringify({ id, revoked }));
    if (!revoked) process.exitCode = 1;
  } finally {
    await database.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
