/* The ONE switch for the new app shell (rail, account sidebar, full-width
 * frame; components/Shell.tsx). Off until step 9c flips it and deletes the old
 * shell. Not in archive.ts: several suites mock that module with a fixed export
 * list, and a new export there would break them. Tests do not touch this
 * constant; they pass `v2` to ShellSwitch or render Shell directly. */
export const SHELL_V2 = false;
