/**
 * Staged agent-pool expansion: inserts NEW agents (20 personas, 4 per alignment)
 * in offset windows, with party memberships, at the LIVE initialAgentBalance.
 *
 * - Dry-run by default: prints the full insertion plan (resolved inference
 *   model + its source, balance + its source, party mapping, every row) and
 *   writes nothing. Pass --execute to insert.
 * - Aborts BEFORE any insert if runtime_config cannot be read from the DB
 *   (loadRuntimeConfig fails soft — this script refuses to seed off defaults
 *   it cannot distinguish from a dead DB), or if any alignment maps to 0 or
 *   >1 active parties.
 * - Idempotent / resume-safe: a name that already exists is skipped with a
 *   log, but its party membership is still guarded+inserted, so a crash
 *   between agent insert and membership insert self-heals on re-run. Repair
 *   only adopts rows carrying this script's deterministic `agora_<name>`
 *   agoraId — a same-named agent from any other creation path is a loud
 *   CONFLICT and is left completely untouched.
 * - New rows: model NULL (inherits via ai.ts getDefaultModel — '' never
 *   inherits), modelProvider 'openai', reputation 100, approvalRating 50.
 *
 * Usage (on the Linux box):
 *   npx tsx scripts/seed-expansion-agents.ts                         # dry-run, full batch
 *   npx tsx scripts/seed-expansion-agents.ts --count 10 --offset 0   # dry-run wave 1
 *   npx tsx scripts/seed-expansion-agents.ts --count 10 --offset 0 --execute
 *   npx tsx scripts/seed-expansion-agents.ts --count 10 --offset 10 --execute
 */

import 'dotenv/config';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, queryClient } from '../src/core/db/connection.js';
import {
  agents,
  apiProviders,
  parties,
  partyMemberships,
  runtimeConfigStore,
} from '../src/core/db/schema/index.js';
import { loadRuntimeConfig } from '../src/core/server/runtimeConfig.js';
import {
  ALIGNMENTS,
  PERSONAS,
  RESERVED_NAMES,
  balanceSourceOf,
  buildAgentRow,
  expectedAgoraId,
  isForeignAgent,
  mapAlignmentsToParties,
  partitionByExisting,
  planWave,
  resolveOpenAiModel,
  validatePersonas,
  type ActivePartyRow,
  type Alignment,
} from './lib/expansionPlan.js';

interface CliArgs {
  count: number;
  offset: number;
  execute: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let count = PERSONAS.length;
  let offset = 0;
  let execute = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--execute') {
      execute = true;
    } else if (arg === '--count' || arg === '--offset') {
      const raw = argv[i + 1];
      const n = raw !== undefined ? Number.parseInt(raw, 10) : NaN;
      const min = arg === '--count' ? 1 : 0;
      if (!Number.isInteger(n) || n < min || String(n) !== raw) {
        console.error(`[EXPAND] ${arg} requires an integer >= ${min}, got: ${raw}`);
        process.exit(1);
      }
      if (arg === '--count') count = n;
      else offset = n;
      i++;
    } else {
      console.error(`[EXPAND] Unknown argument: ${arg}`);
      console.error('[EXPAND] Usage: seed-expansion-agents.ts [--count N] [--offset M] [--execute]');
      process.exit(1);
    }
  }

  return { count, offset, execute };
}

/* Sync on purpose: a `never` return lets TS narrow after every call site.
   All aborts happen before any write — leaked sockets die with the process. */
function abort(message: string, detail?: unknown): never {
  console.error(`[EXPAND] ABORT — ${message}`);
  if (detail !== undefined) console.error(detail);
  process.exit(1);
}

const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

async function main(): Promise<void> {
  const { count, offset, execute } = parseArgs(process.argv.slice(2));

  const personaErrors = validatePersonas(PERSONAS, RESERVED_NAMES);
  if (personaErrors.length > 0) {
    abort('persona batch failed self-validation:', personaErrors);
  }

  const wave = planWave(PERSONAS, count, offset);
  if (wave.length === 0) {
    abort(`--count ${count} --offset ${offset} selects no personas (batch has ${PERSONAS.length}).`);
  }

  /* runtime_config probe: loadRuntimeConfig() fails soft on DB errors, so
     read the row ourselves first — a throw here means the DB is unreachable
     and seeding off silent defaults would be wrong. */
  let configJson: Record<string, unknown> | null = null;
  try {
    const [row] = await db
      .select({ config: runtimeConfigStore.config })
      .from(runtimeConfigStore)
      .where(eq(runtimeConfigStore.id, 1))
      .limit(1);
    configJson = (row?.config as Record<string, unknown> | undefined) ?? null;
  } catch (err) {
    abort(
      'cannot read runtime_config from the DB. Refusing to fall back to code defaults — fix DATABASE_URL / start Postgres and re-run.',
      err,
    );
  }

  const rc = await loadRuntimeConfig();
  const balanceSource = balanceSourceOf(configJson);
  if (
    balanceSource === 'runtime_config DB row' &&
    rc.initialAgentBalance !== configJson?.initialAgentBalance
  ) {
    abort(
      `runtime_config row says initialAgentBalance=${String(configJson?.initialAgentBalance)} but loadRuntimeConfig() returned ${rc.initialAgentBalance} — config load failed soft mid-run.`,
    );
  }
  const balance = rc.initialAgentBalance;

  /* Same lookup getDefaultModel does (ai.ts:798-826): active openai provider
     row first, .catch → null. */
  let providerDefaultModel: string | null = null;
  try {
    const [row] = await db
      .select({ defaultModel: apiProviders.defaultModel })
      .from(apiProviders)
      .where(and(eq(apiProviders.providerName, 'openai'), eq(apiProviders.isActive, true)))
      .limit(1);
    providerDefaultModel = row?.defaultModel ?? null;
  } catch {
    providerDefaultModel = null;
  }
  const resolvedModel = resolveOpenAiModel({
    providerDefaultModel,
    simInferenceModel: rc.simInferenceModel,
    envOpenAiModel: process.env.OPENAI_MODEL,
  });

  const activeParties: ActivePartyRow[] = await db
    .select({ id: parties.id, name: parties.name, alignment: parties.alignment })
    .from(parties)
    .where(eq(parties.isActive, true));
  const partyMap = mapAlignmentsToParties(activeParties);
  if (!partyMap.ok) {
    abort('active-party mapping is not 1:1 — refusing to insert anything:', partyMap.errors);
  }
  const byAlignment = partyMap.byAlignment;

  const waveNames = wave.map((p) => p.name);
  const existingRows = await db
    .select({ name: agents.name })
    .from(agents)
    .where(inArray(agents.name, waveNames));
  const { toInsert, toRepair } = partitionByExisting(waveNames, existingRows.map((r) => r.name));

  console.log(`[EXPAND] MODE: ${execute ? 'EXECUTE' : 'DRY RUN (pass --execute to write)'}`);
  console.log(`[EXPAND] Wave: --count ${count} --offset ${offset} → ${wave.length} personas`);
  console.log(`[EXPAND] Inference model newcomers inherit: ${resolvedModel.model} (source: ${resolvedModel.source})`);
  console.log(`[EXPAND] initialAgentBalance: ${usd(balance)} (source: ${balanceSource})`);
  console.log('[EXPAND] Party mapping (active parties):');
  for (const a of ALIGNMENTS) {
    const p = byAlignment.get(a as Alignment);
    console.log(`  ${a.padEnd(12)} → ${p?.name} (${p?.id})`);
  }
  console.log(`[EXPAND] New inserts: ${toInsert.length} | already exist (membership repair only): ${toRepair.length === 0 ? 'none' : toRepair.join(', ')}`);
  console.log('[EXPAND] Insertion plan:');
  for (const [i, persona] of wave.entries()) {
    const row = buildAgentRow(persona, balance);
    const party = byAlignment.get(persona.alignment);
    const marker = toRepair.includes(persona.name) ? 'REPAIR' : 'INSERT';
    console.log(
      `  [${String(offset + i + 1).padStart(2)}] ${marker} ${row.name.padEnd(17)} "${row.displayName}" ${row.alignment.padEnd(12)} → ${party?.name}`,
    );
    console.log(
      `       agoraId=${row.agoraId} provider=${row.modelProvider} model=NULL(inherits) reputation=${row.reputation} approval=${row.approvalRating} balance=${usd(row.balance)} active=${row.isActive}`,
    );
    console.log(`       "${row.personality}"`);
  }

  if (!execute) {
    console.log('[EXPAND] DRY RUN complete — nothing written.');
    await queryClient.end({ timeout: 5 });
    process.exit(0);
  }

  let insertedAgents = 0;
  let skippedAgents = 0;
  let foreignConflicts = 0;
  let insertedMemberships = 0;
  let skippedMemberships = 0;
  const memberCountDelta = new Map<string, number>();
  const repairSet = new Set(toRepair);

  for (const persona of wave) {
    const party = byAlignment.get(persona.alignment);
    if (!party) throw new Error(`no party mapped for alignment '${persona.alignment}'`);

    let agentId: string | null = null;
    if (!repairSet.has(persona.name)) {
      try {
        const [ins] = await db
          .insert(agents)
          .values(buildAgentRow(persona, balance))
          .returning({ id: agents.id });
        agentId = ins.id;
        insertedAgents++;
        console.log(`[EXPAND] + agent ${persona.name} (${agentId})`);
      } catch (err) {
        // drizzle-orm >= 0.44 wraps driver errors in DrizzleQueryError (code moves to err.cause) — revisit on upgrade
        if ((err as { code?: string }).code !== '23505') throw err;
        // inserted by a concurrent/earlier run — fall through to repair
      }
    }
    if (agentId === null) {
      const [existing] = await db
        .select({ id: agents.id, agoraId: agents.agoraId })
        .from(agents)
        .where(eq(agents.name, persona.name))
        .limit(1);
      if (!existing) throw new Error(`agent '${persona.name}' reported existing but not found on re-select`);
      if (isForeignAgent(persona.name, existing.agoraId)) {
        foreignConflicts++;
        console.error(
          `[EXPAND] ! CONFLICT ${persona.name}: existing agent has agoraId '${existing.agoraId}', expected '${expectedAgoraId(persona.name)}' — created by another path, leaving it untouched (no membership insert)`,
        );
        continue;
      }
      agentId = existing.id;
      skippedAgents++;
      console.log(`[EXPAND] = agent ${persona.name} already exists — checking membership`);
    }

    const [membership] = await db
      .select({ id: partyMemberships.id, partyId: partyMemberships.partyId })
      .from(partyMemberships)
      .where(eq(partyMemberships.agentId, agentId))
      .limit(1);
    if (!membership) {
      await db.insert(partyMemberships).values({ agentId, partyId: party.id, role: 'member' });
      memberCountDelta.set(party.id, (memberCountDelta.get(party.id) ?? 0) + 1);
      insertedMemberships++;
      console.log(`[EXPAND]   + membership → ${party.name}`);
    } else {
      skippedMemberships++;
      if (membership.partyId !== party.id) {
        console.warn(
          `[EXPAND]   ! membership present but in a DIFFERENT party (${membership.partyId}, expected ${party.id} ${party.name}) — left as-is`,
        );
      } else {
        console.log(`[EXPAND]   = membership already present — skipped`);
      }
    }
  }

  for (const [partyId, delta] of memberCountDelta) {
    await db
      .update(parties)
      .set({ memberCount: sql`${parties.memberCount} + ${delta}` })
      .where(eq(parties.id, partyId));
  }

  const [{ total, active }] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${agents.isActive})::int`,
    })
    .from(agents);

  console.log('[EXPAND] Done.');
  console.log(`[EXPAND] Agents inserted: ${insertedAgents}, already existed: ${skippedAgents}${foreignConflicts > 0 ? `, FOREIGN-NAME CONFLICTS (untouched): ${foreignConflicts}` : ''}`);
  console.log(`[EXPAND] Memberships inserted: ${insertedMemberships}, already present: ${skippedMemberships}`);
  console.log(`[EXPAND] Agents in DB: ${total} total, ${active} active`);

  await queryClient.end({ timeout: 5 });
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[EXPAND] FAILED:', err);
  await queryClient.end({ timeout: 5 }).catch(() => undefined);
  process.exit(1);
});
