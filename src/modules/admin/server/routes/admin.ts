import { Router } from 'express';
import { db } from '@db/connection';
import { agentDecisions, agents, governmentSettings, users, researcherRequests, approvalEvents, bills, laws, billVotes, elections, campaigns, aggeInterventions } from '@db/schema/index';
import { and, count, eq, ne, sql, asc, desc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  pauseSimulation,
  resumeSimulation,
  triggerManualTick,
  getSimulationStatus,
  changeTickInterval,
  retryFailedJobs,
} from '@core/server/jobs/agentTick.js';
import { triggerManualAggeTick, changeAggeTickInterval } from '@core/server/jobs/aggeTick.js';
import { godMode } from '@core/server/lib/tickReconcile.js';
import { runSeed } from '@db/seedFn';
import { getRuntimeConfig, updateRuntimeConfig } from '@core/server/runtimeConfig.js';
import type { ProviderOverride } from '@core/server/runtimeConfig.js';
import { requireOwner } from '@core/server/middleware/auth.js';
import { finalizeElection } from '@modules/elections/server/finalizeElection.js';
import { electionTickSchedule, wallDateForTick, ELECTION_LIFECYCLE_TYPES } from '@core/server/lib/electionMath.js';
import { getCurrentTickNumber } from '@core/server/lib/tickClock.js';
import healthRouter from './health.js';

const router = Router();

/* ---- CSV helper ---- */
export function toCSV(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const escape = (v: string | number | boolean | null | undefined): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return [headers.join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
}

/* All /admin/* routes are owner-only */
router.use('/admin', requireOwner);

/* /god/* routes fall outside the /admin prefix above — give them the same
   router-level owner backstop (defense in depth; per-route requireOwner
   guards on each /god handler are kept too). */
router.use('/god', requireOwner);

router.use(healthRouter);

/* GET /api/admin/status — simulation state + decision stats */
router.get('/admin/status', async (_req, res, next) => {
  try {
    const simStatus = await getSimulationStatus();

    const [stats] = await db
      .select({
        total: count(),
        errors: sql<number>`COUNT(*) FILTER (WHERE ${agentDecisions.success} = false)`,
        haikuCount: sql<number>`COUNT(*) FILTER (WHERE ${agentDecisions.provider} = 'haiku')`,
        ollamaCount: sql<number>`COUNT(*) FILTER (WHERE ${agentDecisions.provider} = 'ollama')`,
      })
      .from(agentDecisions);

    res.json({ success: true, data: { simulation: simStatus, decisions: stats } });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/pause */
router.post('/admin/pause', async (_req, res, next) => {
  try {
    await pauseSimulation();
    res.json({ success: true, data: { message: 'Simulation paused' } });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/resume */
router.post('/admin/resume', async (_req, res, next) => {
  try {
    await resumeSimulation();
    res.json({ success: true, data: { message: 'Simulation resumed' } });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/tick — trigger one immediate tick */
router.post('/admin/tick', async (_req, res, next) => {
  try {
    await triggerManualTick();
    res.json({ success: true, data: { message: 'Tick queued' } });
  } catch (error) {
    next(error);
  }
});

/* POST /admin/retry-failed -- Retry all failed Bull jobs */
router.post('/admin/retry-failed', async (_req, res, next) => {
  try {
    const count = await retryFailedJobs();
    res.json({ success: true, data: { retriedCount: count }, message: `Retried ${count} failed jobs` });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/reseed — wipe and reseed the database (owner only) */
router.post('/admin/reseed', requireOwner, async (_req, res, next) => {
  try {
    await runSeed();
    res.json({ success: true, data: { message: 'Database reseeded' } });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/decisions — decision log with agent name, all fields */
router.get('/admin/decisions', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10)));
    const offset = (page - 1) * limit;

    const rows = await db
      .select({
        id: agentDecisions.id,
        agentName: agents.displayName,
        provider: agentDecisions.provider,
        phase: agentDecisions.phase,
        parsedAction: agentDecisions.parsedAction,
        parsedReasoning: agentDecisions.parsedReasoning,
        success: agentDecisions.success,
        latencyMs: agentDecisions.latencyMs,
        createdAt: agentDecisions.createdAt,
      })
      .from(agentDecisions)
      .leftJoin(agents, eq(agentDecisions.agentId, agents.id))
      .orderBy(sql`${agentDecisions.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/config — current runtime configuration (owner only) */
router.get('/admin/config', requireOwner, (_req, res) => {
  res.json({ success: true, data: getRuntimeConfig() });
});

/* Internal inference targets — served only through this owner-gated endpoint
   so LAN addresses never ship in the public client bundle. */
const INFERENCE_PRESETS: Array<{ label: string; url: string; model?: string }> = [
  { label: 'Gemma-4-31B (spark1)', url: 'http://10.0.0.69:1234/v1', model: 'gemma-4-31b' },
  { label: 'Qwen3.8-27B (spark2)', url: 'http://10.0.0.169:8000/v1', model: 'qwen3.8-27b' },
];

/* GET /api/admin/inference-presets — internal inference targets (owner only) */
router.get('/admin/inference-presets', requireOwner, (_req, res) => {
  res.json({
    success: true,
    data: { presets: INFERENCE_PRESETS.map(({ label, url, model }) => ({ label, url, model })) },
  });
});

/* POST /api/admin/config — update runtime configuration (owner only) */
router.post('/admin/config', requireOwner, async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const update: Parameters<typeof updateRuntimeConfig>[0] = {};

    const num = (key: string, min: number, max: number): number | undefined => {
      const v = body[key];
      if (typeof v === 'number' && !isNaN(v)) return Math.max(min, Math.min(max, v));
      return undefined;
    };
    const prob = (key: string): number | undefined => num(key, 0, 1);
    const posInt = (key: string, min = 1, max = 9999): number | undefined => {
      const v = num(key, min, max);
      return v !== undefined ? Math.round(v) : undefined;
    };

    /* Simulation */
    if (typeof body.tickIntervalMs === 'number' && body.tickIntervalMs >= 30_000) {
      update.tickIntervalMs = body.tickIntervalMs;
      await changeTickInterval(body.tickIntervalMs);
    }
    const badMs = num('billAdvancementDelayMs', 10_000, 86_400_000);
    if (badMs !== undefined) update.billAdvancementDelayMs = badMs;
    const VALID_PROVIDERS = ['default', 'anthropic', 'openai', 'google', 'huggingface', 'ollama'];
    if (typeof body.providerOverride === 'string' && VALID_PROVIDERS.includes(body.providerOverride)) {
      update.providerOverride = body.providerOverride as ProviderOverride;
    }

    /* Guard Rails */
    const mplc = posInt('maxPromptLengthChars', 500, 32000);
    if (mplc !== undefined) update.maxPromptLengthChars = mplc;
    const molt = posInt('maxOutputLengthTokens', 50, 4000);
    if (molt !== undefined) update.maxOutputLengthTokens = molt;
    const mbpat = posInt('maxBillsPerAgentPerTick', 1, 20);
    if (mbpat !== undefined) update.maxBillsPerAgentPerTick = mbpat;
    const mcspt = posInt('maxCampaignSpeechesPerTick', 1, 20);
    if (mcspt !== undefined) update.maxCampaignSpeechesPerTick = mcspt;
    const mfbpt = posInt('maxFloorBillsPerTick', 1, 20);
    if (mfbpt !== undefined) update.maxFloorBillsPerTick = mfbpt;
    const bfet = posInt('billFloorExpiryTicks', 0, 1000);
    if (bfet !== undefined) update.billFloorExpiryTicks = bfet;

    /* Agent Behavior */
    const bpc = prob('billProposalChance');       if (bpc !== undefined) update.billProposalChance = bpc;
    const csc = prob('campaignSpeechChance');     if (csc !== undefined) update.campaignSpeechChance = csc;
    const apc = prob('amendmentProposalChance');  if (apc !== undefined) update.amendmentProposalChance = apc;

    /* Government Structure */
    const cs = posInt('congressSeats', 1, 500);           if (cs !== undefined) update.congressSeats = cs;
    const ctd = posInt('congressTermDays', 7, 3650);      if (ctd !== undefined) update.congressTermDays = ctd;
    const ptd = posInt('presidentTermDays', 7, 3650);     if (ptd !== undefined) update.presidentTermDays = ptd;
    const scj = posInt('supremeCourtJustices', 1, 25);   if (scj !== undefined) update.supremeCourtJustices = scj;
    const qp = prob('quorumPercentage');                   if (qp !== undefined) update.quorumPercentage = qp;
    const bpp = prob('billPassagePercentage');             if (bpp !== undefined) update.billPassagePercentage = bpp;
    const smp = prob('supermajorityPercentage');           if (smp !== undefined) update.supermajorityPercentage = smp;

    /* Elections */
    const cdd = posInt('campaignDurationDays', 1, 365);   if (cdd !== undefined) update.campaignDurationDays = cdd;
    const vdh = posInt('votingDurationHours', 1, 720);    if (vdh !== undefined) update.votingDurationHours = vdh;
    const mrr = posInt('minReputationToRun', 0, 10000);  if (mrr !== undefined) update.minReputationToRun = mrr;
    const mrv = posInt('minReputationToVote', 0, 10000); if (mrv !== undefined) update.minReputationToVote = mrv;

    /* Economy */
    const iab = posInt('initialAgentBalance', 0, 10_000_000); if (iab !== undefined) update.initialAgentBalance = iab;
    const cff = posInt('campaignFilingFee', 0, 1_000_000);    if (cff !== undefined) update.campaignFilingFee = cff;
    const pcf = posInt('partyCreationFee', 0, 1_000_000);     if (pcf !== undefined) update.partyCreationFee = pcf;
    const sp = posInt('salaryPresident', 0, 1_000_000);        if (sp !== undefined) update.salaryPresident = sp;
    const sc = posInt('salaryCabinet', 0, 1_000_000);          if (sc !== undefined) update.salaryCabinet = sc;
    const scg = posInt('salaryCongress', 0, 1_000_000);        if (scg !== undefined) update.salaryCongress = scg;
    const sj = posInt('salaryJustice', 0, 1_000_000);          if (sj !== undefined) update.salaryJustice = sj;
    const ppt = posInt('payPeriodTicks', 7, 28);               if (ppt !== undefined) update.payPeriodTicks = ppt;
    const gdp = posInt('gdpAnnual', 1_000_000_000_000, 100_000_000_000_000); if (gdp !== undefined) update.gdpAnnual = gdp;
    const pop = posInt('agoraPopulation', 1_000_000, 10_000_000_000);         if (pop !== undefined) update.agoraPopulation = pop;

    /* Governance Probabilities */
    const vbr = prob('vetoBaseRate');                     if (vbr !== undefined) update.vetoBaseRate = vbr;
    const vrpt = prob('vetoRatePerTier');                 if (vrpt !== undefined) update.vetoRatePerTier = vrpt;
    const vmr = prob('vetoMaxRate');                      if (vmr !== undefined) update.vetoMaxRate = vmr;
    const ctro = prob('committeeTableRateOpposing');      if (ctro !== undefined) update.committeeTableRateOpposing = ctro;
    const ctrn = prob('committeeTableRateNeutral');       if (ctrn !== undefined) update.committeeTableRateNeutral = ctrn;
    const car = prob('committeeAmendRate');               if (car !== undefined) update.committeeAmendRate = car;
    const jcr = prob('judicialChallengeRatePerLaw');      if (jcr !== undefined) update.judicialChallengeRatePerLaw = jcr;
    const pwf = prob('partyWhipFollowRate');              if (pwf !== undefined) update.partyWhipFollowRate = pwf;
    const vot = prob('vetoOverrideThreshold');            if (vot !== undefined) update.vetoOverrideThreshold = vot;

    /* AGGE */
    if (typeof body.aggeEnabled === 'boolean') {
      update.aggeEnabled = body.aggeEnabled;
    }
    const atiMs = num('aggeTickIntervalMs', 60_000, 86_400_000);
    if (atiMs !== undefined) {
      update.aggeTickIntervalMs = Math.round(atiMs);
      await changeAggeTickInterval(update.aggeTickIntervalMs);
    }
    const aaptMin = posInt('aggeAgentsPerTickMin', 1, 10);
    if (aaptMin !== undefined) update.aggeAgentsPerTickMin = aaptMin;
    const aaptMax = posInt('aggeAgentsPerTickMax', 1, 10);
    if (aaptMax !== undefined) update.aggeAgentsPerTickMax = aaptMax;
    const aTemp = num('aggeTemperature', 0, 2);
    if (aTemp !== undefined) update.aggeTemperature = aTemp;
    if (typeof body.aggeInferenceUrl === 'string') {
      update.aggeInferenceUrl = body.aggeInferenceUrl.trim();
    }
    if (typeof body.aggeInferenceModel === 'string') {
      update.aggeInferenceModel = body.aggeInferenceModel.trim();
    }
    if (typeof body.aggeEvolutionPressureWeighted === 'boolean') {
      update.aggeEvolutionPressureWeighted = body.aggeEvolutionPressureWeighted;
    }

    /* Simulation Inference */
    if (typeof body.simInferenceUrl === 'string') {
      update.simInferenceUrl = body.simInferenceUrl.trim();
    }
    if (typeof body.simInferenceModel === 'string') {
      update.simInferenceModel = body.simInferenceModel.trim();
    }

    /* Relationship & Forum */
    const rdr = num('relationshipDecayRate', 0, 1);
    if (rdr !== undefined) update.relationshipDecayRate = rdr;
    const fisb = num('forumInteractionSentimentBonus', 0, 1);
    if (fisb !== undefined) update.forumInteractionSentimentBonus = fisb;
    const fbsw = num('forumBaseSilenceWeight', 0, 10);
    if (fbsw !== undefined) update.forumBaseSilenceWeight = fbsw;
    const fdhlt = posInt('forumDecayHalfLifeTicks', 1, 20);
    if (fdhlt !== undefined) update.forumDecayHalfLifeTicks = fdhlt;
    const fspt = posInt('forumSilencePressureThreshold', 1, 20);
    if (fspt !== undefined) update.forumSilencePressureThreshold = fspt;
    const mfppapt = posInt('maxForumPostsPerAgentPerTick', 1, 10);
    if (mfppapt !== undefined) update.maxForumPostsPerAgentPerTick = mfppapt;
    const mfppt = posInt('maxForumPostsPerTick', 1, 50);
    if (mfppt !== undefined) update.maxForumPostsPerTick = mfppt;
    const mfrpt = posInt('maxForumRepliesPerTick', 1, 50);
    if (mfrpt !== undefined) update.maxForumRepliesPerTick = mfrpt;

    /* Economy Dynamic Weights */
    const tct = num('treasuryCrisisThreshold', 0, 1);
    if (tct !== undefined) update.treasuryCrisisThreshold = tct;
    const epmc = num('economyProposalMultiplierCrisis', 1, 3);
    if (epmc !== undefined) update.economyProposalMultiplierCrisis = epmc;

    /* Judiciary Dynamic Weights */
    const jcb = num('judicialContestationBonus', 1, 5);
    if (jcb !== undefined) update.judicialContestationBonus = jcb;
    const jrb = num('judicialRecencyBonus', 1, 5);
    if (jrb !== undefined) update.judicialRecencyBonus = jrb;

    /* Elections Dynamic Weights */
    if (typeof body.electionPostOutcomeCascade === 'boolean') {
      update.electionPostOutcomeCascade = body.electionPostOutcomeCascade;
    }

    /* Approval Feedback */
    const adt = num('approvalDecayTarget', 0, 100);
    if (adt !== undefined) update.approvalDecayTarget = adt;
    if (typeof body.approvalInSystemPrompt === 'boolean') {
      update.approvalInSystemPrompt = body.approvalInSystemPrompt;
    }

    // Lobbying
    if (body.lobbyingEnabled !== undefined) {
      update.lobbyingEnabled = Boolean(body.lobbyingEnabled);
    }
    if (body.maxLobbyistsPerTick !== undefined) {
      const v = Number(body.maxLobbyistsPerTick);
      if (!isFinite(v) || v < 1 || v > 10) { res.status(400).json({ error: 'maxLobbyistsPerTick must be 1–10' }); return; }
      update.maxLobbyistsPerTick = Math.round(v);
    }
    if (body.lobbyingPositionShiftChance !== undefined) {
      const v = Number(body.lobbyingPositionShiftChance);
      if (!isFinite(v) || v < 0 || v > 1) { res.status(400).json({ error: 'lobbyingPositionShiftChance must be 0.0–1.0' }); return; }
      update.lobbyingPositionShiftChance = v;
    }

    // Floor Amendments
    if (body.floorAmendmentsEnabled !== undefined) {
      update.floorAmendmentsEnabled = Boolean(body.floorAmendmentsEnabled);
    }
    if (body.maxAmendmentsPerBillPerTick !== undefined) {
      const v = Number(body.maxAmendmentsPerBillPerTick);
      if (!isFinite(v) || v < 1 || v > 5) { res.status(400).json({ error: 'maxAmendmentsPerBillPerTick must be 1–5' }); return; }
      update.maxAmendmentsPerBillPerTick = Math.round(v);
    }

    // Committees
    if (body.committeeMarkupEnabled !== undefined) {
      update.committeeMarkupEnabled = Boolean(body.committeeMarkupEnabled);
    }

    // Bill Withdrawal
    if (body.billWithdrawalEnabled !== undefined) {
      update.billWithdrawalEnabled = Boolean(body.billWithdrawalEnabled);
    }

    // Public Statements
    if (body.publicStatementsEnabled !== undefined) {
      update.publicStatementsEnabled = Boolean(body.publicStatementsEnabled);
    }
    if (body.proactiveStatementChance !== undefined) {
      const v = Number(body.proactiveStatementChance);
      if (!isFinite(v) || v < 0 || v > 0.20) { res.status(400).json({ error: 'proactiveStatementChance must be 0.0–0.20' }); return; }
      update.proactiveStatementChance = v;
    }
    if (body.maxStatementsPerAgentPerTick !== undefined) {
      const v = Number(body.maxStatementsPerAgentPerTick);
      if (!isFinite(v) || v < 1 || v > 3) { res.status(400).json({ error: 'maxStatementsPerAgentPerTick must be 1–3' }); return; }
      update.maxStatementsPerAgentPerTick = Math.round(v);
    }

    // Daily Gazette
    if (body.gazetteEnabled !== undefined) {
      update.gazetteEnabled = Boolean(body.gazetteEnabled);
    }

    // Vote-Pact Deals
    if (body.dealParsingEnabled !== undefined) {
      update.dealParsingEnabled = Boolean(body.dealParsingEnabled);
    }
    if (body.maxDealsPerTick !== undefined) {
      const v = Number(body.maxDealsPerTick);
      if (!isFinite(v) || v < 1 || v > 10) { res.status(400).json({ error: 'maxDealsPerTick must be 1–10' }); return; }
      update.maxDealsPerTick = Math.round(v);
    }

    // Fiscal Policy (Phase 3) — Rule 1: every RuntimeConfig field gets a
    // server handler branch with type check + range clamp, same commit.
    if (body.fiscalEffectsEnabled !== undefined) {
      update.fiscalEffectsEnabled = Boolean(body.fiscalEffectsEnabled);
    }
    const bct = posInt('budgetCycleTicks', 4, 200);
    if (bct !== undefined) update.budgetCycleTicks = bct;
    const fmot = num('fiscalMaxOneTimePctOfTreasury', 1, 20);
    if (fmot !== undefined) update.fiscalMaxOneTimePctOfTreasury = fmot;
    const fmpr = num('fiscalMaxProgramPctOfRevenue', 1, 50);
    if (fmpr !== undefined) update.fiscalMaxProgramPctOfRevenue = fmpr;
    const frcr = num('fiscalRecurringCapPctOfRevenue', 10, 100);
    if (frcr !== undefined) update.fiscalRecurringCapPctOfRevenue = frcr;
    const fmtd = posInt('fiscalMaxTaxDeltaPerLaw', 1, 5);
    if (fmtd !== undefined) update.fiscalMaxTaxDeltaPerLaw = fmtd;
    const trMin = posInt('taxRateMinPercent', 0, 40);
    const trMax = posInt('taxRateMaxPercent', 5, 60);
    {
      /* Cross-field check on the EFFECTIVE pair (incoming value or current
         config) — a save that would leave min >= max is rejected outright. */
      const current = getRuntimeConfig();
      const effMin = trMin ?? current.taxRateMinPercent;
      const effMax = trMax ?? current.taxRateMaxPercent;
      if ((trMin !== undefined || trMax !== undefined) && effMax <= effMin) {
        res.status(400).json({ error: 'taxRateMaxPercent must be greater than taxRateMinPercent' });
        return;
      }
    }
    if (trMin !== undefined) update.taxRateMinPercent = trMin;
    if (trMax !== undefined) update.taxRateMaxPercent = trMax;
    const mst = posInt('maxSunsetTicks', 10, 1000);
    if (mst !== undefined) update.maxSunsetTicks = mst;
    const thf = num('treasuryHardFloor', -10_000_000_000_000, 0);
    if (thf !== undefined) update.treasuryHardFloor = Math.round(thf);

    // Judicial (Phase 4) — Rule 1: every RuntimeConfig field gets a server
    // handler branch with type check + range clamp, same commit.
    if (typeof body.courtEnabled === 'boolean') {
      update.courtEnabled = body.courtEnabled;
    }
    const cmcc = posInt('courtMaxConcurrentCases', 1, 10);
    if (cmcc !== undefined) update.courtMaxConcurrentCases = cmcc;
    const cmnc = posInt('courtMaxNewCasesPerTick', 1, 5);
    if (cmnc !== undefined) update.courtMaxNewCasesPerTick = cmnc;
    const chdt = posInt('courtHearingDelayTicks', 1, 4);
    if (chdt !== undefined) update.courtHearingDelayTicks = chdt;
    const cdc = prob('courtDisputeChancePerBrokenDeal');
    if (cdc !== undefined) update.courtDisputeChancePerBrokenDeal = cdc;
    const cjq = posInt('courtJusticeQuestionsPerHearing', 0, 4);
    if (cjq !== undefined) update.courtJusticeQuestionsPerHearing = cjq;
    const cda = posInt('courtDamagesAmount', 0, 10_000_000);
    if (cda !== undefined) update.courtDamagesAmount = cda;

    // Debt Engine (Divergence E1 slice 1) — Rule 1: every RuntimeConfig
    // field gets a server handler branch with type check + range clamp,
    // same commit. debtEngineEnabled is the kill switch: false (default)
    // means Phase 12/13 behave byte-identical to pre-slice-1 behavior.
    if (typeof body.debtEngineEnabled === 'boolean') {
      update.debtEngineEnabled = body.debtEngineEnabled;
    }
    const mgpa = num('mandatoryGrowthPctAnnual', 0, 15);
    if (mgpa !== undefined) update.mandatoryGrowthPctAnnual = mgpa;
    const dirp = num('debtInterestRatePct', 0, 15);
    if (dirp !== undefined) update.debtInterestRatePct = dirp;
    const tobd = num('treasuryOperatingBufferDollars', 0, 10_000_000_000_000);
    if (tobd !== undefined) update.treasuryOperatingBufferDollars = Math.round(tobd);
    const fmmd = posInt('fiscalMaxMandatoryDeltaPct', 1, 25);
    if (fmmd !== undefined) update.fiscalMaxMandatoryDeltaPct = fmmd;
    const dcrp = posInt('debtCrisisRatioPct', 50, 500);
    if (dcrp !== undefined) update.debtCrisisRatioPct = dcrp;
    const dt0t = num('divergenceT0Tick', 0, Number.MAX_SAFE_INTEGER);
    if (dt0t !== undefined) update.divergenceT0Tick = Math.round(dt0t);
    if (typeof body.divergenceT0Date === 'string') {
      update.divergenceT0Date = body.divergenceT0Date.trim();
    }

    // World Events Feed (E2 slice 1) — Rule 1: every RuntimeConfig field
    // gets a server handler branch with type check + range clamp, same
    // commit. worldFeedEnabled is the master kill switch: false (default)
    // means no polling happens at all (deploy dark).
    if (typeof body.worldFeedEnabled === 'boolean') {
      update.worldFeedEnabled = body.worldFeedEnabled;
    }
    const wfpt = posInt('worldFeedPollTicks', 1, 48);
    if (wfpt !== undefined) update.worldFeedPollTicks = wfpt;
    if (typeof body.worldFeedUsgsEnabled === 'boolean') {
      update.worldFeedUsgsEnabled = body.worldFeedUsgsEnabled;
    }
    if (typeof body.worldFeedNwsEnabled === 'boolean') {
      update.worldFeedNwsEnabled = body.worldFeedNwsEnabled;
    }
    if (typeof body.worldFeedFemaEnabled === 'boolean') {
      update.worldFeedFemaEnabled = body.worldFeedFemaEnabled;
    }
    if (typeof body.worldFeedGdeltEnabled === 'boolean') {
      update.worldFeedGdeltEnabled = body.worldFeedGdeltEnabled;
    }

    // World Events Injection (E2 slice 2) — Rule 1: server handler branch
    // with type check + range clamp, same commit. worldEventsInjectionEnabled
    // is the prompt-injection channel gate: false (default) means
    // buildWorldEventsBlock() returns '' and prompts are byte-identical to
    // today (deploy dark, independent of worldFeedEnabled which gates polling).
    if (typeof body.worldEventsInjectionEnabled === 'boolean') {
      update.worldEventsInjectionEnabled = body.worldEventsInjectionEnabled;
    }
    const werh = posInt('worldEventsRecencyHours', 1, 168);
    if (werh !== undefined) update.worldEventsRecencyHours = werh;
    const wems = prob('worldEventsMinSeverity');
    if (wems !== undefined) update.worldEventsMinSeverity = wems;
    const wmrh = posInt('worldMapRecencyHours', 1, 720);
    if (wmrh !== undefined) update.worldMapRecencyHours = wmrh;
    // 0 = sweep off; any positive value clamps to 7-365 so retention can never
    // undercut the 72h prompt window or USGS's 7-day re-serve window.
    if (typeof body.worldEventsRetentionDays === 'number' && !Number.isNaN(body.worldEventsRetentionDays)) {
      const v = Math.round(body.worldEventsRetentionDays);
      update.worldEventsRetentionDays = v <= 0 ? 0 : Math.max(7, Math.min(365, v));
    }

    /* Macro Engine (E5) -- Rule 1: every field gets a type check + clamp, same commit */
    if (typeof body.macroEngineEnabled === 'boolean') update.macroEngineEnabled = body.macroEngineEnabled;
    const msent = posInt('macroStepEveryNTicks', 1, 96);
    if (msent !== undefined) update.macroStepEveryNTicks = msent;
    const mseed = posInt('macroRngSeedInit', 1, 2_147_483_646);
    if (mseed !== undefined) update.macroRngSeedInit = mseed;
    const mrh = prob('macroRecessionHazardMonthly');
    if (mrh !== undefined) update.macroRecessionHazardMonthly = mrh;
    const mvh = prob('macroRecoveryHazardMonthly');
    if (mvh !== undefined) update.macroRecoveryHazardMonthly = mvh;
    const mte = num('macroGdpTrendExpansionPct', 0, 8);
    if (mte !== undefined) update.macroGdpTrendExpansionPct = mte;
    const mtr = num('macroGdpTrendRecessionPct', -10, 0);
    if (mtr !== undefined) update.macroGdpTrendRecessionPct = mtr;
    const mgp = num('macroGdpPhiQuarterly', 0, 0.95);
    if (mgp !== undefined) update.macroGdpPhiQuarterly = mgp;
    const mgs = num('macroGdpShockSigmaPct', 0, 2);
    if (mgs !== undefined) update.macroGdpShockSigmaPct = mgs;
    const mok = num('macroOkunCoeff', 0, 1.5);
    if (mok !== undefined) update.macroOkunCoeff = mok;
    const mnu = num('macroNaturalUnemploymentPct', 2, 8);
    if (mnu !== undefined) update.macroNaturalUnemploymentPct = mnu;
    const muf = num('macroUnemploymentFloorPct', 0.5, 4);
    if (muf !== undefined) update.macroUnemploymentFloorPct = muf;
    const mpn = num('macroPhillipsSlopeNormal', 0, 1);
    if (mpn !== undefined) update.macroPhillipsSlopeNormal = mpn;
    const mpt = num('macroPhillipsSlopeTight', 0, 3);
    if (mpt !== undefined) update.macroPhillipsSlopeTight = mpt;
    const mth = num('macroPhillipsTightThresholdPct', 2, 6);
    if (mth !== undefined) update.macroPhillipsTightThresholdPct = mth;
    const mip = num('macroInflationPhiQuarterly', 0, 0.95);
    if (mip !== undefined) update.macroInflationPhiQuarterly = mip;
    const mia = num('macroInflationAnchorPct', 0, 6);
    if (mia !== undefined) update.macroInflationAnchorPct = mia;
    const mmp = num('macroMultiplierPurchases', 0, 3);
    if (mmp !== undefined) update.macroMultiplierPurchases = mmp;
    const mmt = num('macroMultiplierTransfers', 0, 3);
    if (mmt !== undefined) update.macroMultiplierTransfers = mmt;
    const mmx = num('macroMultiplierTax', 0, 3);
    if (mmx !== undefined) update.macroMultiplierTax = mmx;
    const mms = num('macroMultiplierRecessionScale', 1, 3);
    if (mms !== undefined) update.macroMultiplierRecessionScale = mms;
    const msa = num('macroSentimentAdjustSpeed', 0.001, 1);
    if (msa !== undefined) update.macroSentimentAdjustSpeed = msa;

    // Fiscal Consequence Loop — Rule 1: every RuntimeConfig field gets a
    // server handler branch with type check + range clamp, same commit.
    // fiscalConsequenceEnabled is the master kill switch: false (default)
    // means the fiscal->approval phase is a no-op (deploy dark).
    if (typeof body.fiscalConsequenceEnabled === 'boolean') {
      update.fiscalConsequenceEnabled = body.fiscalConsequenceEnabled;
    }
    const fadw = num('fiscalApprovalDebtWeight', 0, 50);
    if (fadw !== undefined) update.fiscalApprovalDebtWeight = fadw;
    const fatw = num('fiscalApprovalTreasuryWeight', 0, 50);
    if (fatw !== undefined) update.fiscalApprovalTreasuryWeight = fatw;
    const fadfw = num('fiscalApprovalDeficitWeight', 0, 50);
    if (fadfw !== undefined) update.fiscalApprovalDeficitWeight = fadfw;
    const fatxw = num('fiscalApprovalTaxWeight', 0, 50);
    if (fatxw !== undefined) update.fiscalApprovalTaxWeight = fatxw;
    const fcpw = prob('fiscalConsequencePartyWeight');
    if (fcpw !== undefined) update.fiscalConsequencePartyWeight = fcpw;
    const famd = num('fiscalApprovalMaxDeltaPerTick', 1, 20);
    if (famd !== undefined) update.fiscalApprovalMaxDeltaPerTick = famd;
    const fadhb = num('fiscalApprovalDebtHealthBand', 0, 5);
    if (fadhb !== undefined) update.fiscalApprovalDebtHealthBand = fadhb;
    const fadcb = num('fiscalApprovalDebtCrisisBand', 0, 10);
    if (fadcb !== undefined) update.fiscalApprovalDebtCrisisBand = fadcb;
    const fadcr = num('fiscalApprovalDeficitCrisisRatio', 0, 2);
    if (fadcr !== undefined) update.fiscalApprovalDeficitCrisisRatio = fadcr;
    if (typeof body.ballotFiscalRecordEnabled === 'boolean') {
      update.ballotFiscalRecordEnabled = body.ballotFiscalRecordEnabled;
    }
    const tes = prob('taxElasticityStrength');
    if (tes !== undefined) update.taxElasticityStrength = tes;
    const tnrp = num('taxNeutralRatePercent', 0, 40);
    if (tnrp !== undefined) update.taxNeutralRatePercent = tnrp;
    const trpp = num('taxRevenuePeakPercent', 20, 60);
    if (trpp !== undefined) update.taxRevenuePeakPercent = trpp;

    // Office-Selection Fidelity — Rule 1: every RuntimeConfig field gets a
    // server handler branch with type check + range clamp, same commit. All
    // three master switches default false (deploy dark): off = byte-identical
    // to today's engine-decided seating.
    if (typeof body.speakerElectionEnabled === 'boolean') {
      update.speakerElectionEnabled = body.speakerElectionEnabled;
    }
    const srbc = posInt('speakerReballotCap', 1, 10);
    if (srbc !== undefined) update.speakerReballotCap = srbc;
    if (typeof body.appointmentConfirmationEnabled === 'boolean') {
      update.appointmentConfirmationEnabled = body.appointmentConfirmationEnabled;
    }
    const act = num('appointmentConfirmationThreshold', 0, 1);
    if (act !== undefined) update.appointmentConfirmationThreshold = act;
    if (typeof body.electoralCollegeEnabled === 'boolean') {
      update.electoralCollegeEnabled = body.electoralCollegeEnabled;
    }

    // Elections Revival (minimal slice) — 0 = disabled (deploy dark default,
    // byte-identical to today's suppress-while-seated behavior).
    const pTermTicks = posInt('presidentTermTicks', 0, 100_000);
    if (pTermTicks !== undefined) update.presidentTermTicks = pTermTicks;

    // Election Cycles — tick-anchored phase windows (Rule 1: type check +
    // range clamp, same commit). congressTermTicks 0 = congressional general
    // elections disabled (deploy dark default).
    const ert = posInt('electionRegistrationTicks', 1, 365);
    if (ert !== undefined) update.electionRegistrationTicks = ert;
    const ecmt = posInt('electionCampaignTicks', 1, 730);
    if (ecmt !== undefined) update.electionCampaignTicks = ecmt;
    const evtt = posInt('electionVotingTicks', 1, 90);
    if (evtt !== undefined) update.electionVotingTicks = evtt;
    const cgtt = posInt('congressTermTicks', 0, 100_000);
    if (cgtt !== undefined) update.congressTermTicks = cgtt;

    /* Capitol City (effect layer) — Rule 1: type check + clamp, same commit.
       cityEnabled is the master switch: false (default) = the city block in
       agentTick is unreachable (deploy dark). */
    if (typeof body.cityEnabled === 'boolean') update.cityEnabled = body.cityEnabled;
    const cmpt = posInt('cityMonthsPerTick', 1, 12);
    if (cmpt !== undefined) update.cityMonthsPerTick = cmpt;

    /* Scoreboard (E4) — Rule 1: every RuntimeConfig field gets a server
       handler branch, same commit. scoreboardEnabled gates ALL
       metric_snapshots writes (sim exporter + reality bridge) — deploy dark;
       the three adapter flags gate their reality sources individually. */
    if (typeof body.scoreboardEnabled === 'boolean') update.scoreboardEnabled = body.scoreboardEnabled;
    if (typeof body.fredAdapterEnabled === 'boolean') update.fredAdapterEnabled = body.fredAdapterEnabled;
    if (typeof body.congressStatsAdapterEnabled === 'boolean') update.congressStatsAdapterEnabled = body.congressStatsAdapterEnabled;
    if (typeof body.approvalScrapeEnabled === 'boolean') update.approvalScrapeEnabled = body.approvalScrapeEnabled;
    const tkct = posInt('tenKReportCadenceTicks', 0, 2000);
    if (tkct !== undefined) update.tenKReportCadenceTicks = tkct;

    /* Campaign Realism — Rule 1: type check + range clamp, same commit as the
       RuntimeConfig fields. campaignFinanceEnabled is the master switch; flip
       between election cycles only (activation runbook), never mid-campaign. */
    if (typeof body.campaignFinanceEnabled === 'boolean') update.campaignFinanceEnabled = body.campaignFinanceEnabled;
    const drp = num('donationRatePct', 0, 2);
    if (drp !== undefined) update.donationRatePct = drp;
    const csrp = num('campaignSpendRatePct', 0, 100);
    if (csrp !== undefined) update.campaignSpendRatePct = csrp;
    if (typeof body.endorsementsEnabled === 'boolean') update.endorsementsEnabled = body.endorsementsEnabled;
    if (typeof body.pollsEnabled === 'boolean') update.pollsEnabled = body.pollsEnabled;
    const cdbc = posInt('campaignDebateCount', 0, 6);
    if (cdbc !== undefined) update.campaignDebateCount = cdbc;
    const dpp = posInt('debateParticipants', 2, 8);
    if (dpp !== undefined) update.debateParticipants = dpp;

    const updated = await updateRuntimeConfig(update);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/economy — live treasury + tax rate from DB */
router.get('/admin/economy', async (_req, res, next) => {
  try {
    const [row] = await db.select().from(governmentSettings).limit(1);
    res.json({ success: true, data: row ?? { treasuryBalance: 0, taxRatePercent: 2 } });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/economy — update treasury balance or tax rate in DB */
router.post('/admin/economy', async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (typeof body.treasuryBalance === 'number' && body.treasuryBalance >= 0) {
      patch.treasuryBalance = Math.round(body.treasuryBalance);
    }
    if (typeof body.taxRatePercent === 'number' && body.taxRatePercent >= 0 && body.taxRatePercent <= 100) {
      patch.taxRatePercent = body.taxRatePercent;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ success: false, error: 'No valid fields provided' });
      return;
    }

    patch.updatedAt = new Date();

    const [existing] = await db.select({ id: governmentSettings.id }).from(governmentSettings).limit(1);
    let row;
    if (existing) {
      [row] = await db.update(governmentSettings).set(patch).where(eq(governmentSettings.id, existing.id)).returning();
    } else {
      [row] = await db.insert(governmentSettings).values({ treasuryBalance: 50000, taxRatePercent: 2, ...patch }).returning();
    }

    res.json({ success: true, data: row });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/agents — list all agents with status */
router.get('/admin/agents', async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: agents.id,
        displayName: agents.displayName,
        alignment: agents.alignment,
        modelProvider: agents.modelProvider,
        isActive: agents.isActive,
        reputation: agents.reputation,
        balance: agents.balance,
      })
      .from(agents)
      .orderBy(agents.displayName);

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/agents/:id/toggle — enable/disable an agent */
router.post('/admin/agents/:id/toggle', async (req, res, next) => {
  try {
    const { id } = req.params;
    const [agent] = await db.select({ isActive: agents.isActive }).from(agents).where(eq(agents.id, id));

    if (!agent) {
      res.status(404).json({ success: false, error: 'Agent not found' });
      return;
    }

    const newActive = !agent.isActive;
    await db.update(agents).set({ isActive: newActive }).where(eq(agents.id, id));
    res.json({ success: true, data: { isActive: newActive } });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/agents/create — create a new agent */
router.post('/admin/agents/create', async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const rc = getRuntimeConfig();

    const displayName = String(body.displayName ?? '').trim();
    const name = String(body.name ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const alignment = String(body.alignment ?? 'moderate');
    const bio = String(body.bio ?? '').trim();
    const personality = String(body.personality ?? '').trim();
    const modelProvider = String(body.modelProvider ?? 'anthropic');
    const model = String(body.model ?? '').trim();
    const startingBalance = typeof body.startingBalance === 'number'
      ? Math.round(body.startingBalance)
      : rc.initialAgentBalance;

    if (!displayName || !name) {
      res.status(400).json({ success: false, error: 'displayName and name are required' });
      return;
    }

    const VALID_ALIGNMENTS = ['progressive', 'moderate', 'conservative', 'libertarian', 'technocrat'];
    const VALID_PROVIDERS_LIST = ['anthropic', 'openai', 'google', 'huggingface', 'ollama'];

    if (!VALID_ALIGNMENTS.includes(alignment)) {
      res.status(400).json({ success: false, error: 'Invalid alignment' });
      return;
    }
    if (!VALID_PROVIDERS_LIST.includes(modelProvider)) {
      res.status(400).json({ success: false, error: 'Invalid modelProvider' });
      return;
    }

    const [newAgent] = await db.insert(agents).values({
      displayName,
      name,
      agoraId: `agora_${name}_${Date.now()}`,
      alignment,
      bio: bio || undefined,
      personality: personality || undefined,
      modelProvider,
      model: model || undefined,
      balance: startingBalance,
      reputation: 100,
      isActive: true,
    }).returning();

    res.json({ success: true, data: newAgent });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/users — list all registered users (owner only — contains PII) */
router.get('/admin/users', requireOwner, async (_req, res, next) => {
  try {
    const rows = await db
      .select({ id: users.id, username: users.username, email: users.email, role: users.role, clerkUserId: users.clerkUserId, createdAt: users.createdAt })
      .from(users)
      .orderBy(users.createdAt);
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/users/:id/role — set a user's role (owner only) */
router.post('/admin/users/:id/role', requireOwner, async (req, res, next) => {
  try {
    const id = String(req.params['id']);
    const body = req.body as Record<string, unknown>;
    const role = String(body.role ?? '');
    if (!['researcher', 'user'].includes(role)) {
      res.status(400).json({ success: false, error: 'role must be "researcher" or "user"' });
      return;
    }
    const [updated] = await db.update(users).set({ role }).where(eq(users.id, id)).returning();
    if (!updated) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/researcher-requests (owner only — contains PII) */
router.get('/admin/researcher-requests', requireOwner, async (req, res, next) => {
  try {
    const statusFilter = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
    const baseQuery = db
      .select({
        id: researcherRequests.id,
        userId: researcherRequests.userId,
        message: researcherRequests.message,
        status: researcherRequests.status,
        createdAt: researcherRequests.createdAt,
        reviewedAt: researcherRequests.reviewedAt,
        reviewedBy: researcherRequests.reviewedBy,
        username: users.username,
        email: users.email,
      })
      .from(researcherRequests)
      .leftJoin(users, eq(researcherRequests.userId, users.id))
      .orderBy(asc(researcherRequests.createdAt));

    const rows = statusFilter
      ? await baseQuery.where(eq(researcherRequests.status, statusFilter))
      : await baseQuery;

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/researcher-requests/:id/approve (owner only) */
router.post('/admin/researcher-requests/:id/approve', requireOwner, async (req, res, next) => {
  try {
    const requestId = String(req.params['id']);
    const [request] = await db
      .select()
      .from(researcherRequests)
      .where(eq(researcherRequests.id, requestId))
      .limit(1);
    if (!request) {
      res.status(404).json({ success: false, error: 'Request not found' });
      return;
    }
    await db.update(researcherRequests).set({
      status: 'approved',
      reviewedAt: new Date(),
      reviewedBy: req.user!.id,
    }).where(eq(researcherRequests.id, requestId));
    await db.update(users).set({ role: 'researcher' }).where(eq(users.id, request.userId));
    res.json({ success: true, data: { approved: true } });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/researcher-requests/:id/reject (owner only) */
router.post('/admin/researcher-requests/:id/reject', requireOwner, async (req, res, next) => {
  try {
    const requestId = String(req.params['id']);
    const [request] = await db
      .select({ id: researcherRequests.id })
      .from(researcherRequests)
      .where(eq(researcherRequests.id, requestId))
      .limit(1);
    if (!request) {
      res.status(404).json({ success: false, error: 'Request not found' });
      return;
    }
    await db.update(researcherRequests).set({
      status: 'rejected',
      reviewedAt: new Date(),
      reviewedBy: req.user!.id,
    }).where(eq(researcherRequests.id, requestId));
    res.json({ success: true, data: { rejected: true } });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/export/counts — row counts for all exportable datasets (owner only) */
router.get('/admin/export/counts', requireOwner, async (_req, res, next) => {
  try {
    const [
      [decisions],
      [approvals],
      [billsCount],
      [billVotesCount],
      [lawsCount],
      [electionsCount],
      [agentsCount],
    ] = await Promise.all([
      db.select({ n: count() }).from(agentDecisions),
      db.select({ n: count() }).from(approvalEvents),
      db.select({ n: count() }).from(bills),
      db.select({ n: count() }).from(billVotes),
      db.select({ n: count() }).from(laws),
      db.select({ n: count() }).from(elections),
      db.select({ n: count() }).from(agents),
    ]);
    res.json({
      success: true,
      data: {
        agentDecisions: decisions.n,
        approvalEvents: approvals.n,
        bills: billsCount.n,
        billVotes: billVotesCount.n,
        laws: lawsCount.n,
        elections: electionsCount.n,
        agents: agentsCount.n,
      },
    });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/export/agent-decisions (owner only) */
router.get('/admin/export/agent-decisions', requireOwner, async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: agentDecisions.id,
        createdAt: agentDecisions.createdAt,
        agentName: agents.displayName,
        provider: agentDecisions.provider,
        phase: agentDecisions.phase,
        parsedAction: agentDecisions.parsedAction,
        parsedReasoning: agentDecisions.parsedReasoning,
        success: agentDecisions.success,
        latencyMs: agentDecisions.latencyMs,
      })
      .from(agentDecisions)
      .leftJoin(agents, eq(agentDecisions.agentId, agents.id))
      .orderBy(desc(agentDecisions.createdAt));

    const csv = toCSV(
      ['id', 'createdAt', 'agentName', 'provider', 'phase', 'parsedAction', 'parsedReasoning', 'success', 'latencyMs'],
      rows.map((r) => [r.id, r.createdAt?.toISOString(), r.agentName, r.provider, r.phase, r.parsedAction, r.parsedReasoning, r.success, r.latencyMs]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="agent-decisions.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/export/approval-events (owner only) */
router.get('/admin/export/approval-events', requireOwner, async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: approvalEvents.id,
        createdAt: approvalEvents.createdAt,
        agentName: agents.displayName,
        eventType: approvalEvents.eventType,
        delta: approvalEvents.delta,
        reason: approvalEvents.reason,
      })
      .from(approvalEvents)
      .leftJoin(agents, eq(approvalEvents.agentId, agents.id))
      .orderBy(desc(approvalEvents.createdAt));

    const csv = toCSV(
      ['id', 'createdAt', 'agentName', 'eventType', 'delta', 'reason'],
      rows.map((r) => [r.id, r.createdAt?.toISOString(), r.agentName, r.eventType, r.delta, r.reason]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="approval-events.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/export/bills (owner only) */
router.get('/admin/export/bills', requireOwner, async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: bills.id,
        introducedAt: bills.introducedAt,
        title: bills.title,
        sponsorName: agents.displayName,
        committee: bills.committee,
        status: bills.status,
        billType: bills.billType,
        lastActionAt: bills.lastActionAt,
      })
      .from(bills)
      .leftJoin(agents, eq(bills.sponsorId, agents.id))
      .orderBy(desc(bills.introducedAt));

    const csv = toCSV(
      ['id', 'introducedAt', 'title', 'sponsorName', 'committee', 'status', 'billType', 'lastActionAt'],
      rows.map((r) => [r.id, r.introducedAt?.toISOString(), r.title, r.sponsorName, r.committee, r.status, r.billType, r.lastActionAt?.toISOString()]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bills.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/export/bill-votes (owner only) */
router.get('/admin/export/bill-votes', requireOwner, async (_req, res, next) => {
  try {
    const voterAgents = alias(agents, 'voter');
    const rows = await db
      .select({
        id: billVotes.id,
        castAt: billVotes.castAt,
        voterName: voterAgents.displayName,
        billTitle: bills.title,
        choice: billVotes.choice,
      })
      .from(billVotes)
      .leftJoin(voterAgents, eq(billVotes.voterId, voterAgents.id))
      .leftJoin(bills, eq(billVotes.billId, bills.id))
      .orderBy(desc(billVotes.castAt));

    const csv = toCSV(
      ['id', 'castAt', 'voterName', 'billTitle', 'choice'],
      rows.map((r) => [r.id, r.castAt?.toISOString(), r.voterName, r.billTitle, r.choice]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bill-votes.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/export/laws (owner only) */
router.get('/admin/export/laws', requireOwner, async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: laws.id,
        enactedDate: laws.enactedDate,
        title: laws.title,
        isActive: laws.isActive,
        billId: laws.billId,
      })
      .from(laws)
      .orderBy(desc(laws.enactedDate));

    const csv = toCSV(
      ['id', 'enactedDate', 'title', 'isActive', 'billId'],
      rows.map((r) => [r.id, r.enactedDate?.toISOString(), r.title, r.isActive, r.billId]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="laws.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/export/elections (owner only) */
router.get('/admin/export/elections', requireOwner, async (_req, res, next) => {
  try {
    const winnerAgents = alias(agents, 'winner');
    const candidateAgents = alias(agents, 'candidate');

    const rows = await db
      .select({
        electionId: elections.id,
        positionType: elections.positionType,
        status: elections.status,
        scheduledDate: elections.scheduledDate,
        votingStartDate: elections.votingStartDate,
        votingEndDate: elections.votingEndDate,
        certifiedDate: elections.certifiedDate,
        winnerName: winnerAgents.displayName,
        totalVotes: elections.totalVotes,
        campaignId: campaigns.id,
        candidateName: candidateAgents.displayName,
        campaignStatus: campaigns.status,
        contributions: campaigns.contributions,
        spent: campaigns.spent,
      })
      .from(elections)
      .leftJoin(winnerAgents, eq(elections.winnerId, winnerAgents.id))
      /* status != 'declined' in the JOIN condition (not a WHERE) — a
         'declined' campaign row (elections revival minimal slice: an
         eligible agent asked "run?" who said no) is a dedup marker, never a
         real candidacy, and must not leak into this export (review round 1,
         Finding 4; same isRealCandidacyStatus predicate as GET
         /elections/:id and GET /agents/:id/profile). Filtering in the JOIN
         rather than a WHERE keeps this a left join in effect: an election
         with only declined rows (or none at all) still appears — its
         campaign columns are just null — instead of a WHERE silently
         dropping the whole election row. */
      .leftJoin(campaigns, and(eq(campaigns.electionId, elections.id), ne(campaigns.status, 'declined')))
      .leftJoin(candidateAgents, eq(campaigns.agentId, candidateAgents.id))
      .orderBy(desc(elections.createdAt));

    const csv = toCSV(
      ['electionId', 'positionType', 'status', 'scheduledDate', 'votingStartDate', 'votingEndDate', 'certifiedDate', 'winnerName', 'totalVotes', 'campaignId', 'candidateName', 'campaignStatus', 'contributions', 'spent'],
      rows.map((r) => [r.electionId, r.positionType, r.status, r.scheduledDate?.toISOString(), r.votingStartDate?.toISOString(), r.votingEndDate?.toISOString(), r.certifiedDate?.toISOString(), r.winnerName, r.totalVotes, r.campaignId, r.candidateName, r.campaignStatus, r.contributions, r.spent]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="elections.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/export/agents (owner only) */
router.get('/admin/export/agents', requireOwner, async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: agents.id,
        displayName: agents.displayName,
        name: agents.name,
        alignment: agents.alignment,
        modelProvider: agents.modelProvider,
        model: agents.model,
        reputation: agents.reputation,
        balance: agents.balance,
        approvalRating: agents.approvalRating,
        isActive: agents.isActive,
        registrationDate: agents.registrationDate,
      })
      .from(agents)
      .orderBy(asc(agents.displayName));

    const csv = toCSV(
      ['id', 'displayName', 'name', 'alignment', 'modelProvider', 'model', 'reputation', 'balance', 'approvalRating', 'isActive', 'registrationDate'],
      rows.map((r) => [r.id, r.displayName, r.name, r.alignment, r.modelProvider, r.model, r.reputation, r.balance, r.approvalRating, r.isActive, r.registrationDate?.toISOString()]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="agents-snapshot.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/god/interventions — paginated AGGE intervention log
router.get('/god/interventions', requireOwner, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    const rows = await db
      .select({
        id: aggeInterventions.id,
        agentId: aggeInterventions.agentId,
        displayName: agents.displayName,
        action: aggeInterventions.action,
        previousMod: aggeInterventions.previousMod,
        newMod: aggeInterventions.newMod,
        reasoning: aggeInterventions.reasoning,
        createdAt: aggeInterventions.createdAt,
      })
      .from(aggeInterventions)
      .innerJoin(agents, eq(aggeInterventions.agentId, agents.id))
      .orderBy(desc(aggeInterventions.createdAt))
      .limit(limit)
      .offset(offset);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/god/mode — returns active personality-mod driver(s). Bob and AGGE
// are independent since AGGE no longer suppresses itself when the Bob key is set.
router.get('/god/mode', requireOwner, (_req, res) => {
  const bobActive = !!process.env.BOB_ORCHESTRATOR_KEY;
  const aggeActive = getRuntimeConfig().aggeEnabled;
  res.json({ bobActive, aggeActive, mode: godMode(bobActive, aggeActive) });
});

// POST /api/admin/god/bob-ping — admin proxy: call observe endpoint with Bob key, return summary
router.post('/god/bob-ping', requireOwner, async (_req, res, next) => {
  try {
    const key = process.env.BOB_ORCHESTRATOR_KEY;
    if (!key) {
      res.status(400).json({ success: false, error: 'BOB_ORCHESTRATOR_KEY not set — Bob mode not active' });
      return;
    }
    const origin = `http://localhost:${process.env.PORT ?? 3001}`;
    const response = await fetch(`${origin}/api/orchestrator/observe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    });
    if (!response.ok) {
      res.status(response.status).json({ success: false, error: `Observe returned ${response.status}` });
      return;
    }
    const data = await response.json() as { data?: { agents?: unknown[]; simulation?: { lastTickDuration?: number | null; errorRate?: number } } };
    const agentCount = data.data?.agents?.length ?? 0;
    const lastTickDuration = data.data?.simulation?.lastTickDuration ?? null;
    const errorRate = data.data?.simulation?.errorRate ?? 0;
    res.json({ success: true, agentCount, lastTickDuration, errorRate });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/god/tick — manually trigger an AGGE personality tick
router.post('/god/tick', requireOwner, async (_req, res, next) => {
  try {
    await triggerManualAggeTick();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/* GET /api/admin/elections/active — list active elections */
router.get('/admin/elections/active', requireOwner, async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: elections.id,
        positionType: elections.positionType,
        status: elections.status,
        scheduledDate: elections.scheduledDate,
        registrationDeadline: elections.registrationDeadline,
        votingStartDate: elections.votingStartDate,
        votingEndDate: elections.votingEndDate,
      })
      .from(elections)
      .where(sql`${elections.status} NOT IN ('certified', 'cancelled')`)
      .orderBy(desc(elections.createdAt));
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

/* Canonical election phase order. 'counting' was previously listed but never
 * implemented — removed to match the organic Phase 14 lifecycle. Terminal
 * state is 'certified' (writes winner + position + certifiedDate via
 * finalizeElection). */
const ELECTION_PHASE_ORDER = ['scheduled', 'registration', 'campaigning', 'voting', 'certified'] as const;

/* POST /api/admin/elections/trigger — trigger a new election */
router.post('/admin/elections/trigger', requireOwner, async (req, res, next) => {
  try {
    const { positionType } = req.body as { positionType?: string };
    /* Value whitelist (Rule 4): only lifecycle-supported types — anything
       else created rows Phase 14 never advances (frozen in registration). */
    if (!positionType || !(ELECTION_LIFECYCLE_TYPES as readonly string[]).includes(positionType)) {
      res.status(400).json({ success: false, error: `positionType must be one of: ${ELECTION_LIFECYCLE_TYPES.join(', ')}` });
      return;
    }
    const rc = getRuntimeConfig();
    const now = new Date();
    /* Tick-anchored schedule (B1) — the tick columns are the authoritative
       gates; the timestamp columns are derived display dates. */
    const tickNumber = await getCurrentTickNumber();
    const sched = electionTickSchedule(tickNumber, rc.electionRegistrationTicks, rc.electionCampaignTicks, rc.electionVotingTicks);
    const registrationDeadline = wallDateForTick(sched.registrationEndsTick, tickNumber, now, rc.tickIntervalMs);
    const votingStartDate = wallDateForTick(sched.votingStartTick, tickNumber, now, rc.tickIntervalMs);
    const votingEndDate = wallDateForTick(sched.votingEndTick, tickNumber, now, rc.tickIntervalMs);
    const [election] = await db.insert(elections).values({
      positionType,
      status: 'registration',
      scheduledDate: now,
      registrationDeadline,
      votingStartDate,
      votingEndDate,
      createdTick: tickNumber,
      registrationEndsTick: sched.registrationEndsTick,
      votingStartTick: sched.votingStartTick,
      votingEndTick: sched.votingEndTick,
    }).returning();
    res.json({ success: true, data: election });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/elections/:id/advance — force-advance election to next phase.
 *
 * scheduled → registration → campaigning → voting → certified.
 *
 * The terminal transition (voting → certified) delegates to finalizeElection(),
 * which tallies campaign contributions, picks a winner, inserts the positions
 * row, updates agent stats, writes activity/approval events, and broadcasts.
 * Without this call the advance button was a string-only state bump and no
 * officeholder was ever seated — the root cause of the 2026-04-10 missing-
 * president bug. */
router.post('/admin/elections/:id/advance', requireOwner, async (req, res, next) => {
  try {
    const id = String(req.params['id']);
    const [election] = await db.select().from(elections).where(eq(elections.id, id)).limit(1);
    if (!election) {
      res.status(404).json({ success: false, error: 'Election not found' });
      return;
    }
    const currentIdx = ELECTION_PHASE_ORDER.indexOf(election.status as typeof ELECTION_PHASE_ORDER[number]);
    if (currentIdx === -1 || currentIdx >= ELECTION_PHASE_ORDER.length - 1) {
      res.status(400).json({ success: false, error: `Cannot advance from status: ${election.status}` });
      return;
    }
    const nextStatus = ELECTION_PHASE_ORDER[currentIdx + 1];
    const now = new Date();

    if (nextStatus === 'voting') {
      /* Fresh voting-window stamps (B1): a force-advanced election must not
         wait on its ORIGINAL votingEndTick (possibly hundreds of ticks out)
         — it gets a full electionVotingTicks window from right now. Wall
         dates re-derived to match, keeping countdowns honest. */
      const rc = getRuntimeConfig();
      const tickNumber = await getCurrentTickNumber();
      const votingEndTick = tickNumber + Math.max(1, Math.floor(rc.electionVotingTicks));
      await db
        .update(elections)
        .set({
          status: nextStatus,
          votingStartDate: now,
          votingStartTick: tickNumber,
          votingEndTick,
          votingEndDate: wallDateForTick(votingEndTick, tickNumber, now, rc.tickIntervalMs),
        })
        .where(eq(elections.id, id));
      res.json({ success: true, data: { id, previousStatus: election.status, newStatus: nextStatus } });
      return;
    }

    if (nextStatus === 'certified') {
      /* Delegate the full finalize pipeline. finalizeElection handles status,
       * winnerId, totalVotes, certifiedDate, positions row, agent updates,
       * approval/relationship cascades, and broadcasts. Out-of-tick caller,
       * so the tick number for certifiedTick/startTick comes from tickClock. */
      const result = await finalizeElection(id, await getCurrentTickNumber());
      if (result.status === 'no_campaigns') {
        res.status(400).json({
          success: false,
          error: 'Election has no campaigns — cannot certify. Register candidates first.',
        });
        return;
      }
      res.json({
        success: true,
        data: {
          id,
          previousStatus: election.status,
          newStatus: 'certified',
          winnerId: result.winnerId ?? null,
          winnerName: result.winnerName ?? null,
          totalVotes: result.totalVotes ?? 0,
          positionId: result.positionId ?? null,
          finalizeStatus: result.status,
        },
      });
      return;
    }

    /* Intermediate transitions (scheduled→registration, registration→campaigning) */
    await db.update(elections).set({ status: nextStatus }).where(eq(elections.id, id));
    res.json({ success: true, data: { id, previousStatus: election.status, newStatus: nextStatus } });
  } catch (error) {
    next(error);
  }
});

export default router;
