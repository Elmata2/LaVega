import { Cause, Effect, Exit } from "effect";

function describe(cause: Cause.Cause<unknown>): string {
  const e = Cause.squash(cause);
  if (typeof e === "object" && e !== null && "_tag" in e && "message" in e)
    return `[${String(e._tag)}] ${String(e.message)}`;
  return Cause.pretty(cause);
}

/**
 * The CLI entry point for an Effect program. The program's number is the exit
 * code on success; a failure prints the tagged error and exits 1.
 */
export async function runCli<E>(program: Effect.Effect<number, E>): Promise<void> {
  const exit = await Effect.runPromiseExit(program);
  if (Exit.isFailure(exit)) {
    console.error(`ERROR ${describe(exit.cause)}`);
    process.exit(1);
  }
  process.exit(exit.value);
}
