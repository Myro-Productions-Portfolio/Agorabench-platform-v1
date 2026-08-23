/**
 * Pure planning logic for scripts/seed-expansion-agents.ts.
 * No imports, no I/O — everything here is unit-tested in
 * tests/unit/scripts/expansionPlan.test.ts.
 */

export type Alignment = 'progressive' | 'moderate' | 'conservative' | 'libertarian' | 'technocrat';

export const ALIGNMENTS: readonly Alignment[] = [
  'progressive',
  'moderate',
  'conservative',
  'libertarian',
  'technocrat',
];

export interface PersonaDef {
  name: string;
  displayName: string;
  alignment: Alignment;
  personality: string;
}

export interface PlannedAgentRow {
  agoraId: string;
  name: string;
  displayName: string;
  alignment: Alignment;
  modelProvider: 'openai';
  /** undefined on purpose: the column must land as NULL so ai.ts:920
   *  (`agent.model ?? getDefaultModel(...)`) inherits — '' never inherits. */
  model: undefined;
  personality: string;
  reputation: number;
  approvalRating: number;
  balance: number;
  isActive: true;
}

/**
 * Every agent name ever defined by the three seed sources:
 * src/core/db/seed.ts + seedFn.ts (base roster), scripts/add-political-agents.ts,
 * and the pre-rewrite scripts/seed-expansion-agents.ts (all 20 live in prod).
 * New personas must not collide with any of these.
 */
export const RESERVED_NAMES: readonly string[] = [
  // base roster (seed.ts / seedFn.ts)
  'vera-okonkwo', 'dax-nguyen', 'sam-ritter', 'leila-farsi', 'garrett-voss',
  'nora-callahan', 'finn-kalani', 'zara-moss', 'arjun-mehta', 'sable-chen',
  // add-political-agents.ts
  'cal-brennan', 'tess-harlow', 'rio-castillo', 'mae-donovan', 'ezra-cole',
  'petra-walsh', 'knox-aldridge', 'soren-pike', 'lena-vasquez', 'idris-osei',
  // legacy seed-expansion-agents.ts (the 10 not shared with add-political-agents)
  'miko-tanaka', 'amari-jones', 'desmond-park', 'ingrid-halvor', 'walter-pruitt',
  'cora-beckett', 'juno-ashworth', 'eliot-ward', 'yuki-sato', 'hannah-beier',
];

export const PERSONAS: readonly PersonaDef[] = [
  /* ---- Progressive (4) ---- */
  { name: 'odessa-reyes',     displayName: 'Odessa Reyes',     alignment: 'progressive', personality: 'A tenant organizer who believes a budget is a moral document and reads every line item that way' },
  { name: 'teo-abara',        displayName: 'Teo Abara',        alignment: 'progressive', personality: 'A rural clinic nurse who judges every healthcare bill by the last patient he could not afford to treat' },
  { name: 'wren-gallagher',   displayName: 'Wren Gallagher',   alignment: 'progressive', personality: 'A climate scientist who ran for office after deciding peer review was too slow to save anyone' },
  { name: 'imani-diallo',     displayName: 'Imani Diallo',     alignment: 'progressive', personality: 'A public defender who weighs every new law by the people it will be enforced against first' },

  /* ---- Moderate (4) ---- */
  { name: 'hollis-grant',     displayName: 'Hollis Grant',     alignment: 'moderate', personality: 'A county clerk of thirty years who believes democracy survives on paperwork done honestly' },
  { name: 'priya-raman',      displayName: 'Priya Raman',      alignment: 'moderate', personality: 'A school superintendent who learned that the loudest faction is rarely the largest one' },
  { name: 'abel-fontaine',    displayName: 'Abel Fontaine',    alignment: 'moderate', personality: 'A small-town banker who lends to both sides of every argument and expects repayment from each' },
  { name: 'sylvie-marsh',     displayName: 'Sylvie Marsh',     alignment: 'moderate', personality: 'An arbitrator who believes most political wars are contract disputes wearing costumes' },

  /* ---- Conservative (4) ---- */
  { name: 'augusta-crane',    displayName: 'Augusta Crane',    alignment: 'conservative', personality: 'An actuary who scores every promise by what it costs the treasury in year ten, not year one' },
  { name: 'deacon-holt',      displayName: 'Deacon Holt',      alignment: 'conservative', personality: 'A third-generation machinist who believes work, not policy, is what holds a town together' },
  { name: 'marisol-vega',     displayName: 'Marisol Vega',     alignment: 'conservative', personality: 'A prosecutor who holds that a law unevenly enforced is worse than no law at all' },
  { name: 'thaddeus-broome',  displayName: 'Thaddeus Broome',  alignment: 'conservative', personality: 'A grocer and church deacon who trusts what a community builds slowly over what a capital decrees quickly' },

  /* ---- Libertarian (4) ---- */
  { name: 'calliope-strand',  displayName: 'Calliope Strand',  alignment: 'libertarian', personality: 'A defense attorney who has never met an emergency power that was returned on schedule' },
  { name: 'omar-haddad',      displayName: 'Omar Haddad',      alignment: 'libertarian', personality: 'A food-truck owner whose politics were written one permit, one fine, and one inspection at a time' },
  { name: 'birdie-lawson',    displayName: 'Birdie Lawson',    alignment: 'libertarian', personality: 'A bush pilot who believes the freedom to fail is the only honest guarantee a government can offer' },
  { name: 'gideon-frost',     displayName: 'Gideon Frost',     alignment: 'libertarian', personality: 'An economist who treats every subsidy as a confession that the policy could not survive on consent' },

  /* ---- Technocrat (4) ---- */
  { name: 'anika-sorensen',   displayName: 'Anika Sorensen',   alignment: 'technocrat', personality: 'An epidemiologist who wants every law shipped with a control group and a sunset date' },
  { name: 'ravi-pillai',      displayName: 'Ravi Pillai',      alignment: 'technocrat', personality: 'A grid engineer who believes civilization is infrastructure and infrastructure is maintenance nobody thanks you for' },
  { name: 'margot-lindqvist', displayName: 'Margot Lindqvist', alignment: 'technocrat', personality: 'A procurement auditor who has read every appendix and believes the scandal is always in the appendix' },
  { name: 'felix-okafor',     displayName: 'Felix Okafor',     alignment: 'technocrat', personality: 'A logistics director who measures government the way he measures freight: arrival time, condition, and cost' },
];

export const NAME_MAX = 50;
export const DISPLAY_NAME_MAX = 100;

export function validatePersonas(
  personas: readonly PersonaDef[],
  reserved: readonly string[],
): string[] {
  const errors: string[] = [];
  const reservedSet = new Set(reserved);
  const seen = new Set<string>();

  for (const p of personas) {
    if (p.name.length > NAME_MAX) errors.push(`name too long (${p.name.length} > ${NAME_MAX}): ${p.name}`);
    if (p.displayName.length > DISPLAY_NAME_MAX) errors.push(`displayName too long: ${p.name}`);
    if (!/^[a-z]+(-[a-z]+)*$/.test(p.name)) errors.push(`name is not a lowercase hyphen slug: ${p.name}`);
    if (seen.has(p.name)) errors.push(`duplicate name in batch: ${p.name}`);
    seen.add(p.name);
    if (reservedSet.has(p.name)) errors.push(`name collides with an existing seed source: ${p.name}`);
    if (!ALIGNMENTS.includes(p.alignment)) errors.push(`unknown alignment '${p.alignment}': ${p.name}`);
    if (!p.personality.trim()) errors.push(`empty personality: ${p.name}`);
  }

  for (const a of ALIGNMENTS) {
    const n = personas.filter((p) => p.alignment === a).length;
    if (n !== 4) errors.push(`alignment '${a}' has ${n} personas, expected 4`);
  }

  return errors;
}

/**
 * Interleave personas by cycling through alignments so ANY contiguous window
 * stays balanced: --count 10 --offset 0 and --offset 10 each get 2 per alignment.
 */
export function orderRoundRobin(personas: readonly PersonaDef[]): PersonaDef[] {
  const buckets = new Map<Alignment, PersonaDef[]>(ALIGNMENTS.map((a) => [a, []]));
  for (const p of personas) buckets.get(p.alignment)?.push(p);

  const out: PersonaDef[] = [];
  const depth = Math.max(...Array.from(buckets.values(), (b) => b.length));
  for (let i = 0; i < depth; i++) {
    for (const a of ALIGNMENTS) {
      const p = buckets.get(a)?.[i];
      if (p) out.push(p);
    }
  }
  return out;
}

/** Offset windowing over the round-robin ordering. Clamps at the end; an
 *  out-of-range window returns [] and the caller refuses to proceed. */
export function planWave(
  personas: readonly PersonaDef[],
  count: number,
  offset: number,
): PersonaDef[] {
  if (!Number.isInteger(count) || !Number.isInteger(offset) || count < 1 || offset < 0) return [];
  return orderRoundRobin(personas).slice(offset, offset + count);
}

/** Deterministic agoraId — the script's ownership marker. Other creation
 *  paths differ (the admin route appends a timestamp: `agora_<name>_<ts>`). */
export function expectedAgoraId(name: string): string {
  return `agora_${name}`;
}

/** A name match whose agoraId is not the deterministic one belongs to some
 *  other creation path — the repair pass must never adopt or party-enroll it. */
export function isForeignAgent(name: string, agoraId: string): boolean {
  return agoraId !== expectedAgoraId(name);
}

export function buildAgentRow(persona: PersonaDef, balance: number): PlannedAgentRow {
  return {
    agoraId: expectedAgoraId(persona.name),
    name: persona.name,
    displayName: persona.displayName,
    alignment: persona.alignment,
    modelProvider: 'openai',
    model: undefined,
    personality: persona.personality,
    reputation: 100,
    approvalRating: 50,
    balance,
    isActive: true,
  };
}

export interface ActivePartyRow {
  id: string;
  name: string;
  alignment: string;
}

export type PartyMapResult =
  | { ok: true; byAlignment: Map<Alignment, ActivePartyRow> }
  | { ok: false; errors: string[] };

/** Input must already be filtered to isActive=true rows. Every required
 *  alignment must map to exactly one active party — 0 or >1 aborts. */
export function mapAlignmentsToParties(activeParties: readonly ActivePartyRow[]): PartyMapResult {
  const errors: string[] = [];
  const byAlignment = new Map<Alignment, ActivePartyRow>();

  for (const a of ALIGNMENTS) {
    const matches = activeParties.filter((p) => p.alignment === a);
    if (matches.length === 0) {
      errors.push(`no active party for alignment '${a}'`);
    } else if (matches.length > 1) {
      errors.push(`${matches.length} active parties for alignment '${a}': ${matches.map((m) => m.name).join(', ')}`);
    } else {
      byAlignment.set(a, matches[0]);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, byAlignment };
}

export interface ExistingPartition {
  toInsert: string[];
  /** Names already in the DB: skip the agent insert but STILL run the
   *  membership guard/insert, so a crash between the two self-heals. */
  toRepair: string[];
}

export function partitionByExisting(
  waveNames: readonly string[],
  existingNames: readonly string[],
): ExistingPartition {
  const existing = new Set(existingNames);
  const toInsert: string[] = [];
  const toRepair: string[] = [];
  for (const n of waveNames) (existing.has(n) ? toRepair : toInsert).push(n);
  return { toInsert, toRepair };
}

export type ModelSource =
  | 'api_providers.default_model'
  | 'runtime_config.simInferenceModel'
  | 'env OPENAI_MODEL'
  | "built-in fallback 'gpt-4o-mini'";

export interface ResolvedModel {
  model: string;
  source: ModelSource;
}

/**
 * Mirror of the openai path of getDefaultModel (src/core/server/services/ai.ts:813-826),
 * which is module-private there. Same truthiness semantics: '' and NULL both
 * fall through at every level. Keep in sync with ai.ts if that chain changes.
 */
export function resolveOpenAiModel(inputs: {
  providerDefaultModel: string | null;
  simInferenceModel: string;
  envOpenAiModel: string | undefined;
}): ResolvedModel {
  if (inputs.providerDefaultModel) {
    return { model: inputs.providerDefaultModel, source: 'api_providers.default_model' };
  }
  if (inputs.simInferenceModel) {
    return { model: inputs.simInferenceModel, source: 'runtime_config.simInferenceModel' };
  }
  if (inputs.envOpenAiModel) {
    return { model: inputs.envOpenAiModel, source: 'env OPENAI_MODEL' };
  }
  return { model: 'gpt-4o-mini', source: "built-in fallback 'gpt-4o-mini'" };
}

export type BalanceSource = 'runtime_config DB row' | 'code defaults';

/** Key presence, not truthiness: loadRuntimeConfig merges `{...DEFAULTS, ...config}`,
 *  so an explicit 0 in the DB row would win over the default. */
export function balanceSourceOf(configJson: Record<string, unknown> | null | undefined): BalanceSource {
  if (configJson && Object.prototype.hasOwnProperty.call(configJson, 'initialAgentBalance')) {
    return 'runtime_config DB row';
  }
  return 'code defaults';
}
