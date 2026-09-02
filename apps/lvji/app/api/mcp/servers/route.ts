import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { mcpServers } from "@/db/schema";
import { requireRequestUser } from "@/lib/auth/request-user";
import { isSkillProvider } from "@/lib/mcp/registry";
import { configs, decryptSecret, encryptSecret, mcpRowId } from "@/lib/mcp/store";
import { redactSecret, assertSafeMcpUrl } from "@/lib/mcp/security";
import type { McpServerConfig } from "@/lib/mcp/types";

export async function GET(request: Request) {
  try {
    const all = await configs(request);
    return Response.json(
      {
        servers: Object.values(all).map(({ apiKey, authHeader, ...x }) => ({
          ...x,
          configured: isSkillProvider(x.id)
            ? true
            : Boolean(x.endpoint),
          secretHint: redactSecret(apiKey || authHeader),
          transport: isSkillProvider(x.id)
            ? ("cli" as const)
            : ("streamable-http" as const),
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "SERVICE_LIST_FAILED" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as Partial<McpServerConfig> & {
      apiKey?: string;
    };
    if (!body.id || !/^[a-zA-Z0-9_-]{3,64}$/.test(body.id)) {
      return Response.json({ error: "INVALID_PROVIDER_ID" }, { status: 400 });
    }

    if (isSkillProvider(body.id)) {
      const id = mcpRowId(user.id, body.id);
      const old = (
        await getDb().select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1)
      )[0];
      const incoming = body.apiKey?.trim() ?? "";
      const existingSecret =
        !incoming && old?.encryptedSecret
          ? await decryptSecret(old.encryptedSecret)
          : "";
      const encryptedSecret = await encryptSecret(
        incoming || existingSecret || process.env.FLYAI_API_KEY || "",
      );
      await getDb()
        .insert(mcpServers)
        .values({
          id,
          userId: user.id,
          providerKey: "flyai",
          name: "FlyAI 飞猪旅行",
          endpoint: "cli://flyai",
          authMode: "bearer",
          encryptedSecret,
          enabled: body.enabled ?? true,
          permission: body.permission || "readonly",
          source: "builtin",
        })
        .onConflictDoUpdate({
          target: mcpServers.id,
          set: {
            encryptedSecret,
            enabled: body.enabled ?? true,
            permission: body.permission || "readonly",
            updatedAt: new Date().toISOString(),
          },
        });
      return Response.json({ ok: true, id: body.id });
    }

    if (!body.name?.trim() || !body.endpoint) {
      return Response.json(
        { error: "MCP_NAME_AND_ENDPOINT_REQUIRED" },
        { status: 400 },
      );
    }
    assertSafeMcpUrl(body.endpoint);
    if (
      !body.authMode ||
      !["none", "bearer", "authorization"].includes(body.authMode)
    ) {
      return Response.json({ error: "MCP_AUTH_MODE_INVALID" }, { status: 400 });
    }
    const id = mcpRowId(user.id, body.id);
    const old = (
      await getDb().select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1)
    )[0];
    const incoming =
      body.authMode === "bearer"
        ? body.apiKey
        : body.authMode === "authorization"
          ? body.authHeader
          : "";
    let encryptedSecret: string | null = null;
    if (body.authMode !== "none") {
      const existingSecret =
        !incoming && old?.encryptedSecret
          ? await decryptSecret(old.encryptedSecret)
          : "";
      encryptedSecret = await encryptSecret(incoming || existingSecret);
    }
    await getDb()
      .insert(mcpServers)
      .values({
        id,
        userId: user.id,
        providerKey: body.id,
        name: body.name.trim(),
        endpoint: body.endpoint,
        authMode: body.authMode,
        encryptedSecret,
        enabled: body.enabled ?? true,
        permission: body.permission || "ask",
        source: body.source || "custom",
      })
      .onConflictDoUpdate({
        target: mcpServers.id,
        set: {
          name: body.name.trim(),
          endpoint: body.endpoint,
          authMode: body.authMode,
          encryptedSecret,
          enabled: body.enabled ?? true,
          permission: body.permission || "ask",
          source: body.source || old?.source || "custom",
          updatedAt: new Date().toISOString(),
        },
      });
    return Response.json({ ok: true, id: body.id });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "SERVICE_CONFIG_FAILED" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const { id } = (await request.json()) as { id?: string };
    if (!id) return Response.json({ error: "INVALID_PROVIDER_ID" }, { status: 400 });
    const row = (
      await getDb()
        .select()
        .from(mcpServers)
        .where(and(eq(mcpServers.userId, user.id), eq(mcpServers.providerKey, id)))
        .limit(1)
    )[0];
    if (!row || row.source !== "custom") {
      return Response.json({ error: "CUSTOM_PROVIDER_NOT_FOUND" }, { status: 404 });
    }
    await getDb().delete(mcpServers).where(eq(mcpServers.id, row.id));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "MCP_DELETE_FAILED" },
      { status: 400 },
    );
  }
}
