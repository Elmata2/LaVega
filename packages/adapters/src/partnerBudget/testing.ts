import { Effect, Scope } from "effect";
import { TestClock } from "effect/testing";
import { test } from "vitest";

/**
 * `it.effect` for this repo. `@effect/vitest` needs vitest 5 and the repo is on
 * vitest 2, so this does the same job for the Effect tests we have: run the
 * effect on a `TestClock` that only moves when the test adjusts it.
 */
export function itEffect<A, E>(
  name: string,
  body: () => Effect.Effect<A, E, TestClock.TestClock | Scope.Scope>,
) {
  test(name, async () => {
    await Effect.runPromise(body().pipe(Effect.scoped, Effect.provide(TestClock.layer())));
  });
}
