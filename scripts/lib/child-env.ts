// The environment the demo gives the paid-lock CLI: nothing but what the OS needs to start a program, so the
// demo shows the CLI works without any key, token or other configuration in its environment.
// On Windows that includes SystemRoot: without it a child process cannot start Winsock (WSA error 10106), so
// even a request to 127.0.0.1 fails. Windows variable names are case-insensitive, so they are looked up that way.

const WINDOWS_ONLY = ["SystemRoot"] as const;

function lookup(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  ignoreCase: boolean,
): string | undefined {
  if (!ignoreCase) return env[name];
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

export function minimalChildEnv(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): Record<string, string> {
  const windows = platform === "win32";
  const out: Record<string, string> = { PATH: lookup(env, "PATH", windows) ?? "" };
  if (windows) {
    for (const name of WINDOWS_ONLY) {
      const value = lookup(env, name, true);
      if (value !== undefined) out[name] = value;
    }
  }
  return out;
}
