import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { SkillServerConfig, SkillTool } from "./types";
import { FLYAI_TOOLS } from "./catalog";
import { skillPaths } from "./paths";

const camelToKebab = (key: string) =>
  key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

function flyaiBin() {
  const local = path.join(process.cwd(), "node_modules", ".bin", "flyai");
  if (existsSync(local)) return local;
  const repoRoot = skillPaths().root;
  const repoLocal = path.join(repoRoot, "node_modules", ".bin", "flyai");
  if (existsSync(repoLocal)) return repoLocal;
  return "flyai";
}

function buildArgs(toolName: string, args: Record<string, unknown>) {
  const cliArgs = [toolName];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === "") continue;
    cliArgs.push(`--${camelToKebab(key)}`, String(value));
  }
  return cliArgs;
}

function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 30000,
  input?: string,
) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolve, reject) => {
      const child = spawn(command, args, {
        env,
        stdio: input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("SKILL_COMMAND_TIMEOUT"));
      }, timeoutMs);
      if (input && child.stdin) {
        child.stdin.write(input);
        child.stdin.end();
      }
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
    },
  );
}

async function runFlyai(
  config: SkillServerConfig,
  toolName: string,
  args: Record<string, unknown>,
) {
  const env = { ...process.env };
  if (config.apiKey) env.FLYAI_API_KEY = config.apiKey;
  const bin = flyaiBin();
  const command = bin.endsWith("flyai") && !bin.includes("/") ? bin : process.execPath;
  const cliArgs =
    command === process.execPath
      ? [bin, ...buildArgs(toolName, args)]
      : buildArgs(toolName, args);
  const { stdout, stderr, code } = await runCommand(
    command,
    cliArgs,
    env,
  );
  if (code !== 0 && !stdout.trim()) {
    throw new Error(stderr.trim() || `SKILL_CLI_EXIT_${code ?? "unknown"}`);
  }
  const line = stdout.trim().split("\n").filter(Boolean).at(-1) || stdout.trim();
  if (!line) throw new Error(stderr.trim() || "SKILL_EMPTY_RESPONSE");
  try {
    return JSON.parse(line);
  } catch {
    throw new Error("SKILL_INVALID_JSON");
  }
}

/** Use repo-root flyai-adaptive-search.sh (same as Xinjiang monitor skill). */
async function adaptiveFlightSearch(
  config: SkillServerConfig,
  args: Record<string, unknown>,
) {
  const { adaptiveSearchScript, dedupScript } = skillPaths();
  const origin = String(args.origin || "");
  const destination = String(args.destination || "");
  const depDate = String(args.depDate || "");
  const journeyType = String(args.journeyType ?? "1");

  const env = { ...process.env, DEDUP: dedupScript };
  if (config.apiKey) env.FLYAI_API_KEY = config.apiKey;

  const { stdout, stderr, code } = await runCommand(
    "bash",
    [adaptiveSearchScript, origin, destination, depDate, journeyType],
    env,
    120000,
  );
  if (code !== 0 && !stdout.trim()) {
    throw new Error(stderr.trim() || `ADAPTIVE_SEARCH_EXIT_${code ?? "unknown"}`);
  }
  const line = stdout.trim().split("\n").filter(Boolean).at(-1) || stdout.trim();
  if (!line) throw new Error(stderr.trim() || "ADAPTIVE_SEARCH_EMPTY");

  let monitorResult: {
    apiCount?: number;
    dedup?: string;
    flights?: unknown[];
    apiError?: string;
  };
  try {
    monitorResult = JSON.parse(line);
  } catch {
    throw new Error("ADAPTIVE_SEARCH_INVALID_JSON");
  }

  if (monitorResult.apiError) {
    throw new Error(`FLYAI_${monitorResult.apiError}`);
  }

  const flights = monitorResult.flights || [];
  return {
    data: {
      itemList: flights.map((f) => ({
        ticketPrice: (f as { price?: string }).price,
        jumpUrl: (f as { jumpUrl?: string }).jumpUrl,
        journeys: [
          {
            journeyType: (f as { journeyType?: string }).journeyType,
            totalDuration: (f as { duration?: string }).duration,
            segments: ((f as { segments?: unknown[] }).segments || []).map((s) => {
              const seg = s as { depDateTime?: string; arrDateTime?: string; flightNo?: string };
              return {
                depDateTime: seg.depDateTime,
                arrDateTime: seg.arrDateTime,
                marketingTransportNo: seg.flightNo,
              };
            }),
          },
        ],
      })),
    },
    meta: {
      apiCount: monitorResult.apiCount ?? 0,
      deduplicated: true,
      dedup: monitorResult.dedup,
      source: "flighthub-travel-skill/adaptive-search",
    },
  };
}

export function listTools(): SkillTool[] {
  return FLYAI_TOOLS;
}

export async function callSkillTool(
  config: SkillServerConfig,
  name: string,
  args: Record<string, unknown>,
) {
  if (!config.enabled || config.permission === "deny") {
    throw new Error("SKILL_TOOL_FORBIDDEN");
  }
  const tool = FLYAI_TOOLS.find((item) => item.name === name);
  if (!tool) throw new Error("SKILL_TOOL_NOT_FOUND");
  const data =
    name === "search-flight" && !args.depHourStart && !args.depHourEnd
      ? await adaptiveFlightSearch(config, args)
      : await runFlyai(config, name, args);
  return {
    data,
    warning:
      "价格为展示参考价，实际价格以预订页面为准。本结果来自飞猪 fly.ai 实时数据。",
  };
}
