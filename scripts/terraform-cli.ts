// Run terraform end-to-end on a map without going through the HTTP route.
// Use this when the dev server's long-request behavior is flaky (browser
// disconnects, server crashes mid-flow, etc.) — bypassing fetch / Next.js
// streaming gives us reliable execution and live progress logs.
//
// Usage:
//   export $(grep -v '^#' .env.local | xargs)
//   npx tsx scripts/terraform-cli.ts <mapId>

import { prisma } from "@/lib/prisma";
import { getAiClient } from "@/lib/ai-client";
import { terraform } from "@/lib/terraform";

async function main() {
  const mapId = process.argv[2];
  if (!mapId) {
    console.error("usage: npx tsx scripts/terraform-cli.ts <mapId>");
    process.exit(2);
  }

  const map = await prisma.map.findUnique({
    where: { id: mapId },
    select: {
      title: true,
      userId: true,
      exclusionDirective: true,
      _count: { select: { conversations: true } },
    },
  });
  if (!map) {
    console.error(`map ${mapId} not found`);
    process.exit(1);
  }
  const cityCount = await prisma.place.count({ where: { mapId, level: "city" } });

  console.log(`map: ${map.title} (${map._count.conversations} convs, ${cityCount} cities)`);

  const ai = await getAiClient(map.userId);
  if (!ai) {
    console.error("no AI client (no API key in DB?)");
    process.exit(1);
  }
  console.log(`provider: ${ai.provider} model: ${ai.model}`);
  console.log(`directive: ${map.exclusionDirective ? `"${map.exclusionDirective.slice(0, 80)}…"` : "(none)"}`);
  console.log("running terraform...");

  const t0 = Date.now();
  try {
    const result = await terraform(mapId, ai, {
      directive: map.exclusionDirective ?? null,
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n✓ terraform finished in ${elapsed}s`);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`\n✕ terraform failed after ${elapsed}s`);
    console.error(err);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
