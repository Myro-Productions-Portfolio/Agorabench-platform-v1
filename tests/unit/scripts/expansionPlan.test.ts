import { describe, it, expect } from 'vitest';
import {
  ALIGNMENTS,
  PERSONAS,
  RESERVED_NAMES,
  NAME_MAX,
  DISPLAY_NAME_MAX,
  validatePersonas,
  orderRoundRobin,
  planWave,
  buildAgentRow,
  expectedAgoraId,
  isForeignAgent,
  mapAlignmentsToParties,
  partitionByExisting,
  resolveOpenAiModel,
  balanceSourceOf,
  type PersonaDef,
  type ActivePartyRow,
} from '../../../scripts/lib/expansionPlan';

const countByAlignment = (wave: readonly PersonaDef[]) => {
  const m = new Map<string, number>();
  for (const p of wave) m.set(p.alignment, (m.get(p.alignment) ?? 0) + 1);
  return m;
};

describe('PERSONAS batch', () => {
  it('has exactly 20 personas, 4 per alignment, across all 5 alignments', () => {
    expect(PERSONAS).toHaveLength(20);
    const counts = countByAlignment(PERSONAS);
    expect(counts.size).toBe(5);
    for (const a of ALIGNMENTS) expect(counts.get(a)).toBe(4);
  });

  it('passes every validation rule against the reserved name set', () => {
    expect(validatePersonas(PERSONAS, RESERVED_NAMES)).toEqual([]);
  });

  it('reserves all 30 names from the three legacy seed sources', () => {
    expect(RESERVED_NAMES).toHaveLength(30);
    expect(new Set(RESERVED_NAMES).size).toBe(30);
    // spot checks, one per source
    expect(RESERVED_NAMES).toContain('vera-okonkwo'); // seed.ts / seedFn.ts
    expect(RESERVED_NAMES).toContain('cal-brennan'); // add-political-agents.ts
    expect(RESERVED_NAMES).toContain('yuki-sato'); // legacy seed-expansion-agents.ts
  });

  it('respects the schema length limits', () => {
    for (const p of PERSONAS) {
      expect(p.name.length).toBeLessThanOrEqual(NAME_MAX);
      expect(p.displayName.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX);
    }
  });
});

describe('validatePersonas', () => {
  const good: PersonaDef = { name: 'new-agent', displayName: 'New Agent', alignment: 'moderate', personality: 'x' };

  it('flags reserved-name collisions', () => {
    const bad = { ...good, name: 'vera-okonkwo' };
    expect(validatePersonas([bad], RESERVED_NAMES).join()).toMatch(/collides/);
  });

  it('flags in-batch duplicates, bad slugs, and over-long names', () => {
    const errs = validatePersonas(
      [good, good, { ...good, name: 'Bad Slug!' }, { ...good, name: 'a'.repeat(NAME_MAX + 1) }],
      [],
    );
    expect(errs.join()).toMatch(/duplicate name/);
    expect(errs.join()).toMatch(/not a lowercase hyphen slug/);
    expect(errs.join()).toMatch(/too long/);
  });

  it('flags alignment count drift', () => {
    expect(validatePersonas([good], []).join()).toMatch(/expected 4/);
  });
});

describe('orderRoundRobin + planWave (offset windowing)', () => {
  it('keeps any half-window balanced: 2 per alignment in each wave of 10', () => {
    const wave1 = planWave(PERSONAS, 10, 0);
    const wave2 = planWave(PERSONAS, 10, 10);
    expect(wave1).toHaveLength(10);
    expect(wave2).toHaveLength(10);
    for (const wave of [wave1, wave2]) {
      const counts = countByAlignment(wave);
      for (const a of ALIGNMENTS) expect(counts.get(a)).toBe(2);
    }
  });

  it('waves partition the batch with no overlap and no loss', () => {
    const names = [...planWave(PERSONAS, 10, 0), ...planWave(PERSONAS, 10, 10)].map((p) => p.name);
    expect(names).toHaveLength(20);
    expect(new Set(names).size).toBe(20);
    expect(new Set(names)).toEqual(new Set(PERSONAS.map((p) => p.name)));
  });

  it('round-robin ordering cycles alignments', () => {
    const ordered = orderRoundRobin(PERSONAS);
    expect(ordered.slice(0, 5).map((p) => p.alignment)).toEqual([...ALIGNMENTS]);
  });

  it('clamps a window that runs past the end', () => {
    expect(planWave(PERSONAS, 10, 15)).toHaveLength(5);
    expect(planWave(PERSONAS, 10, 20)).toHaveLength(0);
  });

  it('returns [] for invalid count/offset', () => {
    expect(planWave(PERSONAS, 0, 0)).toHaveLength(0);
    expect(planWave(PERSONAS, -1, 0)).toHaveLength(0);
    expect(planWave(PERSONAS, 10, -1)).toHaveLength(0);
    expect(planWave(PERSONAS, 2.5, 0)).toHaveLength(0);
  });
});

describe('buildAgentRow', () => {
  it('produces the exact planned row shape', () => {
    const row = buildAgentRow(PERSONAS[0], 25_000);
    expect(row).toEqual({
      agoraId: `agora_${PERSONAS[0].name}`,
      name: PERSONAS[0].name,
      displayName: PERSONAS[0].displayName,
      alignment: PERSONAS[0].alignment,
      modelProvider: 'openai',
      model: undefined,
      personality: PERSONAS[0].personality,
      reputation: 100,
      approvalRating: 50,
      balance: 25_000,
      isActive: true,
    });
  });

  it('leaves model undefined (NULL), never empty string', () => {
    expect(buildAgentRow(PERSONAS[0], 1).model).toBeUndefined();
  });

  it('uses the deterministic agoraId shared with the repair discriminator', () => {
    expect(buildAgentRow(PERSONAS[0], 1).agoraId).toBe(expectedAgoraId(PERSONAS[0].name));
  });
});

describe('isForeignAgent (repair-path discriminator)', () => {
  it('accepts a row carrying the deterministic script agoraId', () => {
    expect(isForeignAgent('odessa-reyes', 'agora_odessa-reyes')).toBe(false);
  });

  it('flags admin-route rows (timestamp-suffixed agoraId) as foreign', () => {
    expect(isForeignAgent('odessa-reyes', 'agora_odessa-reyes_1787168032062')).toBe(true);
  });

  it('flags any other agoraId shape as foreign', () => {
    expect(isForeignAgent('odessa-reyes', 'agora_someone-else')).toBe(true);
    expect(isForeignAgent('odessa-reyes', '')).toBe(true);
  });
});

describe('mapAlignmentsToParties', () => {
  const party = (alignment: string, name = `${alignment} party`): ActivePartyRow => ({
    id: `id-${name}`,
    name,
    alignment,
  });
  const fiveParties = ALIGNMENTS.map((a) => party(a));

  it('maps each alignment to its single active party', () => {
    const res = mapAlignmentsToParties(fiveParties);
    expect(res.ok).toBe(true);
    if (res.ok) {
      for (const a of ALIGNMENTS) expect(res.byAlignment.get(a)?.alignment).toBe(a);
    }
  });

  it('fails when an alignment has no active party', () => {
    const res = mapAlignmentsToParties(fiveParties.slice(1));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join()).toMatch(/no active party for alignment 'progressive'/);
  });

  it('fails when an alignment has more than one active party', () => {
    const res = mapAlignmentsToParties([...fiveParties, party('moderate', 'Splinter Coalition')]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join()).toMatch(/2 active parties for alignment 'moderate'/);
  });

  it('reports every problem, not just the first', () => {
    const res = mapAlignmentsToParties([]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors).toHaveLength(5);
  });
});

describe('partitionByExisting (collision set math)', () => {
  it('splits wave names into toInsert and toRepair, preserving order', () => {
    const { toInsert, toRepair } = partitionByExisting(['a', 'b', 'c', 'd'], ['b', 'd', 'zzz']);
    expect(toInsert).toEqual(['a', 'c']);
    expect(toRepair).toEqual(['b', 'd']);
  });

  it('handles the all-new and all-existing extremes', () => {
    expect(partitionByExisting(['a'], [])).toEqual({ toInsert: ['a'], toRepair: [] });
    expect(partitionByExisting(['a'], ['a'])).toEqual({ toInsert: [], toRepair: ['a'] });
  });
});

describe('resolveOpenAiModel (mirror of ai.ts getDefaultModel, openai path)', () => {
  it('prefers api_providers.default_model', () => {
    expect(
      resolveOpenAiModel({ providerDefaultModel: 'gemma-4-31b', simInferenceModel: 'other', envOpenAiModel: 'env' }),
    ).toEqual({ model: 'gemma-4-31b', source: 'api_providers.default_model' });
  });

  it('falls through NULL and empty-string provider rows to simInferenceModel', () => {
    for (const providerDefaultModel of [null, '']) {
      expect(
        resolveOpenAiModel({ providerDefaultModel, simInferenceModel: 'gemma-4-31b', envOpenAiModel: 'env' }),
      ).toEqual({ model: 'gemma-4-31b', source: 'runtime_config.simInferenceModel' });
    }
  });

  it('falls through to env OPENAI_MODEL, then the built-in fallback', () => {
    expect(
      resolveOpenAiModel({ providerDefaultModel: null, simInferenceModel: '', envOpenAiModel: 'env-model' }),
    ).toEqual({ model: 'env-model', source: 'env OPENAI_MODEL' });
    expect(
      resolveOpenAiModel({ providerDefaultModel: null, simInferenceModel: '', envOpenAiModel: undefined }),
    ).toEqual({ model: 'gpt-4o-mini', source: "built-in fallback 'gpt-4o-mini'" });
  });
});

describe('balanceSourceOf', () => {
  it('reports the DB row when the key is present — even explicit falsy values', () => {
    expect(balanceSourceOf({ initialAgentBalance: 25_000 })).toBe('runtime_config DB row');
    expect(balanceSourceOf({ initialAgentBalance: 0 })).toBe('runtime_config DB row');
  });

  it('reports code defaults when the row or key is missing', () => {
    expect(balanceSourceOf({})).toBe('code defaults');
    expect(balanceSourceOf(null)).toBe('code defaults');
    expect(balanceSourceOf(undefined)).toBe('code defaults');
  });
});
