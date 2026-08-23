import { useState, useEffect, useCallback, useRef } from 'react';
import { adminApi, agentsApi, providersApi, healthApi, activityApi, legislationApi, governmentApi } from '@core/client/lib/api';
import { formatMoney } from '@core/client/lib/formatMoney';
import { useWebSocket } from '@core/client/lib/useWebSocket';
import { PixelAvatar, proceduralConfig } from '@modules/agents/client/components/PixelAvatar';
import type { AvatarConfig } from '@modules/agents/client/components/PixelAvatar';
import { CollapsibleSection } from '@core/client/components/CollapsibleSection';
import { EmptyState } from '@core/client/components/EmptyState';
import {
  GridIcon, SettingsIcon, CapitolIcon, UsersIcon, ServerIcon, KeyIcon,
  UserIcon, DatabaseIcon, BeakerIcon, StarIcon, SlidersIcon, HeartIcon,
} from '@core/client/components/icons';
import type { IconProps } from '@core/client/components/icons';

type AdminTab = 'overview' | 'simulation' | 'government' | 'agents' | 'providers' | 'access' | 'users' | 'database' | 'experiments' | 'agge' | 'weights' | 'health';

/* Internal inference hosts are configured via the URL field / env var, not
   shipped as presets — keep internal addresses out of the public bundle.
   (Owner-gated internal presets are fetched at runtime; see fetchInferencePresets.) */
const URL_PRESETS = [
  { label: 'Local vLLM', url: 'http://localhost:8000/v1' },
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { label: 'Anthropic', url: 'https://api.anthropic.com/v1' },
  { label: 'OpenAI', url: 'https://api.openai.com/v1' },
] as const;

interface InferencePreset {
  label: string;
  url: string;
  model?: string;
}

interface ResearcherRequest {
  id: string;
  userId: string;
  username: string;
  email: string | null;
  message: string;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
}

interface SimulationStatus {
  isPaused: boolean;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}

interface DecisionStats {
  total: number;
  errors: number;
  haikuCount: number;
  ollamaCount: number;
}

interface Decision {
  id: string;
  agentName: string | null;
  provider: string;
  phase: string | null;
  parsedAction: string | null;
  parsedReasoning: string | null;
  success: boolean;
  latencyMs: number;
  createdAt: string;
}

interface RuntimeConfig {
  /* Simulation */
  tickIntervalMs: number;
  billAdvancementDelayMs: number;
  providerOverride: 'default' | 'anthropic' | 'openai' | 'google' | 'huggingface' | 'ollama';
  /* Agent Behavior */
  billProposalChance: number;
  campaignSpeechChance: number;
  amendmentProposalChance: number;
  /* Government Structure */
  congressSeats: number;
  congressTermDays: number;
  presidentTermDays: number;
  supremeCourtJustices: number;
  quorumPercentage: number;
  billPassagePercentage: number;
  supermajorityPercentage: number;
  /* Elections */
  campaignDurationDays: number;
  votingDurationHours: number;
  minReputationToRun: number;
  minReputationToVote: number;
  /* Economy (runtime) */
  initialAgentBalance: number;
  campaignFilingFee: number;
  partyCreationFee: number;
  salaryPresident: number;
  salaryCabinet: number;
  salaryCongress: number;
  salaryJustice: number;
  payPeriodTicks: number;
  gdpAnnual: number;
  agoraPopulation: number;
  /* Governance Probabilities */
  vetoBaseRate: number;
  vetoRatePerTier: number;
  vetoMaxRate: number;
  committeeTableRateOpposing: number;
  committeeTableRateNeutral: number;
  committeeAmendRate: number;
  judicialChallengeRatePerLaw: number;
  partyWhipFollowRate: number;
  vetoOverrideThreshold: number;
  /* Guard Rails */
  maxPromptLengthChars: number;
  maxOutputLengthTokens: number;
  maxBillsPerAgentPerTick: number;
  maxCampaignSpeechesPerTick: number;
  maxFloorBillsPerTick: number;
  billFloorExpiryTicks: number;
  /* Relationship & Forum */
  relationshipDecayRate: number;
  forumInteractionSentimentBonus: number;
  forumBaseSilenceWeight: number;
  forumDecayHalfLifeTicks: number;
  forumSilencePressureThreshold: number;
  maxForumPostsPerAgentPerTick: number;
  maxForumPostsPerTick: number;
  maxForumRepliesPerTick: number;
  /* Dynamic Weights */
  treasuryCrisisThreshold: number;
  economyProposalMultiplierCrisis: number;
  judicialContestationBonus: number;
  judicialRecencyBonus: number;
  electionPostOutcomeCascade: boolean;
  /* Approval */
  approvalDecayTarget: number;
  approvalInSystemPrompt: boolean;
  /* Simulation Inference */
  simInferenceUrl: string;
  simInferenceModel: string;
  /* AGGE (God Agent) */
  aggeEnabled: boolean;
  aggeTickIntervalMs: number;
  aggeAgentsPerTickMin: number;
  aggeAgentsPerTickMax: number;
  aggeTemperature: number;
  aggeInferenceUrl: string;
  aggeInferenceModel: string;
  aggeEvolutionPressureWeighted: boolean;
  /* Floor Activity & Negotiation */
  lobbyingEnabled: boolean;
  maxLobbyistsPerTick: number;
  lobbyingPositionShiftChance: number;
  floorAmendmentsEnabled: boolean;
  maxAmendmentsPerBillPerTick: number;
  committeeMarkupEnabled: boolean;
  billWithdrawalEnabled: boolean;
  publicStatementsEnabled: boolean;
  proactiveStatementChance: number;
  maxStatementsPerAgentPerTick: number;
  gazetteEnabled: boolean;
  dealParsingEnabled: boolean;
  maxDealsPerTick: number;
  /* Fiscal Policy (Phase 3) */
  fiscalEffectsEnabled: boolean;
  budgetCycleTicks: number;
  fiscalMaxOneTimePctOfTreasury: number;
  fiscalMaxProgramPctOfRevenue: number;
  fiscalRecurringCapPctOfRevenue: number;
  fiscalMaxTaxDeltaPerLaw: number;
  taxRateMinPercent: number;
  taxRateMaxPercent: number;
  maxSunsetTicks: number;
  treasuryHardFloor: number;
  /* Judicial (Phase 4) */
  courtEnabled: boolean;
  courtMaxConcurrentCases: number;
  courtMaxNewCasesPerTick: number;
  courtHearingDelayTicks: number;
  courtDisputeChancePerBrokenDeal: number;
  courtJusticeQuestionsPerHearing: number;
  courtDamagesAmount: number;
  /* Debt Engine (Divergence E1 slice 1) */
  debtEngineEnabled: boolean;
  mandatoryGrowthPctAnnual: number;
  debtInterestRatePct: number;
  treasuryOperatingBufferDollars: number;
  fiscalMaxMandatoryDeltaPct: number;
  debtCrisisRatioPct: number;
  divergenceT0Tick: number;
  divergenceT0Date: string;
  /* World Events Feed (E2 slice 1) */
  worldFeedEnabled: boolean;
  worldFeedPollTicks: number;
  worldFeedUsgsEnabled: boolean;
  worldFeedNwsEnabled: boolean;
  worldFeedFemaEnabled: boolean;
  worldFeedGdeltEnabled: boolean;
  worldEventsInjectionEnabled: boolean;
  worldEventsRecencyHours: number;
  worldEventsMinSeverity: number;
  worldMapRecencyHours: number;
  worldEventsRetentionDays: number;
  /* Macro Engine (E5 world-model Layer 1) */
  macroEngineEnabled: boolean;
  macroStepEveryNTicks: number;
  macroRngSeedInit: number;
  macroRecessionHazardMonthly: number;
  macroRecoveryHazardMonthly: number;
  macroGdpTrendExpansionPct: number;
  macroGdpTrendRecessionPct: number;
  macroGdpPhiQuarterly: number;
  macroGdpShockSigmaPct: number;
  macroOkunCoeff: number;
  macroNaturalUnemploymentPct: number;
  macroUnemploymentFloorPct: number;
  macroPhillipsSlopeNormal: number;
  macroPhillipsSlopeTight: number;
  macroPhillipsTightThresholdPct: number;
  macroInflationPhiQuarterly: number;
  macroInflationAnchorPct: number;
  macroMultiplierPurchases: number;
  macroMultiplierTransfers: number;
  macroMultiplierTax: number;
  macroMultiplierRecessionScale: number;
  macroSentimentAdjustSpeed: number;
  /* Fiscal Consequence Loop */
  fiscalConsequenceEnabled: boolean;
  fiscalApprovalDebtWeight: number;
  fiscalApprovalTreasuryWeight: number;
  fiscalApprovalDeficitWeight: number;
  fiscalApprovalTaxWeight: number;
  fiscalConsequencePartyWeight: number;
  fiscalApprovalMaxDeltaPerTick: number;
  fiscalApprovalDebtHealthBand: number;
  fiscalApprovalDebtCrisisBand: number;
  fiscalApprovalDeficitCrisisRatio: number;
  ballotFiscalRecordEnabled: boolean;
  taxElasticityStrength: number;
  taxNeutralRatePercent: number;
  taxRevenuePeakPercent: number;
  /* Office-Selection Fidelity */
  speakerElectionEnabled: boolean;
  speakerReballotCap: number;
  appointmentConfirmationEnabled: boolean;
  appointmentConfirmationThreshold: number;
  electoralCollegeEnabled: boolean;
  /* Elections Revival (minimal slice) */
  presidentTermTicks: number;
  /* Election Cycles (tick-anchored schedule) */
  electionRegistrationTicks: number;
  electionCampaignTicks: number;
  electionVotingTicks: number;
  congressTermTicks: number;
  /* Capitol City (effect layer) */
  cityEnabled: boolean;
  cityMonthsPerTick: number;
  /* Scoreboard (E4) */
  scoreboardEnabled: boolean;
  fredAdapterEnabled: boolean;
  congressStatsAdapterEnabled: boolean;
  approvalScrapeEnabled: boolean;
  tenKReportCadenceTicks: number;
  /* Campaign Realism */
  campaignFinanceEnabled: boolean;
  donationRatePct: number;
  campaignSpendRatePct: number;
  endorsementsEnabled: boolean;
  pollsEnabled: boolean;
  campaignDebateCount: number;
  debateParticipants: number;
}

interface EconomySettings {
  treasuryBalance: number;
  taxRatePercent: number;
}

/* Phase 3 fiscal status (subset of GET /api/government/budget) */
interface BudgetStatus {
  treasuryBalance: number;
  taxRatePercent: number;
  fiscalEffectsEnabled: boolean;
  budgetCycleTicks: number;
  expectedTickRevenue: number;
  activePrograms: { lawId: string; name: string; perTick: number; ticksUntilLapse: number | null }[];
  nextBudgetSession: { inTicks: number; estMs: number } | null;
  totals: { recurringPerTick: number; capPerTick: number };
}

interface AgentRow {
  id: string;
  displayName: string;
  alignment: string;
  modelProvider: string;
  isActive: boolean;
  reputation: number;
  balance: number;
}

interface AvatarAgentRow {
  id: string;
  name: string;
  displayName: string;
  avatarConfig: string | null;
}

interface ProviderRow {
  providerName: string;
  isConfigured: boolean;
  isActive: boolean;
  maskedKey: string | null;
  ollamaBaseUrl: string | null;
  defaultModel: string | null;
  models: string[];
}

const EXPORT_KEY_MAP: Record<string, string> = {
  'agent-decisions': 'agentDecisions',
  'approval-events': 'approvalEvents',
  'bills': 'bills',
  'bill-votes': 'billVotes',
  'laws': 'laws',
  'elections': 'elections',
  'agents': 'agents',
};

type LogEntry = {
  tag: string;        // e.g. "[PHASE 3]"
  message: string;
  stream: 'simulation' | 'full';
  timestamp: string;  // ISO string
};

const LOG_BUFFER_MAX = 500;

const SIDEBAR_TABS: { id: AdminTab; label: string; Icon: (props: IconProps) => React.ReactElement }[] = [
  { id: 'overview',    label: 'Overview',        Icon: GridIcon },
  { id: 'simulation',  label: 'Simulation',      Icon: SettingsIcon },
  { id: 'government',  label: 'Government',      Icon: CapitolIcon },
  { id: 'agents',      label: 'Agents',          Icon: UsersIcon },
  { id: 'providers',   label: 'Providers',       Icon: ServerIcon },
  { id: 'access',      label: 'Access Requests', Icon: KeyIcon },
  { id: 'users',       label: 'Users',           Icon: UserIcon },
  { id: 'database',    label: 'Database',        Icon: DatabaseIcon },
  { id: 'experiments', label: 'Experiments',     Icon: BeakerIcon },
  { id: 'agge',        label: 'AGGE',            Icon: StarIcon },
  { id: 'weights',     label: 'Weights',         Icon: SlidersIcon },
  { id: 'health',      label: 'Health',          Icon: HeartIcon },
];

function TickStageBar({ phases }: { phases: { key: string; label: string; state: 'idle' | 'active' | 'done' }[]; running: boolean }) {
  // Always show so you can see it waiting between ticks too
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3 space-y-2">
      <p className="text-badge text-text-muted uppercase tracking-widest">Tick in Progress</p>
      <div className="flex gap-1 items-stretch">
        {phases.map((phase, i) => {
          const isDone = phase.state === 'done';
          const isActive = phase.state === 'active';
          return (
            <div key={phase.key} className="flex-1 flex flex-col gap-1 min-w-0">
              <div
                className={`h-2 rounded-sm transition-all duration-500 ${
                  isDone  ? 'bg-gold/80' :
                  isActive ? 'bg-gold/40 animate-pulse' :
                  'bg-white/10'
                }`}
              />
              <span className={`text-[9px] uppercase tracking-wide text-center truncate transition-colors duration-300 ${
                isDone  ? 'text-gold' :
                isActive ? 'text-gold/70' :
                'text-text-muted/40'
              }`}>
                {i + 1}. {phase.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium uppercase tracking-wide ${
        ok ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
      {label}
    </span>
  );
}

function AdminButton({
  onClick,
  disabled,
  variant = 'default',
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'danger' | 'gold';
  children: React.ReactNode;
}) {
  const base = 'px-4 py-2 rounded text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed';
  const variants = {
    default: 'bg-white/10 text-text-primary hover:bg-white/20 border border-border',
    danger: 'bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-800',
    gold: 'bg-gold/20 text-gold hover:bg-gold/30 border border-gold/40',
  };
  return (
    <button className={`${base} ${variants[variant]}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function msToLabel(ms: number): string {
  if (ms < 60_000) return `${ms / 1000}s`;
  if (ms < 3_600_000) return `${ms / 60_000}m`;
  if (ms < 86_400_000) return `${ms / 3_600_000}h`;
  return `${ms / 86_400_000}d`;
}



const ALIGNMENTS = ['progressive', 'moderate', 'conservative', 'libertarian', 'technocrat'];
const AI_PROVIDERS = ['anthropic', 'openai', 'google', 'huggingface', 'ollama'];

function AccessRequestsPanel({
  requests,
  onApprove,
  onReject,
}: {
  requests: ResearcherRequest[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [resolvedExpanded, setResolvedExpanded] = useState(false);
  const pending = requests.filter((r) => r.status === 'pending');
  const resolved = requests.filter((r) => r.status !== 'pending');

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-badge text-text-muted uppercase tracking-widest">Pending ({pending.length})</p>
        <div className="rounded-lg border border-border overflow-hidden">
          {pending.length === 0 ? (
            <p className="p-4 text-text-muted text-sm">No pending requests.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2 text-text-muted font-normal">Name / Email</th>
                  <th className="text-left px-4 py-2 text-text-muted font-normal">Message</th>
                  <th className="text-left px-4 py-2 text-text-muted font-normal">Requested</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((req) => (
                  <tr key={req.id} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-3">
                      <p className="text-text-primary">{req.username}</p>
                      {req.email && <p className="text-text-muted text-xs">{req.email}</p>}
                    </td>
                    <td className="px-4 py-3 text-text-secondary max-w-xs truncate">&quot;{req.message}&quot;</td>
                    <td className="px-4 py-3 text-text-muted whitespace-nowrap">
                      {new Date(req.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => onApprove(req.id)}
                          className="px-3 py-1 bg-green-900/20 border border-green-700/30 text-green-400 text-xs rounded hover:bg-green-900/40 transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => onReject(req.id)}
                          className="px-3 py-1 bg-border/10 border border-border/40 text-text-muted text-xs rounded hover:text-danger hover:border-danger/30 transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <button
          onClick={() => setResolvedExpanded((e) => !e)}
          className="text-badge text-text-muted uppercase tracking-widest hover:text-gold transition-colors"
        >
          {resolvedExpanded ? '\u25BE' : '\u25B8'} Resolved ({resolved.length})
        </button>
        {resolvedExpanded && (
          <div className="rounded-lg border border-border overflow-hidden">
            {resolved.length === 0 ? (
              <p className="p-4 text-text-muted text-sm">No resolved requests.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-2 text-text-muted font-normal">Name</th>
                    <th className="text-left px-4 py-2 text-text-muted font-normal">Message</th>
                    <th className="text-left px-4 py-2 text-text-muted font-normal">Status</th>
                    <th className="text-left px-4 py-2 text-text-muted font-normal">Reviewed</th>
                  </tr>
                </thead>
                <tbody>
                  {resolved.map((req) => (
                    <tr key={req.id} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-3 text-text-primary">{req.username}</td>
                      <td className="px-4 py-3 text-text-secondary max-w-xs truncate">&quot;{req.message}&quot;</td>
                      <td className="px-4 py-3">
                        <span
                          className={`badge border ${
                            req.status === 'approved'
                              ? 'text-green-400 bg-green-900/20 border-green-700/30'
                              : 'text-text-muted bg-border/10 border-border/40'
                          }`}
                        >
                          {req.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {req.reviewedAt ? new Date(req.reviewedAt).toLocaleDateString() : '\u2014'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LogsDrawer({
  entries,
  activeTab,
  onTabChange,
  onClose,
}: {
  entries: LogEntry[];
  activeTab: 'simulation' | 'full';
  onTabChange: (tab: 'simulation' | 'full') => void;
  onClose: () => void;
}) {
  const simRef = useRef<HTMLDivElement>(null);
  const fullRef = useRef<HTMLDivElement>(null);
  const simAutoScroll = useRef(true);
  const fullAutoScroll = useRef(true);

  const simEntries = entries.filter((e) => e.stream === 'simulation');
  const fullEntries = entries;

  useEffect(() => {
    if (simAutoScroll.current && simRef.current) {
      simRef.current.scrollTop = simRef.current.scrollHeight;
    }
  }, [simEntries.length]);

  useEffect(() => {
    if (fullAutoScroll.current && fullRef.current) {
      fullRef.current.scrollTop = fullRef.current.scrollHeight;
    }
  }, [fullEntries.length]);

  function handleScroll(
    ref: React.RefObject<HTMLDivElement>,
    autoRef: React.MutableRefObject<boolean>,
  ) {
    const el = ref.current;
    if (!el) return;
    autoRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
  }

  function exportLogs(format: 'json' | 'csv') {
    const data = activeTab === 'simulation' ? simEntries : fullEntries;
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `agorabench-logs-${activeTab}-${dateStr}`;
    const rows = data.map(({ tag, message, timestamp }) => ({ timestamp, tag, message }));

    if (format === 'json') {
      const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${filename}.json`; a.click();
      URL.revokeObjectURL(url);
    } else {
      const header = 'timestamp,tag,message';
      const lines = rows.map((r) => `${r.timestamp},${r.tag},${r.message.replace(/,/g, ' ')}`);
      const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${filename}.csv`; a.click();
      URL.revokeObjectURL(url);
    }
  }

  const lineClass = (i: number) =>
    i % 2 === 0 ? 'text-text-primary' : 'text-gold';

  const renderPane = (
    paneEntries: LogEntry[],
    label: string,
    ref: React.RefObject<HTMLDivElement>,
    autoRef: React.MutableRefObject<boolean>,
  ) => (
    <div
      ref={ref}
      onScroll={() => handleScroll(ref, autoRef)}
      className="flex-1 overflow-y-auto py-2 min-w-0"
    >
      <div className="px-3 pb-1.5 text-[10px] uppercase tracking-widest text-text-muted/60">
        {label}
      </div>
      {paneEntries.map((entry, i) => (
        <div
          key={i}
          className={`px-3 py-0.5 text-xs font-mono leading-relaxed whitespace-nowrap overflow-hidden text-ellipsis ${lineClass(i)}`}
        >
          <span className="text-[#7a8fa3] text-[10px] mr-2">
            {entry.timestamp.slice(11, 19)}
          </span>
          <span className="mr-1.5 opacity-80">{entry.tag}</span>
          {entry.message}
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex-shrink-0 h-[300px] flex flex-col border-t-2 border-border bg-capitol-deep shadow-[0_-8px_32px_rgba(0,0,0,0.5)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 h-[38px] border-b border-border flex-shrink-0">
        <span className="text-badge text-text-muted uppercase tracking-widest flex-1">
          Logs
        </span>

        <div className="flex gap-1">
          {(['simulation', 'full'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className={`px-2.5 py-0.5 text-badge uppercase tracking-wider rounded border transition-colors ${
                activeTab === tab
                  ? 'bg-gold/10 border-gold/40 text-gold'
                  : 'border-border text-text-muted hover:text-text-primary'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          {(['json', 'csv'] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => exportLogs(fmt)}
              className="px-2.5 py-0.5 text-badge uppercase tracking-wider rounded border border-border text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
            >
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>

        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary transition-colors"
        >
          x
        </button>
      </div>

      {/* Split panes */}
      <div className="flex flex-1 overflow-hidden">
        {renderPane(simEntries, 'Simulation', simRef, simAutoScroll)}
        <div className="w-1 flex-shrink-0 bg-[#1a2330]" />
        {renderPane(fullEntries, 'Full', fullRef, fullAutoScroll)}
      </div>
    </div>
  );
}

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    return (localStorage.getItem('admin_active_tab') as AdminTab) ?? 'overview';
  });
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    return localStorage.getItem('admin_sidebar_open') !== 'false';
  });
  const [researcherRequests, setResearcherRequests] = useState<ResearcherRequest[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  const [simStatus, setSimStatus] = useState<SimulationStatus | null>(null);
  const [decisionStats, setDecisionStats] = useState<DecisionStats | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [simConfig, setSimConfig] = useState<RuntimeConfig | null>(null);
  const [economySettings, setEconomySettings] = useState<EconomySettings | null>(null);
  /* Phase 3: read-only fiscal status strip (reuses GET /api/government/budget) */
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatus | null>(null);
  const [agentList, setAgentList] = useState<AgentRow[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [lastTickStartMs, setLastTickStartMs] = useState<number | null>(null);

  /* Live tick stage tracker */
  type TickStage = 'idle' | 'active' | 'done';
  interface TickPhase { key: string; label: string; state: TickStage }
  const TICK_PHASES: { key: string; label: string; events: string[] }[] = [
    { key: 'voting',      label: 'Voting',      events: ['agent:vote'] },
    { key: 'committee',   label: 'Committee',   events: ['bill:advanced', 'bill:tabled', 'bill:committee_amended'] },
    { key: 'presidential',label: 'Presidential',events: ['bill:presidential_veto', 'bill:passed', 'bill:resolved'] },
    { key: 'legislation', label: 'Legislation', events: ['law:amended'] },
    { key: 'judiciary',   label: 'Judiciary',   events: ['law:struck_down'] },
    { key: 'economy',     label: 'Economy',     events: [] },
    { key: 'elections',   label: 'Elections',   events: ['election:voting_started', 'election:completed'] },
    { key: 'campaign',    label: 'Campaign',    events: ['campaign:speech'] },
    { key: 'forum',       label: 'Forum',       events: ['forum:post', 'forum:reply'] },
  ];
  const [tickPhases, setTickPhases] = useState<TickPhase[]>(
    TICK_PHASES.map((p) => ({ key: p.key, label: p.label, state: 'idle' as TickStage }))
  );
  const [tickRunning, setTickRunning] = useState(false);
  const tickPhaseRef = useRef<TickPhase[]>(tickPhases);
  const [reseedConfirm, setReseedConfirm] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const { subscribe } = useWebSocket();

  const [logsDrawerOpen, setLogsDrawerOpen] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [activeLogTab, setActiveLogTab] = useState<'simulation' | 'full'>('simulation');

  /* Avatar customizer state */
  const [avatarAgents, setAvatarAgents] = useState<AvatarAgentRow[]>([]);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [draftConfigs, setDraftConfigs] = useState<Record<string, AvatarConfig>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<Record<string, string>>({});

  /* Users state */
  const [userList, setUserList] = useState<{ id: string; username: string; email: string | null; role: string; clerkUserId: string | null; createdAt: string }[]>([]);
  const [userRoleSaving, setUserRoleSaving] = useState<string | null>(null);

  /* Provider panel state */
  const [providerKeyInputs, setProviderKeyInputs] = useState<Record<string, string>>({});
  const [providerOllamaInputs, setProviderOllamaInputs] = useState<Record<string, string>>({});
  const [providerModelInputs, setProviderModelInputs] = useState<Record<string, string>>({});
  const [providerTesting, setProviderTesting] = useState<string | null>(null);
  const [providerTestResults, setProviderTestResults] = useState<Record<string, { success: boolean; latencyMs: number; error?: string }>>({});
  const [providerSaving, setProviderSaving] = useState<string | null>(null);

  /* Create agent panel state */
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [agentForm, setAgentForm] = useState({
    displayName: '', name: '', alignment: 'moderate', modelProvider: 'anthropic', model: '', bio: '', personality: '', startingBalance: 1000,
  });
  const [agentFormLoading, setAgentFormLoading] = useState(false);

  /* Experiments / export state */
  const [exportCounts, setExportCounts] = useState<Record<string, number> | null>(null);
  const [exportingDataset, setExportingDataset] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  /* AGGE state */
  const [aggeMode, setAggeMode] = useState<'bob' | 'agge' | 'both' | 'none' | null>(null);
  const [bobChecking, setBobChecking] = useState(false);
  const [aggeInterventions, setAggeInterventions] = useState<Array<{
    id: string;
    agentId: string;
    action: string;
    previousMod: string | null;
    newMod: string | null;
    reasoning: string;
    createdAt: string;
  }>>([]);
  const [aggeTriggering, setAggeTriggering] = useState(false);

  /* Model registry state (split: sim vs agge) */
  const [simModels, setSimModels] = useState<string[]>([]);
  const [simModelsFailed, setSimModelsFailed] = useState(false);
  const [aggeModels, setAggeModels] = useState<string[]>([]);
  const [aggeModelsFailed, setAggeModelsFailed] = useState(false);

  /* Internal presets from the owner-gated endpoint; empty for non-owners/offline */
  const [inferencePresets, setInferencePresets] = useState<InferencePreset[]>([]);
  const allUrlPresets: InferencePreset[] = [...URL_PRESETS, ...inferencePresets];

  /* Active elections state */
  interface ActiveElection {
    id: string;
    positionType: string;
    status: string;
    scheduledDate: string;
    registrationDeadline: string;
    votingStartDate: string | null;
    votingEndDate: string | null;
  }
  const [activeElections, setActiveElections] = useState<ActiveElection[]>([]);
  const [electionTriggerType, setElectionTriggerType] = useState<string>('president');
  const [electionWorking, setElectionWorking] = useState(false);

  /* Health state */
  const [healthTicks, setHealthTicks] = useState<Array<{ id: string; firedAt: string; completedAt: string; durationMs: number | null }>>([]);
  const [healthLatency, setHealthLatency] = useState<{
    avg: number; p50: number; p95: number; p99: number; count: number;
    byProvider: Record<string, { avg: number; count: number }>;
    byPhase: Record<string, { avg: number; count: number }>;
  } | null>(null);
  const [healthErrors, setHealthErrors] = useState<{
    total: number; errors: number; rate: number; hours: number;
    byPhase: Record<string, number>;
  } | null>(null);

  /* Overview: activity feed */
  const [activityFeed, setActivityFeed] = useState<Array<{ id: string; agentName?: string; title: string; createdAt: string }>>([]);

  /* Overview: legislation pipeline counts */
  const [billPipeline, setBillPipeline] = useState<Record<string, number>>({});

  const handleTabChange = (tab: AdminTab) => {
    setActiveTab(tab);
    localStorage.setItem('admin_active_tab', tab);
  };

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem('admin_sidebar_open', String(next));
      return next;
    });
  };

  const handleExport = async (dataset: string, filename: string) => {
    setExportingDataset(dataset);
    setExportError(null);
    try {
      await adminApi.downloadExport(dataset, filename);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExportingDataset(null);
    }
  };

  const fetchResearcherRequests = useCallback(async () => {
    try {
      const r = await adminApi.getResearcherRequests();
      const requests = (r.data as ResearcherRequest[] | undefined) ?? [];
      setResearcherRequests(requests);
      setPendingCount(requests.filter((req) => req.status === 'pending').length);
    } catch (err) { console.error('[ADMIN] fetchResearcherRequests failed:', err); }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await adminApi.status();
      const data = res.data as { simulation: SimulationStatus; decisions: DecisionStats };
      setSimStatus(data.simulation);
      setDecisionStats(data.decisions);
    } catch (err) { console.error('[ADMIN] fetchStatus failed:', err); }
  }, []);

  const fetchDecisions = useCallback(async () => {
    try {
      const res = await adminApi.decisions(1, 50);
      if (res.data && Array.isArray(res.data)) {
        setDecisions(res.data as Decision[]);
      }
    } catch (err) { console.error('[ADMIN] fetchDecisions failed:', err); } finally {
      setLoading(false);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await adminApi.getConfig();
      setSimConfig(res.data as RuntimeConfig);
    } catch (err) { console.error('[ADMIN] fetchConfig failed:', err); }
  }, []);

  /* Internal addresses arrive only via the authenticated admin response, never
     the bundle. Failure-soft: non-owner/offline just keeps the static presets. */
  const fetchInferencePresets = useCallback(async () => {
    try {
      const res = await adminApi.getInferencePresets();
      const presets = (res.data as { presets?: InferencePreset[] } | undefined)?.presets;
      if (Array.isArray(presets)) setInferencePresets(presets);
    } catch { /* failure-soft */ }
  }, []);

  const fetchEconomy = useCallback(async () => {
    try {
      const res = await adminApi.getEconomy();
      setEconomySettings(res.data as EconomySettings);
    } catch (err) { console.error('[ADMIN] fetchEconomy failed:', err); }
  }, []);

  const fetchBudgetStatus = useCallback(async () => {
    try {
      const res = await governmentApi.budget();
      setBudgetStatus(res.data as BudgetStatus);
    } catch (err) { console.error('[ADMIN] fetchBudgetStatus failed:', err); }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await adminApi.getAgents();
      const data = Array.isArray(res) ? res : (res.data ?? []);
      setAgentList(data as AgentRow[]);
    } catch (err) { console.error('[ADMIN] fetchAgents failed:', err); }
  }, []);

  const fetchAvatarAgents = useCallback(async () => {
    try {
      const res = await agentsApi.list(1, 100);
      if (res.data && Array.isArray(res.data)) {
        setAvatarAgents(res.data as AvatarAgentRow[]);
      }
    } catch (err) { console.error('[ADMIN] fetchAvatarAgents failed:', err); }
  }, []);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await providersApi.list();
      setProviders(res.data as ProviderRow[]);
    } catch (err) { console.error('[ADMIN] fetchProviders failed:', err); }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await adminApi.getUsers();
      setUserList(res.data as typeof userList);
    } catch (err) { console.error('[ADMIN] fetchUsers failed:', err); }
  }, []);

  const fetchExportCounts = useCallback(async () => {
    try {
      const res = await adminApi.exportCounts();
      setExportCounts(res.data as Record<string, number>);
    } catch (err) { console.error('[ADMIN] fetchExportCounts failed:', err); }
  }, []);

  const fetchSimModels = useCallback(async (url?: string) => {
    const targetUrl = url ?? simConfig?.simInferenceUrl;
    const query = targetUrl || undefined;
    try {
      const res = await adminApi.getModels(query);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = res as any;
      const data = Array.isArray(r) ? r : (r.data ?? []);
      setSimModels(data as string[]);
      setSimModelsFailed(data.length === 0);
    } catch {
      setSimModels([]);
      setSimModelsFailed(true);
    }
  }, [simConfig?.simInferenceUrl]);

  const fetchAggeModels = useCallback(async (url?: string) => {
    const targetUrl = url ?? simConfig?.aggeInferenceUrl;
    const query = targetUrl || undefined;
    try {
      const res = await adminApi.getModels(query);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = res as any;
      const data = Array.isArray(r) ? r : (r.data ?? []);
      setAggeModels(data as string[]);
      setAggeModelsFailed(data.length === 0);
    } catch {
      setAggeModels([]);
      setAggeModelsFailed(true);
    }
  }, [simConfig?.aggeInferenceUrl]);

  const fetchActiveElections = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await adminApi.getActiveElections() as any;
      const data = Array.isArray(res) ? res : (res.data ?? []);
      setActiveElections(data as ActiveElection[]);
    } catch (err) { console.error('[ADMIN] fetchActiveElections failed:', err); }
  }, []);

  const fetchAggeMode = useCallback(async () => {
    try {
      const res = await adminApi.godMode() as unknown as { bobActive: boolean; aggeActive: boolean; mode: 'bob' | 'agge' | 'both' | 'none' };
      setAggeMode(res.mode);
    } catch (err) { console.error('[ADMIN] fetchAggeMode failed:', err); }
  }, []);

  const fetchAggeInterventions = useCallback(async () => {
    try {
      const res = await adminApi.godInterventions();
      const data = Array.isArray(res) ? res : (res.data ?? []);
      setAggeInterventions(data as typeof aggeInterventions);
    } catch (err) { console.error('[ADMIN] fetchAggeInterventions failed:', err); }
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const [ticksRes, latencyRes, errorsRes] = await Promise.all([
        healthApi.ticks(20),
        healthApi.latency(100),
        healthApi.errors(24),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tr = ticksRes as any;
      const ticksData = Array.isArray(tr) ? tr : (tr.data ?? []);
      setHealthTicks(ticksData as typeof healthTicks);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lr = latencyRes as any;
      if (lr.data) setHealthLatency(lr.data as NonNullable<typeof healthLatency>);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const er = errorsRes as any;
      if (er.data) setHealthErrors(er.data as NonNullable<typeof healthErrors>);
    } catch (err) { console.error('[ADMIN] fetchHealth failed:', err); }
  }, []);

  const fetchActivityFeed = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await activityApi.recent({ limit: 10 }) as any;
      const data = Array.isArray(res) ? res : Array.isArray(res.data) ? res.data : (res.data?.events ?? []);
      setActivityFeed(data as typeof activityFeed);
    } catch (err) { console.error('[ADMIN] fetchActivityFeed failed:', err); }
  }, []);

  const fetchBillPipeline = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await legislationApi.list(1, 500) as any;
      const bills: Array<{ status: string }> = Array.isArray(res) ? res : (res.data ?? []);
      const counts: Record<string, number> = {};
      for (const b of bills) {
        counts[b.status] = (counts[b.status] ?? 0) + 1;
      }
      setBillPipeline(counts);
    } catch (err) { console.error('[ADMIN] fetchBillPipeline failed:', err); }
  }, []);

  useEffect(() => {
    void fetchStatus();
    void fetchDecisions();
    void fetchConfig();
    void fetchInferencePresets();
    void fetchEconomy();
    void fetchBudgetStatus();
    void fetchAgents();
    void fetchAvatarAgents();
    void fetchProviders();
    void fetchUsers();
    void fetchResearcherRequests();
    void fetchExportCounts();
    void fetchAggeInterventions();
    void fetchAggeMode();
    void fetchSimModels();
    void fetchAggeModels();
    void fetchHealth();
    void fetchActivityFeed();
    void fetchBillPipeline();
    void fetchActiveElections();

    /* 1s clock for countdown timer */
    const clockInterval = setInterval(() => setNowMs(Date.now()), 1000);

    /* Auto-refresh activity feed every 30s */
    const activityInterval = setInterval(() => { void fetchActivityFeed(); }, 30_000);

    /* Auto-refresh runtime config every 60s — config was mount-only before,
       so out-of-band changes (direct DB writes, another admin tab/session,
       a server restart after a manual runtime_config edit) never appeared
       without a hard page reload. */
    const configInterval = setInterval(() => { void fetchConfig(); }, 60_000);

    const refetchLight = () => {
      void fetchStatus();
      void fetchDecisions();
    };

    const refetchFull = () => {
      void fetchStatus();
      void fetchDecisions();
      void fetchAgents();
      void fetchEconomy();
      void fetchBudgetStatus();
      void fetchExportCounts();
      void fetchHealth();
    };

    /* Tick stage tracker helpers */
    const advanceStage = (eventKey: string) => {
      const phaseIdx = TICK_PHASES.findIndex((p) => p.events.includes(eventKey));
      if (phaseIdx === -1) return;
      setTickRunning(true);
      setTickPhases((prev) => {
        const next = prev.map((p, i) => {
          if (i < phaseIdx) return p.state === 'done' ? p : { ...p, state: 'done' as TickStage };
          if (i === phaseIdx) return p.state === 'idle' ? { ...p, state: 'active' as TickStage } : p;
          return p;
        });
        tickPhaseRef.current = next;
        return next;
      });
    };

    const advanceToPhaseKey = (phaseKey: string) => {
      const phaseIdx = TICK_PHASES.findIndex((p) => p.key === phaseKey);
      if (phaseIdx === -1) return;
      setTickRunning(true);
      setTickPhases((prev) => {
        const next = prev.map((p, i) => {
          if (i < phaseIdx) return { ...p, state: 'done' as TickStage };
          if (i === phaseIdx) return { ...p, state: 'active' as TickStage };
          return p.state === 'idle' ? p : { ...p, state: 'idle' as TickStage };
        });
        tickPhaseRef.current = next;
        return next;
      });
    };

    const unsubs = [
      subscribe('tick:start', () => {
        setTickRunning(true);
        setLastTickStartMs(Date.now());
        const reset = TICK_PHASES.map((p) => ({ key: p.key, label: p.label, state: 'idle' as TickStage }));
        setTickPhases(reset);
        tickPhaseRef.current = reset;
        void fetchStatus();
      }),
      subscribe('tick:complete', () => {
        setTickPhases((prev) => prev.map((p) => ({ ...p, state: 'done' as TickStage })));
        setTickRunning(false);
        setLastTickStartMs(null);
        setTimeout(() => {
          setTickPhases(TICK_PHASES.map((p) => ({ key: p.key, label: p.label, state: 'idle' as TickStage })));
          setTickRunning(false);
        }, 4000);
        refetchFull();
      }),
      subscribe('agent:vote',               () => advanceStage('agent:vote')),
      subscribe('bill:advanced',            () => advanceStage('bill:advanced')),
      subscribe('bill:tabled',              () => advanceStage('bill:tabled')),
      subscribe('bill:committee_amended',   () => advanceStage('bill:committee_amended')),
      subscribe('bill:passed',              () => advanceStage('bill:passed')),
      subscribe('bill:resolved',            () => advanceStage('bill:resolved')),
      subscribe('bill:presidential_veto',   () => advanceStage('bill:presidential_veto')),
      subscribe('law:amended',              () => advanceStage('law:amended')),
      subscribe('law:struck_down',          () => advanceStage('law:struck_down')),
      subscribe('election:voting_started',  () => advanceStage('election:voting_started')),
      subscribe('election:completed',       () => advanceStage('election:completed')),
      subscribe('campaign:speech',          () => advanceStage('campaign:speech')),
      subscribe('forum:post',               () => advanceStage('forum:post')),
      subscribe('forum:reply',              () => advanceStage('forum:reply')),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subscribe('tick:phase', (data: any) => advanceToPhaseKey((data as { phase: string }).phase)),
      subscribe('bill:proposed', refetchLight),
      subscribe('log:entry', (data: unknown) => {
        const entry = data as LogEntry;
        setLogEntries((prev) => {
          const next = [...prev, entry];
          return next.length > LOG_BUFFER_MAX ? next.slice(next.length - LOG_BUFFER_MAX) : next;
        });
      }),
    ];
    return () => { unsubs.forEach((fn) => fn()); clearInterval(clockInterval); clearInterval(activityInterval); clearInterval(configInterval); };
  }, [fetchStatus, fetchDecisions, fetchConfig, fetchInferencePresets, fetchEconomy, fetchBudgetStatus, fetchAgents, fetchAvatarAgents, fetchProviders, subscribe, fetchUsers, fetchResearcherRequests, fetchExportCounts, fetchActivityFeed, fetchBillPipeline, fetchActiveElections, fetchAggeInterventions, fetchSimModels, fetchAggeModels, fetchHealth]);

  const flash = (msg: string) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(null), 3000);
  };

  const handlePause = async () => {
    await adminApi.pause();
    flash('Simulation paused');
    void fetchStatus();
  };

  const handleResume = async () => {
    await adminApi.resume();
    flash('Simulation resumed');
    void fetchStatus();
  };

  const handleTick = async () => {
    await adminApi.tick();
    flash('Manual tick queued');
  };

  const handleReseed = async () => {
    if (!reseedConfirm) {
      setReseedConfirm(true);
      setTimeout(() => setReseedConfirm(false), 5000);
      return;
    }
    setReseedConfirm(false);
    flash('Reseeding database...');
    await adminApi.reseed();
    flash('Database reseeded');
    void fetchStatus();
    void fetchDecisions();
    void fetchAgents();
  };

  const saveConfig = async (patch: Partial<RuntimeConfig>) => {
    if (!simConfig) return;
    setSavingConfig(true);
    try {
      const res = await adminApi.setConfig(patch as Record<string, unknown>);
      setSimConfig(res.data as RuntimeConfig);
      flash('Settings saved');
    } catch (err) {
      console.error('[ADMIN] saveConfig failed:', err);
      flash('Failed to save settings');
    } finally {
      setSavingConfig(false);
    }
  };

  const saveEconomy = async (patch: { treasuryBalance?: number; taxRatePercent?: number }) => {
    setSavingConfig(true);
    try {
      const res = await adminApi.setEconomy(patch);
      setEconomySettings(res.data as EconomySettings);
      flash('Economy settings saved');
    } catch (err) {
      console.error('[ADMIN] saveEconomy failed:', err);
      flash('Failed to save economy settings');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleToggleAgent = async (id: string) => {
    await adminApi.toggleAgent(id);
    void fetchAgents();
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setAgentFormLoading(true);
    try {
      await adminApi.createAgent(agentForm);
      flash('Agent created successfully');
      setShowCreateAgent(false);
      setAgentForm({ displayName: '', name: '', alignment: 'moderate', modelProvider: 'anthropic', model: '', bio: '', personality: '', startingBalance: 1000 });
      void fetchAgents();
      void fetchAvatarAgents();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setAgentFormLoading(false);
    }
  };

  const handleProviderSave = async (name: string) => {
    setProviderSaving(name);
    try {
      const key = providerKeyInputs[name]?.trim();
      const ollamaBaseUrl = providerOllamaInputs[name]?.trim();
      const defaultModel = providerModelInputs[name]?.trim();
      await providersApi.set(name, {
        key: key || undefined,
        ollamaBaseUrl: ollamaBaseUrl || undefined,
        defaultModel: defaultModel !== undefined ? defaultModel : undefined,
      });
      flash(`${name} provider saved`);
      setProviderKeyInputs((prev) => ({ ...prev, [name]: '' }));
      void fetchProviders();
    } catch (err) {
      console.error('[ADMIN] providerSave failed:', err);
      flash(`Failed to save ${name} provider`);
    } finally {
      setProviderSaving(null);
    }
  };

  const handleProviderTest = async (name: string) => {
    setProviderTesting(name);
    try {
      const res = await providersApi.test(name);
      setProviderTestResults((prev) => ({ ...prev, [name]: res.data as { success: boolean; latencyMs: number; error?: string } }));
    } catch (err) {
      console.error('[ADMIN] providerTest failed:', err);
      setProviderTestResults((prev) => ({ ...prev, [name]: { success: false, latencyMs: 0, error: 'Request failed' } }));
    } finally {
      setProviderTesting(null);
    }
  };

  const handleProviderClear = async (name: string) => {
    try {
      await providersApi.clear(name);
      flash(`${name} key cleared`);
      void fetchProviders();
    } catch (err) {
      console.error('[ADMIN] providerClear failed:', err);
      flash(`Failed to clear ${name} key`);
    }
  };

  const handleApprove = async (id: string) => {
    await adminApi.approveResearcherRequest(id);
    await fetchResearcherRequests();
  };

  const handleReject = async (id: string) => {
    await adminApi.rejectResearcherRequest(id);
    await fetchResearcherRequests();
  };

  const running = simStatus ? !simStatus.isPaused : false;

  /* ---- Avatar customizer helpers ---- */
  function getDraftConfig(agent: AvatarAgentRow): AvatarConfig {
    if (draftConfigs[agent.id]) return draftConfigs[agent.id];
    if (agent.avatarConfig) {
      try {
        return JSON.parse(agent.avatarConfig) as AvatarConfig;
      } catch (err) { console.warn('[ADMIN] Avatar config parse failed:', err); }
    }
    return proceduralConfig(agent.name);
  }

  function updateDraft(agentId: string, patch: Partial<AvatarConfig>) {
    const current = draftConfigs[agentId] ?? getDraftConfig(avatarAgents.find((a) => a.id === agentId)!);
    setDraftConfigs((prev) => ({ ...prev, [agentId]: { ...current, ...patch } }));
  }

  async function handleSaveAvatar(agentId: string) {
    const config = getDraftConfig(avatarAgents.find((a) => a.id === agentId)!);
    setSavingId(agentId);
    try {
      await agentsApi.customize(agentId, JSON.stringify(config));
      setSaveMessage((prev) => ({ ...prev, [agentId]: 'Saved!' }));
      void fetchAvatarAgents();
      setTimeout(() => setSaveMessage((prev) => ({ ...prev, [agentId]: '' })), 2000);
    } catch (err) {
      console.error('[ADMIN] saveAvatar failed:', err);
      setSaveMessage((prev) => ({ ...prev, [agentId]: 'Save failed' }));
      setTimeout(() => setSaveMessage((prev) => ({ ...prev, [agentId]: '' })), 3000);
    } finally {
      setSavingId(null);
    }
  }

  function handleResetAvatar(agent: AvatarAgentRow) {
    const config = proceduralConfig(agent.name);
    setDraftConfigs((prev) => ({ ...prev, [agent.id]: config }));
  }

  const savingBadge = savingConfig ? <span className="text-xs text-text-muted">Saving...</span> : undefined;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-capitol-deep">
      {/* Sidebar */}
      <div
        className={`flex-shrink-0 flex flex-col border-r border-border bg-capitol-deep transition-all duration-200 ${
          sidebarOpen ? 'w-[220px]' : 'w-[56px]'
        }`}
      >
        {/* Toggle button */}
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center h-12 border-b border-border hover:bg-surface/50 transition-colors text-text-muted hover:text-text-primary px-3 gap-2"
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <span className="text-base">{'\u2630'}</span>
          {sidebarOpen && <span className="text-badge text-text-muted uppercase tracking-widest">Admin</span>}
        </button>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-2">
          {SIDEBAR_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const isDisabled = false;
            const TabIcon = tab.Icon;
            return (
              <button
                key={tab.id}
                onClick={() => !isDisabled && handleTabChange(tab.id)}
                disabled={isDisabled}
                title={!sidebarOpen ? tab.label : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'border-l-2 border-gold text-gold bg-gold/5'
                    : isDisabled
                    ? 'border-l-2 border-transparent text-text-muted/40 cursor-not-allowed'
                    : 'border-l-2 border-transparent text-text-secondary hover:text-text-primary hover:bg-surface/50'
                }`}
              >
                <span className="flex-shrink-0"><TabIcon size={16} /></span>
                {sidebarOpen && (
                  <span className="flex-1 text-left truncate">{tab.label}</span>
                )}
                {sidebarOpen && tab.id === 'access' && pendingCount > 0 && (
                  <span className="flex-shrink-0 min-w-[20px] h-5 rounded-full bg-gold text-capitol-deep text-xs font-bold flex items-center justify-center px-1">
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Logs toggle */}
        <div className="border-t border-border">
          <button
            onClick={() => setLogsDrawerOpen((v) => !v)}
            title={sidebarOpen ? undefined : 'Logs'}
            className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
              logsDrawerOpen
                ? 'text-gold bg-gold/5'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            <span className="text-base flex-shrink-0">{'\u{1F4CB}'}</span>
            {sidebarOpen && <span className="flex-1 text-left">Logs</span>}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Action feedback */}
        {actionMsg && (
          <div className="px-4 py-2 rounded bg-gold/10 border border-gold/30 text-gold text-sm mb-6">
            {actionMsg}
          </div>
        )}

        {activeTab === 'overview' && (() => {
          const lastTick = healthTicks[0];
          const lastTickMs = lastTick?.durationMs ?? 0;
          const tickInterval = simConfig?.tickIntervalMs ?? 300_000;
          const cycleStartMs = lastTickStartMs ?? (lastTick?.completedAt ? new Date(lastTick.completedAt).getTime() : null);
          const nextEtaMs = cycleStartMs
            ? Math.max(0, tickInterval - (nowMs - cycleStartMs))
            : tickInterval;
          const activeAgents = agentList.filter(a => a.isActive).length;
          const errorRate = healthErrors?.rate ?? 0;
          const errorColor = errorRate < 1 ? 'text-green-400' : errorRate < 5 ? 'text-yellow-400' : 'text-red-400';

          /* Tick chart data */
          const recentTicks = healthTicks.slice(0, 10);
          const maxDuration = Math.max(...recentTicks.map(t => t.durationMs ?? 0), 1);

          /* Pipeline stages */
          const pipelineStages = [
            { key: 'proposed', label: 'Proposed' },
            { key: 'committee', label: 'Committee' },
            { key: 'floor', label: 'Floor' },
            { key: 'passed', label: 'Passed' },
            { key: 'presidential_review', label: 'Pres. Review' },
            { key: 'law', label: 'Law' },
          ];

          const latestIntervention = aggeInterventions[0];
          const interventionAgent = latestIntervention
            ? agentList.find(a => a.id === latestIntervention.agentId)
            : null;

          return (
            <div className="space-y-6">
              {/* Row 1: Enhanced Status Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="rounded-lg border border-border bg-surface p-4 space-y-1">
                  <p className="text-badge text-text-muted uppercase tracking-widest">Simulation</p>
                  <p className="font-serif text-lg text-stone">{simStatus?.isPaused ? 'Paused' : 'Running'}</p>
                  <p className="text-sm text-text-muted">
                    Last tick: {lastTickMs ? `${lastTickMs}ms` : '--'}
                  </p>
                  <p className="text-xs text-text-muted">
                    Next in ~{Math.round(nextEtaMs / 1000)}s
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-surface p-4 space-y-1">
                  <p className="text-badge text-text-muted uppercase tracking-widest">Agents</p>
                  <p className="font-serif text-lg text-stone">{activeAgents} / {agentList.length}</p>
                  <p className="text-sm text-text-muted">{activeAgents} active</p>
                </div>
                <div className="rounded-lg border border-border bg-surface p-4 space-y-1">
                  <p className="text-badge text-text-muted uppercase tracking-widest">Treasury</p>
                  <p className="font-serif text-lg text-stone">
                    ${(economySettings?.treasuryBalance ?? 0).toLocaleString()}
                  </p>
                  <p className="text-sm text-text-muted">{economySettings?.taxRatePercent ?? 0}% tax rate</p>
                </div>
                <div className="rounded-lg border border-border bg-surface p-4 space-y-2">
                  <p className="text-badge text-text-muted uppercase tracking-widest">Next Tick</p>
                  <p className="font-serif text-3xl text-gold font-mono tabular-nums leading-none">
                    {Math.floor(nextEtaMs / 60000)}:{String(Math.floor((nextEtaMs % 60000) / 1000)).padStart(2, '0')}
                  </p>
                  <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gold/70 rounded-full transition-none"
                      style={{ width: `${Math.round((1 - nextEtaMs / tickInterval) * 100)}%` }}
                    />
                  </div>
                  <p className="text-sm text-text-muted">{(simStatus?.waiting ?? 0) + (simStatus?.active ?? 0)} queued &middot; {simStatus?.failed ?? 0} failed</p>
                </div>
                <div className="rounded-lg border border-border bg-surface p-4 space-y-1">
                  <p className="text-badge text-text-muted uppercase tracking-widest">Error Rate</p>
                  <p className={`font-serif text-lg ${errorColor}`}>
                    {errorRate.toFixed(1)}%
                  </p>
                  <p className="text-sm text-text-muted">{healthErrors?.errors ?? 0} / {healthErrors?.total ?? 0}</p>
                </div>
              </div>

              {/* Tick Stage Tracker */}
              <TickStageBar phases={tickPhases} running={tickRunning} />

              {/* Row 2: Tick Performance */}
              <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
                <p className="text-badge text-text-muted uppercase tracking-widest">Tick Performance (last 10)</p>
                {recentTicks.length === 0 ? (
                  <p className="text-sm text-text-muted">No tick data yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {recentTicks.map((tick) => {
                      const dur = tick.durationMs ?? 0;
                      const pct = Math.min(100, (dur / maxDuration) * 100);
                      const barColor = dur <= tickInterval * 0.5
                        ? 'bg-green-500/60'
                        : dur <= tickInterval
                          ? 'bg-yellow-500/60'
                          : 'bg-red-500/60';
                      return (
                        <div key={tick.id} className="flex items-center gap-3">
                          <span className="text-xs text-text-muted w-16 text-right font-mono shrink-0">
                            {dur}ms
                          </span>
                          <div className="flex-1 h-4 bg-white/5 rounded overflow-hidden">
                            <div
                              className={`h-full rounded ${barColor} transition-all`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Row 3: LLM Latency + AGGE Status */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* LLM Latency Summary */}
                <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
                  <p className="text-badge text-text-muted uppercase tracking-widest">LLM Latency Summary</p>
                  {healthLatency ? (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { label: 'Avg', val: healthLatency.avg },
                          { label: 'P50', val: healthLatency.p50 },
                          { label: 'P95', val: healthLatency.p95 },
                          { label: 'P99', val: healthLatency.p99 },
                        ].map(({ label, val }) => (
                          <span key={label} className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-white/10 text-text-primary border border-border">
                            {label}: <span className="text-gold font-mono">{val >= 1000 ? `${(val / 1000).toFixed(1)}s` : `${Math.round(val)}ms`}</span>
                          </span>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(healthLatency.byProvider).map(([provider, stats]) => (
                          <span key={provider} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-white/5 text-text-muted border border-border/50">
                            {provider}: {Math.round(stats.avg)}ms ({stats.count})
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-text-muted">No latency data yet.</p>
                  )}
                </div>

                {/* AGGE Status */}
                <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-badge text-text-muted uppercase tracking-widest">AGGE Status</p>
                    <span className="text-xs text-text-muted">{aggeInterventions.length} total interventions</span>
                  </div>
                  {latestIntervention ? (
                    <div className="space-y-1.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-text-muted">Agent:</span>
                        <span className="text-text-primary font-medium">{interventionAgent?.displayName ?? latestIntervention.agentId}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-text-muted">Action:</span>
                        <span className="text-gold">{latestIntervention.action}</span>
                      </div>
                      {latestIntervention.newMod && (
                        <div className="flex items-center gap-2">
                          <span className="text-text-muted">New mod:</span>
                          <span className="text-text-primary">{latestIntervention.newMod}</span>
                        </div>
                      )}
                      <p className="text-xs text-text-muted italic">{latestIntervention.reasoning}</p>
                      <p className="text-xs text-text-muted">{new Date(latestIntervention.createdAt).toLocaleString()}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-text-muted">No interventions yet.</p>
                  )}
                </div>
              </div>

              {/* Row 4: Legislation Pipeline + Activity Feed */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Legislation Pipeline */}
                <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
                  <p className="text-badge text-text-muted uppercase tracking-widest">Legislation Pipeline</p>
                  <div className="flex items-center gap-1">
                    {pipelineStages.map((stage, i) => {
                      const count = billPipeline[stage.key] ?? 0;
                      return (
                        <div key={stage.key} className="flex items-center">
                          <div className="flex flex-col items-center">
                            <div className={`w-14 h-14 rounded-lg flex flex-col items-center justify-center border ${
                              count > 0 ? 'bg-gold/10 border-gold/30 text-gold' : 'bg-white/5 border-border text-text-muted'
                            }`}>
                              <span className="text-lg font-semibold leading-none">{count}</span>
                            </div>
                            <span className="text-[10px] text-text-muted mt-1 text-center leading-tight w-14">{stage.label}</span>
                          </div>
                          {i < pipelineStages.length - 1 && (
                            <span className="text-text-muted/40 mx-0.5 text-xs">{'\u2192'}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Live Activity Feed */}
                <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
                  <p className="text-badge text-text-muted uppercase tracking-widest">Live Activity Feed</p>
                  {activityFeed.length === 0 ? (
                    <p className="text-sm text-text-muted">No recent activity.</p>
                  ) : (
                    <div className="space-y-1 max-h-52 overflow-y-auto">
                      {activityFeed.map((evt) => (
                        <div key={evt.id} className="flex items-start gap-2 text-xs py-1 border-b border-border/30 last:border-0">
                          <span className="text-text-muted shrink-0 w-16 font-mono">
                            {new Date(evt.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {evt.agentName && (
                            <span className="text-gold shrink-0">{evt.agentName}</span>
                          )}
                          <span className="text-text-primary truncate">{evt.title}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {activeTab === 'simulation' && (
          <div className="space-y-6">
            {/* Simulation Controls */}
            <CollapsibleSection id="simulation_controls" title="Simulation Controls">
              <div className="flex flex-wrap gap-3">
                <AdminButton onClick={handlePause} disabled={!running} variant="default">
                  Pause
                </AdminButton>
                <AdminButton onClick={handleResume} disabled={running} variant="gold">
                  Resume
                </AdminButton>
                <AdminButton onClick={handleTick} variant="default">
                  Manual Tick
                </AdminButton>
              </div>
              {simStatus && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 pt-2">
                  {[
                    { label: 'Waiting', value: simStatus.waiting },
                    { label: 'Active', value: simStatus.active },
                    { label: 'Completed', value: simStatus.completed },
                    { label: 'Failed', value: simStatus.failed },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-white/5 rounded p-3">
                      <div className="text-xs text-text-muted uppercase tracking-wide">{label}</div>
                      <div className="text-xl font-semibold text-text-primary mt-1">{value}</div>
                    </div>
                  ))}
                  {(() => {
                    const lastTick = healthTicks[0];
                    const tickInterval = simConfig?.tickIntervalMs ?? 300_000;
                    const cycleStart = lastTickStartMs ?? (lastTick?.completedAt ? new Date(lastTick.completedAt).getTime() : null);
                    const eta = cycleStart
                      ? Math.max(0, tickInterval - (nowMs - cycleStart))
                      : tickInterval;
                    return (
                      <div className="bg-white/5 rounded p-3 flex flex-col gap-1.5">
                        <div className="text-xs text-text-muted uppercase tracking-wide">Next Tick</div>
                        <div className="text-3xl font-mono text-gold tabular-nums leading-none">
                          {Math.floor(eta / 60000)}:{String(Math.floor((eta % 60000) / 1000)).padStart(2, '0')}
                        </div>
                        <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gold/70 rounded-full transition-none"
                            style={{ width: `${Math.round((1 - eta / tickInterval) * 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </CollapsibleSection>

            {/* Tick Stage Tracker */}
            <TickStageBar phases={tickPhases} running={tickRunning} />

            {/* Inference Config */}
            {simConfig && (
              <CollapsibleSection id="simulation_inference" title="Inference Config" badge={savingBadge}>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-secondary">Inference URL</label>
                    <select
                      value={allUrlPresets.find((p) => p.url === simConfig.simInferenceUrl)?.url ?? 'custom'}
                      onChange={(e) => {
                        const preset = allUrlPresets.find((p) => p.url === e.target.value);
                        const newUrl = preset ? preset.url : '';
                        const modelPatch = preset?.model ? { simInferenceModel: preset.model } : {};
                        setSimConfig((c) => c ? { ...c, simInferenceUrl: newUrl, ...modelPatch } : c);
                        void saveConfig({ simInferenceUrl: newUrl, ...modelPatch });
                        void fetchSimModels(newUrl || undefined);
                      }}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                    >
                      {allUrlPresets.map((p) => (
                        <option key={p.url} value={p.url} className="bg-surface">{p.label}</option>
                      ))}
                      <option value="custom" className="bg-surface">Custom</option>
                    </select>
                    <input
                      type="text"
                      value={simConfig.simInferenceUrl ?? ''}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, simInferenceUrl: e.target.value } : c)}
                      onBlur={() => { void saveConfig({ simInferenceUrl: simConfig.simInferenceUrl }); void fetchSimModels(simConfig.simInferenceUrl || undefined); }}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-gold/50"
                      placeholder="http://localhost:8000/v1"
                    />
                    <p className="text-xs text-text-muted">Override OPENAI_BASE_URL for simulation agents. Leave empty to use env var.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-secondary">Model Name</label>
                    {simModels.length > 0 && !simModelsFailed ? (
                      <select
                        value={simConfig.simInferenceModel ?? ''}
                        onChange={(e) => {
                          setSimConfig((c) => c ? { ...c, simInferenceModel: e.target.value } : c);
                          void saveConfig({ simInferenceModel: e.target.value });
                        }}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      >
                        <option value="" className="bg-surface">Default (env var)</option>
                        {simModels.map((m) => (
                          <option key={m} value={m} className="bg-surface">{m}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={simConfig.simInferenceModel ?? ''}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, simInferenceModel: e.target.value } : c)}
                        onBlur={() => void saveConfig({ simInferenceModel: simConfig.simInferenceModel })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-gold/50"
                        placeholder="e.g. Qwen/Qwen3-32B-AWQ"
                      />
                    )}
                    <p className="text-xs text-text-muted">Override OPENAI_MODEL for simulation agents. Leave empty to use env var.</p>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Simulation Settings */}
            {simConfig && (
              <CollapsibleSection id="simulation_settings" title="Simulation Settings" badge={savingBadge}>
                {/* Tick interval */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">Tick Interval</label>
                    <span className="text-sm text-gold font-mono">{msToLabel(simConfig.tickIntervalMs)}</span>
                  </div>
                  <div className="flex gap-2">
                    {/* Minutes */}
                    <select
                      value={[5,10,15,20,30,45].includes(Math.round(simConfig.tickIntervalMs/60000)) ? simConfig.tickIntervalMs : ''}
                      onChange={(e) => { if (e.target.value) void saveConfig({ tickIntervalMs: Number(e.target.value) }); }}
                      className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                    >
                      <option value="">Minutes</option>
                      {[5,10,15,20,30,45].map((m) => <option key={m} value={m*60000}>{m}m</option>)}
                    </select>
                    {/* Hours */}
                    <select
                      value={simConfig.tickIntervalMs >= 3600000 && simConfig.tickIntervalMs < 86400000 && simConfig.tickIntervalMs % 3600000 === 0 ? simConfig.tickIntervalMs : ''}
                      onChange={(e) => { if (e.target.value) void saveConfig({ tickIntervalMs: Number(e.target.value) }); }}
                      className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                    >
                      <option value="">Hours</option>
                      {Array.from({length:11},(_,i)=>i+1).map((h) => <option key={h} value={h*3600000}>{h}h</option>)}
                    </select>
                    {/* Days */}
                    <select
                      value={simConfig.tickIntervalMs >= 86400000 && simConfig.tickIntervalMs % 86400000 === 0 ? simConfig.tickIntervalMs : ''}
                      onChange={(e) => { if (e.target.value) void saveConfig({ tickIntervalMs: Number(e.target.value) }); }}
                      className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                    >
                      <option value="">Days</option>
                      {[1,2,3,4,5].map((d) => <option key={d} value={d*86400000}>{d}d</option>)}
                    </select>
                  </div>
                  <p className="text-xs text-text-muted">How often agents vote, propose bills, and campaign.</p>
                </div>

                {/* Bill advancement delay */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">Bill Advancement Delay</label>
                    <span className="text-sm text-gold font-mono">{msToLabel(simConfig.billAdvancementDelayMs)}</span>
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={simConfig.billAdvancementDelayMs < 60000 ? simConfig.billAdvancementDelayMs : ''}
                      onChange={(e) => { if (e.target.value) void saveConfig({ billAdvancementDelayMs: Number(e.target.value) }); }}
                      className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                    >
                      <option value="">Seconds</option>
                      {[10,20,30,45].map((s) => <option key={s} value={s*1000}>{s}s</option>)}
                    </select>
                    <select
                      value={simConfig.billAdvancementDelayMs >= 60000 && simConfig.billAdvancementDelayMs < 3600000 && simConfig.billAdvancementDelayMs % 60000 === 0 ? simConfig.billAdvancementDelayMs : ''}
                      onChange={(e) => { if (e.target.value) void saveConfig({ billAdvancementDelayMs: Number(e.target.value) }); }}
                      className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                    >
                      <option value="">Minutes</option>
                      {[1,2,5,10,15,20,30,45].map((m) => <option key={m} value={m*60000}>{m}m</option>)}
                    </select>
                    <select
                      value={simConfig.billAdvancementDelayMs >= 3600000 && simConfig.billAdvancementDelayMs % 3600000 === 0 ? simConfig.billAdvancementDelayMs : ''}
                      onChange={(e) => { if (e.target.value) void saveConfig({ billAdvancementDelayMs: Number(e.target.value) }); }}
                      className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                    >
                      <option value="">Hours</option>
                      {[1,2,4,6,12,24].map((h) => <option key={h} value={h*3600000}>{h}h</option>)}
                    </select>
                  </div>
                  <p className="text-xs text-text-muted">Time bills wait in proposed/committee before advancing to next stage.</p>
                </div>

                {/* Probability sliders */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Bill Proposal Chance</label>
                      <span className="text-sm text-gold font-mono">{Math.round(simConfig.billProposalChance * 100)}%</span>
                    </div>
                    <input
                      type="range" min={0} max={100}
                      value={Math.round(simConfig.billProposalChance * 100)}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, billProposalChance: parseInt(e.target.value) / 100 } : c)}
                      onMouseUp={() => void saveConfig({ billProposalChance: simConfig.billProposalChance })}
                      onTouchEnd={() => void saveConfig({ billProposalChance: simConfig.billProposalChance })}
                      className="w-full accent-gold"
                    />
                    <p className="text-xs text-text-muted">Per-agent chance to propose a bill each tick.</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Campaign Speech Chance</label>
                      <span className="text-sm text-gold font-mono">{Math.round(simConfig.campaignSpeechChance * 100)}%</span>
                    </div>
                    <input
                      type="range" min={0} max={100}
                      value={Math.round(simConfig.campaignSpeechChance * 100)}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, campaignSpeechChance: parseInt(e.target.value) / 100 } : c)}
                      onMouseUp={() => void saveConfig({ campaignSpeechChance: simConfig.campaignSpeechChance })}
                      onTouchEnd={() => void saveConfig({ campaignSpeechChance: simConfig.campaignSpeechChance })}
                      className="w-full accent-gold"
                    />
                    <p className="text-xs text-text-muted">Per-campaign chance to make a speech each tick.</p>
                  </div>
                </div>

                {/* AI Provider Override */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-text-secondary">AI Provider Override</label>
                  <div className="flex flex-wrap gap-2">
                    {(['default', 'anthropic', 'openai', 'google', 'huggingface', 'ollama'] as const).map((opt) => (
                      <button
                        key={opt}
                        onClick={() => void saveConfig({ providerOverride: opt })}
                        className={`px-3 py-1.5 rounded text-xs font-medium border transition-all capitalize ${
                          simConfig.providerOverride === opt
                            ? 'bg-gold/20 text-gold border-gold/40'
                            : 'bg-white/5 text-text-muted border-border hover:bg-white/10'
                        }`}
                      >
                        {opt === 'default' ? 'Per-agent default' : opt}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-text-muted">
                    Override which AI provider all agents use. Default respects each agent's configured provider.
                  </p>
                </div>

                {/* Amendment Proposal Chance */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">Amendment Proposal Chance</label>
                    <span className="text-sm text-gold font-mono">{Math.round(simConfig.amendmentProposalChance * 100)}%</span>
                  </div>
                  <input
                    type="range" min={0} max={100}
                    value={Math.round(simConfig.amendmentProposalChance * 100)}
                    onChange={(e) => setSimConfig((c) => c ? { ...c, amendmentProposalChance: parseInt(e.target.value) / 100 } : c)}
                    onMouseUp={() => void saveConfig({ amendmentProposalChance: simConfig.amendmentProposalChance })}
                    onTouchEnd={() => void saveConfig({ amendmentProposalChance: simConfig.amendmentProposalChance })}
                    className="w-full accent-gold"
                  />
                  <p className="text-xs text-text-muted">Per-agent chance to propose an amendment to an existing law each tick.</p>
                </div>

                {/* Guard Rails sub-section */}
                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Guard Rails</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Max Prompt Length (chars)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.maxPromptLengthChars.toLocaleString()}</span>
                      </div>
                      <input type="number" min={500} max={32000} step={500}
                        value={simConfig.maxPromptLengthChars}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, maxPromptLengthChars: parseInt(e.target.value) || 4000 } : c)}
                        onBlur={() => void saveConfig({ maxPromptLengthChars: simConfig.maxPromptLengthChars })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Maximum characters sent to AI per request.</p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Max Output Tokens</label>
                        <span className="text-sm text-gold font-mono">{simConfig.maxOutputLengthTokens}</span>
                      </div>
                      <input type="number" min={50} max={4000} step={50}
                        value={simConfig.maxOutputLengthTokens}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, maxOutputLengthTokens: parseInt(e.target.value) || 500 } : c)}
                        onBlur={() => void saveConfig({ maxOutputLengthTokens: simConfig.maxOutputLengthTokens })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Maximum tokens each AI response can use.</p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Max Bills Per Agent Per Tick</label>
                        <span className="text-sm text-gold font-mono">{simConfig.maxBillsPerAgentPerTick}</span>
                      </div>
                      <input type="number" min={1} max={20}
                        value={simConfig.maxBillsPerAgentPerTick}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, maxBillsPerAgentPerTick: parseInt(e.target.value) || 1 } : c)}
                        onBlur={() => void saveConfig({ maxBillsPerAgentPerTick: simConfig.maxBillsPerAgentPerTick })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Maximum bill proposals per agent per tick.</p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Max Campaign Speeches Per Tick</label>
                        <span className="text-sm text-gold font-mono">{simConfig.maxCampaignSpeechesPerTick}</span>
                      </div>
                      <input type="number" min={1} max={20}
                        value={simConfig.maxCampaignSpeechesPerTick}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, maxCampaignSpeechesPerTick: parseInt(e.target.value) || 1 } : c)}
                        onBlur={() => void saveConfig({ maxCampaignSpeechesPerTick: simConfig.maxCampaignSpeechesPerTick })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Maximum campaign speeches per agent per tick.</p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Max Floor Bills Per Tick</label>
                        <span className="text-sm text-gold font-mono">{simConfig.maxFloorBillsPerTick}</span>
                      </div>
                      <input type="number" min={1} max={20}
                        value={simConfig.maxFloorBillsPerTick}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, maxFloorBillsPerTick: parseInt(e.target.value) || 5 } : c)}
                        onBlur={() => void saveConfig({ maxFloorBillsPerTick: simConfig.maxFloorBillsPerTick })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Floor bills processed per tick (oldest first) in whip, lobbying, amendment, and voting phases. Excess bills stay queued.</p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Floor Bill Expiry (ticks)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.billFloorExpiryTicks}</span>
                      </div>
                      <input type="number" min={0} max={1000}
                        value={simConfig.billFloorExpiryTicks}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, billFloorExpiryTicks: parseInt(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ billFloorExpiryTicks: simConfig.billFloorExpiryTicks })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Floor bills idle this many ticks (no vote, whip, lobby, or amendment activity) are swept to &quot;expired&quot; at tick start. 0 disables the sweep.</p>
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Floor Activity & Negotiation */}
            {simConfig && (
              <CollapsibleSection id="floor_activity_negotiation" title="Floor Activity & Negotiation" defaultOpen={false}>

                {/* Lobbying */}
                <div className="space-y-3">
                  <h4 className="text-badge text-text-muted uppercase tracking-wider">Lobbying</h4>

                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">Lobbying Enabled</span>
                    <input type="checkbox"
                      checked={simConfig.lobbyingEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, lobbyingEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ lobbyingEnabled: simConfig.lobbyingEnabled })}
                    />
                  </label>

                  <label className="flex items-center justify-between gap-4">
                    <span className="text-sm text-text-secondary">Max Lobbyists / Tick</span>
                    <input type="number" min={1} max={10} step={1}
                      className="input-sm w-20 text-right"
                      value={simConfig.maxLobbyistsPerTick}
                      onChange={e => setSimConfig(c => c ? ({ ...c, maxLobbyistsPerTick: Number(e.target.value) }) : c)}
                      onBlur={() => void saveConfig({ maxLobbyistsPerTick: simConfig.maxLobbyistsPerTick })}
                    />
                  </label>

                  <label className="flex items-center justify-between gap-4">
                    <span className="text-sm text-text-secondary">Position Shift Chance</span>
                    <input type="number" min={0} max={1} step={0.01}
                      className="input-sm w-24 text-right"
                      value={simConfig.lobbyingPositionShiftChance}
                      onChange={e => setSimConfig(c => c ? ({ ...c, lobbyingPositionShiftChance: Number(e.target.value) }) : c)}
                      onBlur={() => void saveConfig({ lobbyingPositionShiftChance: simConfig.lobbyingPositionShiftChance })}
                    />
                  </label>
                </div>

                {/* Floor Amendments */}
                <div className="space-y-3 pt-4 border-t border-border/40">
                  <h4 className="text-badge text-text-muted uppercase tracking-wider">Floor Amendments</h4>

                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">Floor Amendments Enabled</span>
                    <input type="checkbox"
                      checked={simConfig.floorAmendmentsEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, floorAmendmentsEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ floorAmendmentsEnabled: simConfig.floorAmendmentsEnabled })}
                    />
                  </label>

                  <label className="flex items-center justify-between gap-4">
                    <span className="text-sm text-text-secondary">Max Amendments / Bill / Tick</span>
                    <input type="number" min={1} max={5} step={1}
                      className="input-sm w-20 text-right"
                      value={simConfig.maxAmendmentsPerBillPerTick}
                      onChange={e => setSimConfig(c => c ? ({ ...c, maxAmendmentsPerBillPerTick: Number(e.target.value) }) : c)}
                      onBlur={() => void saveConfig({ maxAmendmentsPerBillPerTick: simConfig.maxAmendmentsPerBillPerTick })}
                    />
                  </label>
                </div>

                {/* Committee Markup */}
                <div className="space-y-3 pt-4 border-t border-border/40">
                  <h4 className="text-badge text-text-muted uppercase tracking-wider">Committee Markup</h4>

                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">Committee Markup Enabled</span>
                    <input type="checkbox"
                      checked={simConfig.committeeMarkupEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, committeeMarkupEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ committeeMarkupEnabled: simConfig.committeeMarkupEnabled })}
                    />
                  </label>
                </div>

                {/* Bill Withdrawal */}
                <div className="space-y-3 pt-4 border-t border-border/40">
                  <h4 className="text-badge text-text-muted uppercase tracking-wider">Bill Withdrawal</h4>

                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">Bill Withdrawal Enabled</span>
                    <input type="checkbox"
                      checked={simConfig.billWithdrawalEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, billWithdrawalEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ billWithdrawalEnabled: simConfig.billWithdrawalEnabled })}
                    />
                  </label>
                </div>

                {/* Public Statements */}
                <div className="space-y-3 pt-4 border-t border-border/40">
                  <h4 className="text-badge text-text-muted uppercase tracking-wider">Public Statements</h4>

                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">Public Statements Enabled</span>
                    <input type="checkbox"
                      checked={simConfig.publicStatementsEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, publicStatementsEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ publicStatementsEnabled: simConfig.publicStatementsEnabled })}
                    />
                  </label>

                  <label className="flex items-center justify-between gap-4">
                    <span className="text-sm text-text-secondary">Proactive Statement Chance</span>
                    <input type="number" min={0} max={0.20} step={0.01}
                      className="input-sm w-24 text-right"
                      value={simConfig.proactiveStatementChance}
                      onChange={e => setSimConfig(c => c ? ({ ...c, proactiveStatementChance: Number(e.target.value) }) : c)}
                      onBlur={() => void saveConfig({ proactiveStatementChance: simConfig.proactiveStatementChance })}
                    />
                  </label>

                  <label className="flex items-center justify-between gap-4">
                    <span className="text-sm text-text-secondary">Max Statements / Agent / Tick</span>
                    <input type="number" min={1} max={3} step={1}
                      className="input-sm w-20 text-right"
                      value={simConfig.maxStatementsPerAgentPerTick}
                      onChange={e => setSimConfig(c => c ? ({ ...c, maxStatementsPerAgentPerTick: Number(e.target.value) }) : c)}
                      onBlur={() => void saveConfig({ maxStatementsPerAgentPerTick: simConfig.maxStatementsPerAgentPerTick })}
                    />
                  </label>
                </div>

                {/* Vote-Pact Deals */}
                <div className="space-y-3 pt-4 border-t border-border/40">
                  <h4 className="text-badge text-text-muted uppercase tracking-wider">Vote-Pact Deals</h4>

                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">Deal Parsing Enabled</span>
                    <input type="checkbox"
                      checked={simConfig.dealParsingEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, dealParsingEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ dealParsingEnabled: simConfig.dealParsingEnabled })}
                    />
                  </label>

                  <label className="flex items-center justify-between gap-4">
                    <span className="text-sm text-text-secondary">Max Deals / Tick</span>
                    <input type="number" min={1} max={10} step={1}
                      className="input-sm w-20 text-right"
                      value={simConfig.maxDealsPerTick}
                      onChange={e => setSimConfig(c => c ? ({ ...c, maxDealsPerTick: Number(e.target.value) }) : c)}
                      onBlur={() => void saveConfig({ maxDealsPerTick: simConfig.maxDealsPerTick })}
                    />
                  </label>
                </div>

                {/* Daily Gazette */}
                <div className="space-y-3 pt-4 border-t border-border/40">
                  <h4 className="text-badge text-text-muted uppercase tracking-wider">Daily Gazette</h4>

                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">Gazette Enabled</span>
                    <input type="checkbox"
                      checked={simConfig.gazetteEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, gazetteEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ gazetteEnabled: simConfig.gazetteEnabled })}
                    />
                  </label>
                </div>

              </CollapsibleSection>
            )}

            {/* Economy */}
            <CollapsibleSection
              id="economy"
              title="Economy"
              subtitle="Treasury & tax rate persist in DB. Fees & salaries apply next tick."
              badge={savingBadge}
            >
              {economySettings && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Treasury Balance ($)</label>
                      <span className="text-sm text-gold font-mono">{formatMoney(economySettings.treasuryBalance, { compact: true })}</span>
                    </div>
                    <input
                      type="number" min={0} step={1_000_000_000}
                      value={economySettings.treasuryBalance}
                      onChange={(e) => setEconomySettings((s) => s ? { ...s, treasuryBalance: parseInt(e.target.value) || 0 } : s)}
                      onBlur={() => void saveEconomy({ treasuryBalance: economySettings.treasuryBalance })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                    />
                    <p className="text-xs text-text-muted">Direct treasury balance -- use to inject or remove funds.</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Tax Rate (%)</label>
                      <span className="text-sm text-gold font-mono">{economySettings.taxRatePercent}%</span>
                    </div>
                    <input type="range" min={0} max={50} step={1}
                      value={economySettings.taxRatePercent}
                      onChange={(e) => setEconomySettings((s) => s ? { ...s, taxRatePercent: parseFloat(e.target.value) } : s)}
                      onMouseUp={() => void saveEconomy({ taxRatePercent: economySettings.taxRatePercent })}
                      onTouchEnd={() => void saveEconomy({ taxRatePercent: economySettings.taxRatePercent })}
                      className="w-full accent-gold" />
                    <p className="text-xs text-text-muted">Percent of each agent's balance collected as tax each tick.</p>
                  </div>
                </div>
              )}

              {simConfig && (
                <>
                  <div className="border-t border-border pt-4">
                    <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Fees</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      {([
                        ['initialAgentBalance', 'Starting Agent Balance', 'Dollars each new agent starts with.'],
                        ['campaignFilingFee', 'Campaign Filing Fee', 'Charged to declare candidacy.'],
                        ['partyCreationFee', 'Party Creation Fee', 'Charged to found a new party.'],
                      ] as [keyof RuntimeConfig, string, string][]).map(([key, label, desc]) => (
                        <div key={key} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-text-secondary">{label}</label>
                            <span className="text-sm text-gold font-mono">{formatMoney(simConfig[key] as number)}</span>
                          </div>
                          <input type="number" min={0} step={500}
                            value={simConfig[key] as number}
                            onChange={(e) => setSimConfig((c) => c ? { ...c, [key]: parseInt(e.target.value) || 0 } : c)}
                            onBlur={() => void saveConfig({ [key]: simConfig[key] })}
                            className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                          />
                          <p className="text-xs text-text-muted">{desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-border pt-4">
                    <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Salaries ($/year)</p>
                    <p className="text-xs text-text-muted mb-3">Paid every {simConfig.payPeriodTicks} days at annual ÷ 26, net of income-tax withholding.</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      {([
                        ['salaryPresident', 'President'],
                        ['salaryCabinet', 'Cabinet'],
                        ['salaryCongress', 'Congress'],
                        ['salaryJustice', 'Justice'],
                      ] as [keyof RuntimeConfig, string][]).map(([key, label]) => (
                        <div key={key} className="space-y-1.5">
                          <label className="text-xs font-medium text-text-secondary">{label}</label>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-text-muted">$</span>
                            <input type="number" min={0} step={1000}
                              value={simConfig[key] as number}
                              onChange={(e) => setSimConfig((c) => c ? { ...c, [key]: parseInt(e.target.value) || 0 } : c)}
                              onBlur={() => void saveConfig({ [key]: simConfig[key] })}
                              className="w-full bg-white/5 border border-border rounded px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-border pt-4">
                    <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Payroll & Economy Scale</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-text-secondary">Pay Period (days)</label>
                          <span className="text-sm text-gold font-mono">{simConfig.payPeriodTicks}</span>
                        </div>
                        <input type="number" min={7} max={28} step={1}
                          value={simConfig.payPeriodTicks}
                          onChange={(e) => setSimConfig((c) => c ? { ...c, payPeriodTicks: parseInt(e.target.value) || 14 } : c)}
                          onBlur={() => void saveConfig({ payPeriodTicks: simConfig.payPeriodTicks })}
                          className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                        />
                        <p className="text-xs text-text-muted">Ticks between paychecks (1 tick = 1 sim day).</p>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-text-secondary">Annual GDP</label>
                          <span className="text-sm text-gold font-mono">{formatMoney(simConfig.gdpAnnual, { compact: true })}</span>
                        </div>
                        <input type="number" min={1_000_000_000_000} step={1_000_000_000_000}
                          value={simConfig.gdpAnnual}
                          onChange={(e) => setSimConfig((c) => c ? { ...c, gdpAnnual: parseInt(e.target.value) || 0 } : c)}
                          onBlur={() => void saveConfig({ gdpAnnual: simConfig.gdpAnnual })}
                          className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                        />
                        <p className="text-xs text-text-muted">Citizen tax base. Daily revenue = GDP × rate ÷ 365.</p>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-text-secondary">Population</label>
                          <span className="text-sm text-gold font-mono">{simConfig.agoraPopulation.toLocaleString()}</span>
                        </div>
                        <input type="number" min={1_000_000} step={1_000_000}
                          value={simConfig.agoraPopulation}
                          onChange={(e) => setSimConfig((c) => c ? { ...c, agoraPopulation: parseInt(e.target.value) || 0 } : c)}
                          onBlur={() => void saveConfig({ agoraPopulation: simConfig.agoraPopulation })}
                          className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                        />
                        <p className="text-xs text-text-muted">Citizen count — display and wiki flavor.</p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CollapsibleSection>

            {/* Fiscal Policy (Phase 3) — money is real */}
            {simConfig && (
              <CollapsibleSection
                id="fiscal_policy"
                title="Fiscal Policy"
                subtitle="Bill fiscal provisions: appropriations, spending programs, revenue laws. Clamps are % of treasury/revenue — they scale with the economy."
                badge={savingBadge}
              >
                <div className="space-y-3">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary font-medium">Fiscal Effects Enabled (kill switch)</span>
                    <input type="checkbox"
                      checked={simConfig.fiscalEffectsEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, fiscalEffectsEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ fiscalEffectsEnabled: simConfig.fiscalEffectsEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">When off, bills still store validated provisions but nothing is applied — no debits, no tax changes, no sunsets, no lapses.</p>
                </div>

                {/* Live fiscal status — read-only, from GET /api/government/budget */}
                {budgetStatus && (
                  <div className="border-t border-border pt-4">
                    <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Budget Cycle Status (live)</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="rounded border border-border/60 bg-white/[0.02] px-4 py-3">
                        <p className="text-badge text-text-muted uppercase tracking-widest mb-1">Recurring Spend vs Cap</p>
                        <p className="text-sm font-mono text-gold">
                          {formatMoney(budgetStatus.totals.recurringPerTick, { compact: true })}
                          <span className="text-text-muted"> / {formatMoney(budgetStatus.totals.capPerTick, { compact: true })} per tick</span>
                        </p>
                        <div className="h-1.5 mt-2 rounded-full bg-border/40 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${budgetStatus.totals.capPerTick > 0 && budgetStatus.totals.recurringPerTick / budgetStatus.totals.capPerTick > 0.8 ? 'bg-red-500/80' : 'bg-gold'}`}
                            style={{ width: `${budgetStatus.totals.capPerTick > 0 ? Math.min(100, Math.round((budgetStatus.totals.recurringPerTick / budgetStatus.totals.capPerTick) * 100)) : 0}%` }}
                          />
                        </div>
                      </div>
                      <div className="rounded border border-border/60 bg-white/[0.02] px-4 py-3">
                        <p className="text-badge text-text-muted uppercase tracking-widest mb-1">Active Programs</p>
                        <p className="text-sm font-mono text-gold">{budgetStatus.activePrograms.length}</p>
                        <p className="text-xs text-text-muted mt-1">
                          {budgetStatus.activePrograms.filter((p) => p.ticksUntilLapse === 0).length} due to lapse at the next session
                        </p>
                      </div>
                      <div className="rounded border border-border/60 bg-white/[0.02] px-4 py-3">
                        <p className="text-badge text-text-muted uppercase tracking-widest mb-1">Next Budget Session</p>
                        <p className="text-sm font-mono text-gold">
                          {budgetStatus.nextBudgetSession
                            ? `${budgetStatus.nextBudgetSession.inTicks} tick${budgetStatus.nextBudgetSession.inTicks !== 1 ? 's' : ''}`
                            : '—'}
                        </p>
                        {budgetStatus.nextBudgetSession && (
                          <p className="text-xs text-text-muted mt-1">
                            ≈ {Math.round(budgetStatus.nextBudgetSession.estMs / 3_600_000 * 10) / 10}h at the current tick interval
                          </p>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-text-muted mt-3">
                      Expected revenue {formatMoney(budgetStatus.expectedTickRevenue, { compact: true })}/day at {budgetStatus.taxRatePercent}% tax.
                      Full dashboard: <a href="/budget" className="text-gold hover:underline">/budget</a>.
                    </p>
                  </div>
                )}

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Budget Cycle &amp; Sunsets</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {([
                      ['budgetCycleTicks', 'Budget Cycle (ticks)', 4, 200, 'Programs older than one cycle lapse unless renewed. 24 ≈ 36h at 90-min ticks.'],
                      ['maxSunsetTicks', 'Max Sunset (ticks)', 10, 1000, 'Longest sunset clause a bill may carry.'],
                    ] as [keyof RuntimeConfig, string, number, number, string][]).map(([key, label, min, max, desc]) => (
                      <div key={key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-text-secondary">{label}</label>
                          <span className="text-sm text-gold font-mono">{simConfig[key] as number}</span>
                        </div>
                        <input type="number" min={min} max={max} step={1}
                          value={simConfig[key] as number}
                          onChange={(e) => setSimConfig((c) => c ? { ...c, [key]: parseInt(e.target.value) || min } : c)}
                          onBlur={() => void saveConfig({ [key]: simConfig[key] })}
                          className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                        />
                        <p className="text-xs text-text-muted">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Spending Clamps</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    {([
                      ['fiscalMaxOneTimePctOfTreasury', 'One-Time Max (% of treasury)', 1, 20, 'Cap on a single one-time appropriation.'],
                      ['fiscalMaxProgramPctOfRevenue', 'Program Max (% of tick revenue)', 1, 50, 'Cap on one program’s per-tick cost.'],
                      ['fiscalRecurringCapPctOfRevenue', 'Aggregate Cap (% of tick revenue)', 10, 100, 'Total recurring spend may never exceed this share of expected revenue.'],
                    ] as [keyof RuntimeConfig, string, number, number, string][]).map(([key, label, min, max, desc]) => (
                      <div key={key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-text-secondary">{label}</label>
                          <span className="text-sm text-gold font-mono">{simConfig[key] as number}%</span>
                        </div>
                        <input type="number" min={min} max={max} step={1}
                          value={simConfig[key] as number}
                          onChange={(e) => setSimConfig((c) => c ? { ...c, [key]: parseInt(e.target.value) || min } : c)}
                          onBlur={() => void saveConfig({ [key]: simConfig[key] })}
                          className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                        />
                        <p className="text-xs text-text-muted">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Tax Rate Bounds &amp; Treasury Floor</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Tax Rate Min (%)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.taxRateMinPercent}%</span>
                      </div>
                      <input type="number" min={0} max={10} step={1}
                        value={simConfig.taxRateMinPercent}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, taxRateMinPercent: parseInt(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ taxRateMinPercent: simConfig.taxRateMinPercent })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Tax Rate Max (%)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.taxRateMaxPercent}%</span>
                      </div>
                      <input type="number" min={5} max={50} step={1}
                        value={simConfig.taxRateMaxPercent}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, taxRateMaxPercent: parseInt(e.target.value) || 5 } : c)}
                        onBlur={() => void saveConfig({ taxRateMaxPercent: simConfig.taxRateMaxPercent })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      {simConfig.taxRateMaxPercent <= simConfig.taxRateMinPercent && (
                        <p className="text-xs text-red-400">Max must be greater than min — the save will be rejected.</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Max Tax Δ / Law (pts)</label>
                        <span className="text-sm text-gold font-mono">±{simConfig.fiscalMaxTaxDeltaPerLaw}</span>
                      </div>
                      <input type="number" min={1} max={5} step={1}
                        value={simConfig.fiscalMaxTaxDeltaPerLaw}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, fiscalMaxTaxDeltaPerLaw: parseInt(e.target.value) || 1 } : c)}
                        onBlur={() => void saveConfig({ fiscalMaxTaxDeltaPerLaw: simConfig.fiscalMaxTaxDeltaPerLaw })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Whole points one revenue law can move the rate.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Treasury Hard Floor ($)</label>
                        <span className="text-sm text-gold font-mono">{formatMoney(simConfig.treasuryHardFloor, { compact: true })}</span>
                      </div>
                      <input type="number" min={-10_000_000_000_000} max={0} step={1_000_000_000}
                        value={simConfig.treasuryHardFloor}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, treasuryHardFloor: parseInt(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ treasuryHardFloor: simConfig.treasuryHardFloor })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Treasury may go negative; program debits suspend below this.</p>
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Governance Probabilities */}
            {simConfig && (
              <CollapsibleSection
                id="governance_probabilities"
                title="Governance Probabilities"
                subtitle="Research-backed baselines. Changes apply on the next tick."
              >
                {/* Presidential Veto */}
                <div className="space-y-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide">Presidential Veto</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    {([
                      ['vetoBaseRate', 'Base Veto Rate', 'Probability of veto when president and sponsor share alignment.'],
                      ['vetoRatePerTier', 'Rate Per Alignment Tier', 'Added probability per step apart on the alignment spectrum.'],
                      ['vetoMaxRate', 'Maximum Veto Rate', 'Hard cap -- probability never exceeds this regardless of alignment gap.'],
                    ] as [keyof RuntimeConfig, string, string][]).map(([key, label, desc]) => (
                      <div key={key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-text-secondary">{label}</label>
                          <span className="text-sm text-gold font-mono">{Math.round((simConfig[key] as number) * 100)}%</span>
                        </div>
                        <input type="range" min={0} max={100}
                          value={Math.round((simConfig[key] as number) * 100)}
                          onChange={(e) => setSimConfig((c) => c ? { ...c, [key]: parseInt(e.target.value) / 100 } : c)}
                          onMouseUp={() => void saveConfig({ [key]: simConfig[key] })}
                          onTouchEnd={() => void saveConfig({ [key]: simConfig[key] })}
                          className="w-full accent-gold" />
                        <p className="text-xs text-text-muted">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Committee */}
                <div className="space-y-4 border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide">Committee Review</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    {([
                      ['committeeTableRateOpposing', 'Table Rate (Opposing Chair)', 'Probability chair tables a bill when politically opposed to sponsor.'],
                      ['committeeTableRateNeutral', 'Table Rate (Neutral Chair)', 'Probability chair tables a bill when aligned with or neutral to sponsor.'],
                      ['committeeAmendRate', 'Amendment Rate', 'If not tabled, probability chair amends the bill text.'],
                    ] as [keyof RuntimeConfig, string, string][]).map(([key, label, desc]) => (
                      <div key={key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-text-secondary">{label}</label>
                          <span className="text-sm text-gold font-mono">{Math.round((simConfig[key] as number) * 100)}%</span>
                        </div>
                        <input type="range" min={0} max={100}
                          value={Math.round((simConfig[key] as number) * 100)}
                          onChange={(e) => setSimConfig((c) => c ? { ...c, [key]: parseInt(e.target.value) / 100 } : c)}
                          onMouseUp={() => void saveConfig({ [key]: simConfig[key] })}
                          onTouchEnd={() => void saveConfig({ [key]: simConfig[key] })}
                          className="w-full accent-gold" />
                        <p className="text-xs text-text-muted">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Judicial + Whip + Override */}
                <div className="space-y-4 border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide">Judicial, Whip &amp; Override</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    {([
                      ['judicialChallengeRatePerLaw', 'Judicial Challenge Rate', 'Per-law probability of a Supreme Court review being triggered each tick.'],
                      ['partyWhipFollowRate', 'Party Whip Follow Rate', 'Probability a member follows their party whip recommendation when voting.'],
                      ['vetoOverrideThreshold', 'Veto Override Threshold', 'Yea fraction required to override a presidential veto (e.g. 0.67 = 2/3).'],
                    ] as [keyof RuntimeConfig, string, string][]).map(([key, label, desc]) => (
                      <div key={key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-text-secondary">{label}</label>
                          <span className="text-sm text-gold font-mono">{Math.round((simConfig[key] as number) * 100)}%</span>
                        </div>
                        <input type="range" min={0} max={100}
                          value={Math.round((simConfig[key] as number) * 100)}
                          onChange={(e) => setSimConfig((c) => c ? { ...c, [key]: parseInt(e.target.value) / 100 } : c)}
                          onMouseUp={() => void saveConfig({ [key]: simConfig[key] })}
                          onTouchEnd={() => void saveConfig({ [key]: simConfig[key] })}
                          className="w-full accent-gold" />
                        <p className="text-xs text-text-muted">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </CollapsibleSection>
            )}
          </div>
        )}

        {activeTab === 'government' && (
          <div className="space-y-6">
            {/* Government Structure */}
            {simConfig && (
              <CollapsibleSection
                id="government_structure"
                title="Government Structure"
                subtitle="Takes effect on next election cycle or term start"
                badge={savingBadge}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {/* Congress Seats */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Congress Seats</label>
                      <span className="text-sm text-gold font-mono">{simConfig.congressSeats}</span>
                    </div>
                    <input type="range" min={1} max={200} value={simConfig.congressSeats}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, congressSeats: parseInt(e.target.value) } : c)}
                      onMouseUp={() => void saveConfig({ congressSeats: simConfig.congressSeats })}
                      onTouchEnd={() => void saveConfig({ congressSeats: simConfig.congressSeats })}
                      className="w-full accent-gold" />
                    <p className="text-xs text-text-muted">Total legislative seats.</p>
                  </div>

                  {/* Supreme Court Justices */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Supreme Court Justices</label>
                      <span className="text-sm text-gold font-mono">{simConfig.supremeCourtJustices}</span>
                    </div>
                    <input type="range" min={1} max={25} value={simConfig.supremeCourtJustices}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, supremeCourtJustices: parseInt(e.target.value) } : c)}
                      onMouseUp={() => void saveConfig({ supremeCourtJustices: simConfig.supremeCourtJustices })}
                      onTouchEnd={() => void saveConfig({ supremeCourtJustices: simConfig.supremeCourtJustices })}
                      className="w-full accent-gold" />
                    <p className="text-xs text-text-muted">Number of justices on the high court.</p>
                  </div>

                  {/* Congress Term Days */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Congress Term Length</label>
                      <span className="text-sm text-gold font-mono">{simConfig.congressTermDays}d</span>
                    </div>
                    <div className="flex gap-2">
                      <select
                        value={[1,2,3,5,7,10,14].includes(simConfig.congressTermDays) ? simConfig.congressTermDays : ''}
                        onChange={(e) => { if (e.target.value) void saveConfig({ congressTermDays: Number(e.target.value) }); }}
                        className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                      >
                        <option value="">Days</option>
                        {[1,2,3,5,7,10,14].map((d) => <option key={d} value={d}>{d}d</option>)}
                      </select>
                      <select
                        value={[30,45,60,90,120,180].includes(simConfig.congressTermDays) ? simConfig.congressTermDays : ''}
                        onChange={(e) => { if (e.target.value) void saveConfig({ congressTermDays: Number(e.target.value) }); }}
                        className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                      >
                        <option value="">Months</option>
                        {[{v:30,l:'1mo'},{v:45,l:'1.5mo'},{v:60,l:'2mo'},{v:90,l:'3mo'},{v:120,l:'4mo'},{v:180,l:'6mo'}].map(({v,l}) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <select
                        value={[365,730].includes(simConfig.congressTermDays) ? simConfig.congressTermDays : ''}
                        onChange={(e) => { if (e.target.value) void saveConfig({ congressTermDays: Number(e.target.value) }); }}
                        className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                      >
                        <option value="">Years</option>
                        {[{v:365,l:'1yr'},{v:730,l:'2yr'}].map(({v,l}) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* President Term Days */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">President Term Length</label>
                      <span className="text-sm text-gold font-mono">{simConfig.presidentTermDays}d</span>
                    </div>
                    <div className="flex gap-2">
                      <select
                        value={[1,2,3,5,7,10,14].includes(simConfig.presidentTermDays) ? simConfig.presidentTermDays : ''}
                        onChange={(e) => { if (e.target.value) void saveConfig({ presidentTermDays: Number(e.target.value) }); }}
                        className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                      >
                        <option value="">Days</option>
                        {[1,2,3,5,7,10,14].map((d) => <option key={d} value={d}>{d}d</option>)}
                      </select>
                      <select
                        value={[30,45,60,90,120,180].includes(simConfig.presidentTermDays) ? simConfig.presidentTermDays : ''}
                        onChange={(e) => { if (e.target.value) void saveConfig({ presidentTermDays: Number(e.target.value) }); }}
                        className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                      >
                        <option value="">Months</option>
                        {[{v:30,l:'1mo'},{v:45,l:'1.5mo'},{v:60,l:'2mo'},{v:90,l:'3mo'},{v:120,l:'4mo'},{v:180,l:'6mo'}].map(({v,l}) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <select
                        value={[365,730].includes(simConfig.presidentTermDays) ? simConfig.presidentTermDays : ''}
                        onChange={(e) => { if (e.target.value) void saveConfig({ presidentTermDays: Number(e.target.value) }); }}
                        className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                      >
                        <option value="">Years</option>
                        {[{v:365,l:'1yr'},{v:730,l:'2yr'}].map(({v,l}) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Vote thresholds */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  {([
                    ['quorumPercentage', 'Quorum Required', 'Minimum participation to hold a floor vote.'],
                    ['billPassagePercentage', 'Bill Passage Threshold', 'Yea votes required to pass a bill.'],
                    ['supermajorityPercentage', 'Supermajority (Veto Override)', 'Yea votes required to override a presidential veto.'],
                  ] as [keyof RuntimeConfig, string, string][]).map(([key, label, desc]) => (
                    <div key={key} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">{label}</label>
                        <span className="text-sm text-gold font-mono">{Math.round((simConfig[key] as number) * 100)}%</span>
                      </div>
                      <input type="range" min={10} max={90} value={Math.round((simConfig[key] as number) * 100)}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, [key]: parseInt(e.target.value) / 100 } : c)}
                        onMouseUp={() => void saveConfig({ [key]: simConfig[key] })}
                        onTouchEnd={() => void saveConfig({ [key]: simConfig[key] })}
                        className="w-full accent-gold" />
                      <p className="text-xs text-text-muted">{desc}</p>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Supreme Court (Phase 4 judicial arc) */}
            {simConfig && (
              <CollapsibleSection
                id="supreme_court"
                title="Supreme Court"
                subtitle="Multi-tick case arc: filing, docketing, oral argument, deliberation, ruling"
                badge={savingBadge}
              >
                <div className="space-y-3">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary font-medium">Court Enabled (kill switch)</span>
                    <input type="checkbox"
                      checked={simConfig.courtEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, courtEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ courtEnabled: simConfig.courtEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">When off, the court phase freezes: no filings, no stage advances, no rulings — existing cases hold their current stage.</p>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Docket &amp; Timing</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {([
                      ['courtMaxConcurrentCases', 'Max Concurrent Cases', 1, 10, 'Active-docket cap. Gates new filings only — cases already filed always proceed.'],
                      ['courtMaxNewCasesPerTick', 'Max New Cases / Tick', 1, 5, 'Total new filings per tick across challenges and disputes.'],
                      ['courtHearingDelayTicks', 'Hearing Delay (ticks)', 1, 4, 'Ticks between docketing and oral argument. Default 2 gives a 5-tick arc.'],
                      ['courtJusticeQuestionsPerHearing', 'Justice Questions / Hearing', 0, 4, 'Questions from the bench at oral argument. Each is one LLM call.'],
                    ] as [keyof RuntimeConfig, string, number, number, string][]).map(([key, label, min, max, desc]) => (
                      <div key={key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-text-secondary">{label}</label>
                          <span className="text-sm text-gold font-mono">{simConfig[key] as number}</span>
                        </div>
                        <input type="number" min={min} max={max} step={1}
                          value={simConfig[key] as number}
                          onChange={(e) => setSimConfig((c) => c ? { ...c, [key]: parseInt(e.target.value) || min } : c)}
                          onBlur={() => void saveConfig({ [key]: simConfig[key] })}
                          className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                        />
                        <p className="text-xs text-text-muted">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Disputes &amp; Damages</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Dispute Chance / Broken Deal</label>
                        <span className="text-sm text-gold font-mono">{Math.round(simConfig.courtDisputeChancePerBrokenDeal * 100)}%</span>
                      </div>
                      <input type="range" min={0} max={100} value={Math.round(simConfig.courtDisputeChancePerBrokenDeal * 100)}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, courtDisputeChancePerBrokenDeal: parseInt(e.target.value) / 100 } : c)}
                        onMouseUp={() => void saveConfig({ courtDisputeChancePerBrokenDeal: simConfig.courtDisputeChancePerBrokenDeal })}
                        onTouchEnd={() => void saveConfig({ courtDisputeChancePerBrokenDeal: simConfig.courtDisputeChancePerBrokenDeal })}
                        className="w-full accent-gold" />
                      <p className="text-xs text-text-muted">Probability a broken vote-pact deal becomes a court case.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Damages Amount ($)</label>
                        <span className="text-sm text-gold font-mono">{formatMoney(simConfig.courtDamagesAmount)}</span>
                      </div>
                      <input type="number" min={0} max={10_000_000} step={1000}
                        value={simConfig.courtDamagesAmount}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, courtDamagesAmount: parseInt(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ courtDamagesAmount: simConfig.courtDamagesAmount })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Transferred loser to winner in dispute rulings, clamped to the loser&apos;s balance.</p>
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* World Events Feed (E2 slice 1) — deployed dark, read-only */}
            {simConfig && (
              <CollapsibleSection
                id="world_events_feed"
                title="World Events Feed"
                subtitle="Exogenous world-events feed (USGS, NWS, OpenFEMA). Read-only and deployed dark — nothing here is injected into the simulation yet. See docs/specs/exogenous-reality-feed.md."
                badge={savingBadge}
              >
                <div className="space-y-3">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary font-medium">World Feed Enabled (master kill switch)</span>
                    <input type="checkbox"
                      checked={simConfig.worldFeedEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, worldFeedEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ worldFeedEnabled: simConfig.worldFeedEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">When off, no adapters poll at all — the tick never touches world_events. The per-source flags below only matter once this is on.</p>
                </div>

                <div className="border-t border-border pt-4">
                  <div className="space-y-2 max-w-xs">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Poll Cadence (ticks)</label>
                      <span className="text-sm text-gold font-mono">{simConfig.worldFeedPollTicks}</span>
                    </div>
                    <input type="number" min={1} max={48} step={1}
                      value={simConfig.worldFeedPollTicks}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, worldFeedPollTicks: parseInt(e.target.value) || 1 } : c)}
                      onBlur={() => void saveConfig({ worldFeedPollTicks: simConfig.worldFeedPollTicks })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                    />
                    <p className="text-xs text-text-muted">How often (in ticks) enabled adapters are polled. 1 = every tick.</p>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Per-Source Enable</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {([
                      ['worldFeedUsgsEnabled', 'USGS Earthquakes', 'Significant earthquakes, past week (magnitude-normalized severity).'],
                      ['worldFeedNwsEnabled', 'NWS Alerts', 'Active National Weather Service CAP alerts (severity from CAP field).'],
                      ['worldFeedFemaEnabled', 'OpenFEMA Disaster Declarations', 'Underlying disaster incidents behind recent FEMA declarations.'],
                      ['worldFeedGdeltEnabled', 'GDELT (reserved, Tier 2)', 'No adapter exists yet — enabling this flag is currently a no-op.'],
                    ] as [keyof RuntimeConfig, string, string][]).map(([key, label, desc]) => (
                      <label key={key} className="flex items-start justify-between gap-3 rounded border border-border/60 p-3">
                        <span>
                          <span className="block text-sm text-text-secondary font-medium">{label}</span>
                          <span className="block text-xs text-text-muted mt-0.5">{desc}</span>
                        </span>
                        <input type="checkbox"
                          checked={simConfig[key] as boolean}
                          onChange={(e) => setSimConfig((c) => c ? ({ ...c, [key]: e.target.checked }) : c)}
                          onBlur={() => void saveConfig({ [key]: simConfig[key] })}
                          className="mt-0.5 shrink-0"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Retention &amp; Map Display</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Retention (days)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.worldEventsRetentionDays}</span>
                      </div>
                      <input type="number" min={0} max={365} step={1}
                        value={simConfig.worldEventsRetentionDays}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, worldEventsRetentionDays: parseInt(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ worldEventsRetentionDays: simConfig.worldEventsRetentionDays })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Rows fetched more than this many days ago are hard-deleted each poll. 0 = never delete; 1–6 clamps up to 7.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Map Window (hours)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.worldMapRecencyHours}</span>
                      </div>
                      <input type="number" min={1} max={720} step={1}
                        value={simConfig.worldMapRecencyHours}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, worldMapRecencyHours: parseInt(e.target.value) || 1 } : c)}
                        onBlur={() => void saveConfig({ worldMapRecencyHours: simConfig.worldMapRecencyHours })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">The /world choropleth and hotspot rail only aggregate events inside this window. Display-only — independent of the agent-prompt recency window below.</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Prompt Injection (E2 slice 2)</p>
                  <div className="space-y-3">
                    <label className="flex items-center justify-between">
                      <span className="text-sm text-text-secondary font-medium">Inject Into Agent Prompts (channel gate)</span>
                      <input type="checkbox"
                        checked={simConfig.worldEventsInjectionEnabled}
                        onChange={e => setSimConfig(c => c ? ({ ...c, worldEventsInjectionEnabled: e.target.checked }) : c)}
                        onBlur={() => void saveConfig({ worldEventsInjectionEnabled: simConfig.worldEventsInjectionEnabled })}
                      />
                    </label>
                    <p className="text-xs text-text-muted">When off, no world event ever reaches an agent — prompts are byte-identical to today. Independent of the master feed switch above: you can collect events (poll) without injecting them. Flipping this on is the deliberate, dated go-live for the injection channel.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Recency Window (hours)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.worldEventsRecencyHours}</span>
                      </div>
                      <input type="number" min={1} max={168} step={1}
                        value={simConfig.worldEventsRecencyHours}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, worldEventsRecencyHours: parseInt(e.target.value) || 1 } : c)}
                        onBlur={() => void saveConfig({ worldEventsRecencyHours: simConfig.worldEventsRecencyHours })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Only events within this many hours are eligible. 72h ≈ how long a disaster stays current news.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Min Severity (0–1)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.worldEventsMinSeverity}</span>
                      </div>
                      <input type="number" min={0} max={1} step={0.05}
                        value={simConfig.worldEventsMinSeverity}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, worldEventsMinSeverity: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ worldEventsMinSeverity: simConfig.worldEventsMinSeverity })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Severity floor. 0.35 = advisory tier; 0.55 = warning; 0.75 = severe-only. Below the floor, an event is noise a national legislature would not register.</p>
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Macro Engine (E5 world-model Layer 1) — deployed dark */}
            {simConfig && (
              <CollapsibleSection
                id="macro_engine"
                title="Macro Engine"
                subtitle="E5 world-model Layer 1 — regime/GDP/unemployment/inflation/sentiment. Observe-only: writes world_state, reads nothing into prompts or money. Deployed dark."
                badge={savingBadge}
              >
                <div className="space-y-3">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary font-medium">Macro Engine Enabled (master switch)</span>
                    <input type="checkbox"
                      checked={simConfig.macroEngineEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, macroEngineEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ macroEngineEnabled: simConfig.macroEngineEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">When off, the engine is fully dormant — no stepping, no world_state writes.</p>
                </div>

                <div className="border-t border-border pt-4">
                  <div className="space-y-2 max-w-xs">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Step Cadence (ticks)</label>
                      <span className="text-sm text-gold font-mono">{simConfig.macroStepEveryNTicks}</span>
                    </div>
                    <input type="number" min={1} max={96} step={1}
                      value={simConfig.macroStepEveryNTicks}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, macroStepEveryNTicks: parseInt(e.target.value) || 1 } : c)}
                      onBlur={() => void saveConfig({ macroStepEveryNTicks: simConfig.macroStepEveryNTicks })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                    />
                    <p className="text-xs text-text-muted">How often (in ticks) the engine steps. 16 = daily at 90-min ticks.</p>
                  </div>
                  <div className="space-y-2 max-w-xs mt-4">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">RNG Seed (init)</label>
                      <span className="text-sm text-gold font-mono">{simConfig.macroRngSeedInit}</span>
                    </div>
                    <input type="number" min={1} max={2_147_483_646} step={1}
                      value={simConfig.macroRngSeedInit}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, macroRngSeedInit: parseInt(e.target.value) || 1 } : c)}
                      onBlur={() => void saveConfig({ macroRngSeedInit: simConfig.macroRngSeedInit })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                    />
                    <p className="text-xs text-text-muted">First seed of the deterministic PRNG chain. Changing this starts a new universe.</p>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Regime Hazards</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Recession Hazard (monthly)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroRecessionHazardMonthly}</span>
                      </div>
                      <input type="number" min={0} max={1} step={0.01}
                        value={simConfig.macroRecessionHazardMonthly}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroRecessionHazardMonthly: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroRecessionHazardMonthly: simConfig.macroRecessionHazardMonthly })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">P(expansion→recession) per month. NBER postwar average 0.0156.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Recovery Hazard (monthly)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroRecoveryHazardMonthly}</span>
                      </div>
                      <input type="number" min={0} max={1} step={0.01}
                        value={simConfig.macroRecoveryHazardMonthly}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroRecoveryHazardMonthly: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroRecoveryHazardMonthly: simConfig.macroRecoveryHazardMonthly })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">P(recession→expansion) per month. NBER postwar average 0.0971.</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">GDP Growth</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Trend Growth, Expansion (%/yr)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroGdpTrendExpansionPct}</span>
                      </div>
                      <input type="number" min={0} max={8} step={0.01}
                        value={simConfig.macroGdpTrendExpansionPct}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroGdpTrendExpansionPct: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroGdpTrendExpansionPct: simConfig.macroGdpTrendExpansionPct })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Trend growth g* while in expansion.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Trend Growth, Recession (%/yr)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroGdpTrendRecessionPct}</span>
                      </div>
                      <input type="number" min={-10} max={0} step={0.01}
                        value={simConfig.macroGdpTrendRecessionPct}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroGdpTrendRecessionPct: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroGdpTrendRecessionPct: simConfig.macroGdpTrendRecessionPct })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Trend growth g* while in recession (negative).</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Growth AR(1) Persistence (quarterly)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroGdpPhiQuarterly}</span>
                      </div>
                      <input type="number" min={0} max={0.95} step={0.01}
                        value={simConfig.macroGdpPhiQuarterly}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroGdpPhiQuarterly: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroGdpPhiQuarterly: simConfig.macroGdpPhiQuarterly })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">AR(1) persistence of growth, quarterly.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Growth Shock Sigma (annualized pp)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroGdpShockSigmaPct}</span>
                      </div>
                      <input type="number" min={0} max={2} step={0.01}
                        value={simConfig.macroGdpShockSigmaPct}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroGdpShockSigmaPct: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroGdpShockSigmaPct: simConfig.macroGdpShockSigmaPct })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Standard deviation of daily growth innovation, annualized pp.</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Unemployment (Okun / NAIRU)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Okun Coefficient</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroOkunCoeff}</span>
                      </div>
                      <input type="number" min={0} max={1.5} step={0.01}
                        value={simConfig.macroOkunCoeff}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroOkunCoeff: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroOkunCoeff: simConfig.macroOkunCoeff })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">du = -okun × (g - g*) / 365. Consensus value 0.45.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Natural Unemployment (%)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroNaturalUnemploymentPct}</span>
                      </div>
                      <input type="number" min={2} max={8} step={0.01}
                        value={simConfig.macroNaturalUnemploymentPct}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroNaturalUnemploymentPct: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroNaturalUnemploymentPct: simConfig.macroNaturalUnemploymentPct })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">u* — CBO NAIRU-style anchor.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Unemployment Floor (%)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroUnemploymentFloorPct}</span>
                      </div>
                      <input type="number" min={0.5} max={4} step={0.01}
                        value={simConfig.macroUnemploymentFloorPct}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroUnemploymentFloorPct: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroUnemploymentFloorPct: simConfig.macroUnemploymentFloorPct })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Hard floor on u — unemployment can never drop below this.</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Phillips Curve</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Phillips Slope, Normal (per quarter)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroPhillipsSlopeNormal}</span>
                      </div>
                      <input type="number" min={0} max={1} step={0.01}
                        value={simConfig.macroPhillipsSlopeNormal}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroPhillipsSlopeNormal: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroPhillipsSlopeNormal: simConfig.macroPhillipsSlopeNormal })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Inflation response to (u* - u) in a normal labor market.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Phillips Slope, Tight (per quarter)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroPhillipsSlopeTight}</span>
                      </div>
                      <input type="number" min={0} max={3} step={0.01}
                        value={simConfig.macroPhillipsSlopeTight}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroPhillipsSlopeTight: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroPhillipsSlopeTight: simConfig.macroPhillipsSlopeTight })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Steepened slope once the labor market is tight.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Tight-Market Threshold (%)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroPhillipsTightThresholdPct}</span>
                      </div>
                      <input type="number" min={2} max={6} step={0.01}
                        value={simConfig.macroPhillipsTightThresholdPct}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroPhillipsTightThresholdPct: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroPhillipsTightThresholdPct: simConfig.macroPhillipsTightThresholdPct })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Unemployment below this counts as a tight labor market.</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Inflation</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Inflation AR(1) Persistence (quarterly)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroInflationPhiQuarterly}</span>
                      </div>
                      <input type="number" min={0} max={0.95} step={0.01}
                        value={simConfig.macroInflationPhiQuarterly}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroInflationPhiQuarterly: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroInflationPhiQuarterly: simConfig.macroInflationPhiQuarterly })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">AR(1) persistence of inflation toward its anchor, quarterly.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Inflation Anchor (%)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroInflationAnchorPct}</span>
                      </div>
                      <input type="number" min={0} max={6} step={0.01}
                        value={simConfig.macroInflationAnchorPct}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroInflationAnchorPct: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroInflationAnchorPct: simConfig.macroInflationAnchorPct })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Long-run expectations anchor. Fed target is 2.0.</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Fiscal Multipliers</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Multiplier, Purchases</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroMultiplierPurchases}</span>
                      </div>
                      <input type="number" min={0} max={3} step={0.05}
                        value={simConfig.macroMultiplierPurchases}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroMultiplierPurchases: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroMultiplierPurchases: simConfig.macroMultiplierPurchases })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">CBO central 1.5 (range 0.5–2.5) for one-time spending.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Multiplier, Transfers</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroMultiplierTransfers}</span>
                      </div>
                      <input type="number" min={0} max={3} step={0.05}
                        value={simConfig.macroMultiplierTransfers}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroMultiplierTransfers: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroMultiplierTransfers: simConfig.macroMultiplierTransfers })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">CBO/DSGE-family central multiplier for recurring/mandatory spending.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Multiplier, Tax</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroMultiplierTax}</span>
                      </div>
                      <input type="number" min={0} max={3} step={0.05}
                        value={simConfig.macroMultiplierTax}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroMultiplierTax: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroMultiplierTax: simConfig.macroMultiplierTax })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Flat, state-independent — Ramey 2019 finds tax multipliers higher in expansions, so no recession boost is applied here.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Multiplier, Recession Scale</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroMultiplierRecessionScale}</span>
                      </div>
                      <input type="number" min={1} max={3} step={0.05}
                        value={simConfig.macroMultiplierRecessionScale}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroMultiplierRecessionScale: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroMultiplierRecessionScale: simConfig.macroMultiplierRecessionScale })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Scale on spending multipliers during recession (Auerbach &amp; Gorodnichenko direction; Ramey calls this fragile — kept modest).</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Sentiment Adjust Speed</label>
                        <span className="text-sm text-gold font-mono">{simConfig.macroSentimentAdjustSpeed}</span>
                      </div>
                      <input type="number" min={0} max={1} step={0.01}
                        value={simConfig.macroSentimentAdjustSpeed}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, macroSentimentAdjustSpeed: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ macroSentimentAdjustSpeed: simConfig.macroSentimentAdjustSpeed })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Daily partial-adjustment rate of sentiment toward its target.</p>
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Capitol City (effect layer) — deployed dark */}
            {simConfig && (
              <CollapsibleSection
                id="capitol_city"
                title="Capitol City"
                subtitle="Micropolis effect layer — government tax/budget + macro state drive one visible city. One-way: nothing computed in the city flows back into the simulation. Deployed dark."
                badge={savingBadge}
              >
                <div className="space-y-3">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary font-medium">City Enabled (master switch)</span>
                    <input type="checkbox"
                      checked={simConfig.cityEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, cityEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ cityEnabled: simConfig.cityEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">When off, the city engine never loads, ticks, or writes — the government tick is byte-identical to today.</p>
                </div>

                <div className="border-t border-border pt-4">
                  <div className="space-y-2 max-w-xs">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">City-Months per Tick</label>
                      <span className="text-sm text-gold font-mono">{simConfig.cityMonthsPerTick}</span>
                    </div>
                    <input type="number" min={1} max={12} step={1}
                      value={simConfig.cityMonthsPerTick}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, cityMonthsPerTick: parseInt(e.target.value) || 1 } : c)}
                      onBlur={() => void saveConfig({ cityMonthsPerTick: simConfig.cityMonthsPerTick })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                    />
                    <p className="text-xs text-text-muted">City-months advanced per government tick. 1 keeps causality legible: this tick's budget → this month's city.</p>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Campaign Realism — deployed dark */}
            {simConfig && (
              <CollapsibleSection
                id="campaign_realism"
                title="Campaign Finance"
                subtitle="Real-money races — donor stances, per-tick donation drip, campaign spending, endorsements, honest polls, debates. Deployed dark."
                badge={savingBadge}
              >
                <div className="space-y-3">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary font-medium">Campaign Finance Enabled (master switch)</span>
                    <input type="checkbox"
                      checked={simConfig.campaignFinanceEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, campaignFinanceEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ campaignFinanceEnabled: simConfig.campaignFinanceEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">When off, speeches mint contributions exactly as before (byte-identical legacy path). NEVER flip mid-campaign — the war chest would mix minted units with real dollars. Flip between election cycles only.</p>
                </div>

                <div className="border-t border-border pt-4 space-y-4">
                  <div className="space-y-2 max-w-xs">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Donation Rate (% of donor balance / tick)</label>
                      <span className="text-sm text-gold font-mono">{simConfig.donationRatePct}</span>
                    </div>
                    <input type="number" min={0} max={2} step={0.05}
                      value={simConfig.donationRatePct}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, donationRatePct: parseFloat(e.target.value) || 0 } : c)}
                      onBlur={() => void saveConfig({ donationRatePct: simConfig.donationRatePct })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                    />
                    <p className="text-xs text-text-muted">Per-tick ceiling before generosity and jitter. 0.2 ≈ $496/tick from the median wallet at medium generosity (~5.8% of a wallet over a 30-tick cycle).</p>
                  </div>
                  <div className="space-y-2 max-w-xs">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Campaign Spend Rate (% of war chest / tick)</label>
                      <span className="text-sm text-gold font-mono">{simConfig.campaignSpendRatePct}</span>
                    </div>
                    <input type="number" min={0} max={100} step={1}
                      value={simConfig.campaignSpendRatePct}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, campaignSpendRatePct: parseFloat(e.target.value) || 0 } : c)}
                      onBlur={() => void saveConfig({ campaignSpendRatePct: simConfig.campaignSpendRatePct })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                    />
                    <p className="text-xs text-text-muted">Share of available funds (contributions − spent) a campaign burns per tick. Spending buys reach, which amplifies speeches and the poll exposure term.</p>
                  </div>
                </div>

                <div className="border-t border-border pt-4 space-y-3">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary font-medium">Endorsements Enabled</span>
                    <input type="checkbox"
                      checked={simConfig.endorsementsEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, endorsementsEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ endorsementsEnabled: simConfig.endorsementsEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">Officeholders and party leaders get one endorsement ask per race; an endorsement bumps candidate approval +1 and shows on ballots.</p>
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary font-medium">Polls Enabled</span>
                    <input type="checkbox"
                      checked={simConfig.pollsEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, pollsEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ pollsEnabled: simConfig.pollsEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">Per-tick poll snapshots from the real ballot signal families (alignment, approval, party, policy, reach). Serves the UI and enters ballot/speech prompts as a public signal.</p>
                </div>

                <div className="border-t border-border pt-4 space-y-4">
                  <div className="space-y-2 max-w-xs">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Debates per Campaign</label>
                      <span className="text-sm text-gold font-mono">{simConfig.campaignDebateCount}</span>
                    </div>
                    <input type="number" min={0} max={6} step={1}
                      value={simConfig.campaignDebateCount}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, campaignDebateCount: parseInt(e.target.value) || 0 } : c)}
                      onBlur={() => void saveConfig({ campaignDebateCount: simConfig.campaignDebateCount })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                    />
                    <p className="text-xs text-text-muted">Debates scheduled evenly inside each campaign window. 0 = off; recommend 2 at activation.</p>
                  </div>
                  <div className="space-y-2 max-w-xs">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Debate Participants</label>
                      <span className="text-sm text-gold font-mono">{simConfig.debateParticipants}</span>
                    </div>
                    <input type="number" min={2} max={8} step={1}
                      value={simConfig.debateParticipants}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, debateParticipants: parseInt(e.target.value) || 2 } : c)}
                      onBlur={() => void saveConfig({ debateParticipants: simConfig.debateParticipants })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                    />
                    <p className="text-xs text-text-muted">Top-K candidates on each stage, by latest poll, then contributions, then registration order.</p>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Scoreboard (E4) — deployed dark */}
            {simConfig && (
              <CollapsibleSection
                id="scoreboard"
                title="Scoreboard"
                subtitle="Sim-vs-reality metric registry — per-tick sim exporter + reality-side series into metric_snapshots. Deployed dark — see docs/specs/observability-and-metrics.md."
                badge={savingBadge}
              >
                <div className="space-y-3">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary font-medium">Scoreboard Enabled (master switch)</span>
                    <input type="checkbox"
                      checked={simConfig.scoreboardEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, scoreboardEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ scoreboardEnabled: simConfig.scoreboardEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">When off, no metric snapshots are written at all — sim exporter and reality adapters are both unreachable.</p>
                </div>

                <div className="border-t border-border pt-4 space-y-3">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary font-medium">FRED Adapter (UNRATE / CPI / GDP)</span>
                    <input type="checkbox"
                      checked={simConfig.fredAdapterEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, fredAdapterEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ fredAdapterEnabled: simConfig.fredAdapterEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">Tier C reality series. Needs FRED_API_KEY in the server env — skips with a log warning if unset.</p>
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary font-medium">Congress.gov Stats Adapter</span>
                    <input type="checkbox"
                      checked={simConfig.congressStatsAdapterEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, congressStatsAdapterEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ congressStatsAdapterEnabled: simConfig.congressStatsAdapterEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">Reality-side legislative throughput + median time-to-passage (119th Congress). Needs CONGRESS_API_KEY.</p>
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary font-medium">Approval Scrape (Ballotpedia)</span>
                    <input type="checkbox"
                      checked={simConfig.approvalScrapeEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, approvalScrapeEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ approvalScrapeEnabled: simConfig.approvalScrapeEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">Congressional-approval page scrape — tolerant parser; staleness surfaces in logs and /api/admin/reality/status.</p>
                </div>

                <div className="border-t border-border pt-4">
                  <div className="space-y-2 max-w-xs">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">10-K Report Cadence (ticks)</label>
                      <span className="text-sm text-gold font-mono">{simConfig.tenKReportCadenceTicks}</span>
                    </div>
                    <input type="number" min={0} max={2000} step={1}
                      value={simConfig.tenKReportCadenceTicks}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, tenKReportCadenceTicks: parseInt(e.target.value) || 0 } : c)}
                      onBlur={() => void saveConfig({ tenKReportCadenceTicks: simConfig.tenKReportCadenceTicks })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                    />
                    <p className="text-xs text-text-muted">Publish the Agora 10-K — one LLM narrative over the scoreboard, sim vs reality — every N ticks. 0 = off. Requires the scoreboard master switch; the report goes to the Press Room only, never into agent prompts.</p>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Debt Engine (Divergence E1 slice 1) — deployed dark */}
            {simConfig && (
              <CollapsibleSection
                id="debt_engine"
                title="Debt Engine"
                subtitle="Mandatory spending lane + debt/interest mechanics for the Divergence Experiment. Deployed dark — see docs/DIVERGENCE_EXPERIMENT.md."
                badge={savingBadge}
              >
                <div className="space-y-3">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary font-medium">Debt Engine Enabled (kill switch)</span>
                    <input type="checkbox"
                      checked={simConfig.debtEngineEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, debtEngineEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ debtEngineEnabled: simConfig.debtEngineEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">When off, mandatory-law debits, interest accrual, and treasury/debt settlement are all no-ops — Phase 12/13 behave exactly as before this engine existed. Turns on at the T0 baseline seed.</p>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Mandatory Spending &amp; Interest</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    {([
                      ['mandatoryGrowthPctAnnual', 'Mandatory Growth (%/yr)', 0, 15, 'Daily-compounding annual growth applied to mandatory programs (SS/Medicare-style auto-escalation).'],
                      ['debtInterestRatePct', 'Debt Interest Rate (%/yr)', 0, 15, 'Annual rate accrued daily on debtOutstanding — an automatic outflow, not a law.'],
                      ['fiscalMaxMandatoryDeltaPct', 'Max Mandatory Δ / Amendment (%)', 1, 25, 'Max % an amendment may move a mandatory law’s base amount, either direction.'],
                    ] as [keyof RuntimeConfig, string, number, number, string][]).map(([key, label, min, max, desc]) => (
                      <div key={key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-text-secondary">{label}</label>
                          <span className="text-sm text-gold font-mono">{simConfig[key] as number}%</span>
                        </div>
                        <input type="number" min={min} max={max} step={0.1}
                          value={simConfig[key] as number}
                          onChange={(e) => setSimConfig((c) => c ? { ...c, [key]: parseFloat(e.target.value) || min } : c)}
                          onBlur={() => void saveConfig({ [key]: simConfig[key] })}
                          className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                        />
                        <p className="text-xs text-text-muted">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Treasury Buffer &amp; Crisis</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Treasury Operating Buffer ($)</label>
                        <span className="text-sm text-gold font-mono">{formatMoney(simConfig.treasuryOperatingBufferDollars, { compact: true })}</span>
                      </div>
                      <input type="number" min={0} max={10_000_000_000_000} step={1_000_000_000}
                        value={simConfig.treasuryOperatingBufferDollars}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, treasuryOperatingBufferDollars: parseInt(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ treasuryOperatingBufferDollars: simConfig.treasuryOperatingBufferDollars })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Surplus above this automatically retires outstanding debt.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Debt Crisis Ratio (% of GDP)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.debtCrisisRatioPct}%</span>
                      </div>
                      <input type="number" min={50} max={500} step={1}
                        value={simConfig.debtCrisisRatioPct}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, debtCrisisRatioPct: parseInt(e.target.value) || 50 } : c)}
                        onBlur={() => void saveConfig({ debtCrisisRatioPct: simConfig.debtCrisisRatioPct })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Stress condition trips when debtOutstanding / gdpAnnual exceeds this share. Real is ≈120%.</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">T0 Baseline Anchor</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Divergence T0 Tick</label>
                        <span className="text-sm text-gold font-mono">{simConfig.divergenceT0Tick || '—'}</span>
                      </div>
                      <input type="number" min={0} step={1}
                        value={simConfig.divergenceT0Tick}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, divergenceT0Tick: parseInt(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ divergenceT0Tick: simConfig.divergenceT0Tick })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Tick number of the baseline seed. 0 = not yet seeded. Set once by scripts/seed-divergence-baseline.ts (slice 2).</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Divergence T0 Date</label>
                      </div>
                      <input type="text" placeholder="YYYY-MM-DD"
                        value={simConfig.divergenceT0Date}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, divergenceT0Date: e.target.value } : c)}
                        onBlur={() => void saveConfig({ divergenceT0Date: simConfig.divergenceT0Date })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">ISO date anchoring T0 — real-date ↔ tick-date mapping for the Sim vs Reality page.</p>
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Fiscal Consequences (Fiscal Consequence Loop) — deployed dark, zero-effect defaults */}
            {simConfig && (
              <CollapsibleSection
                id="fiscal_consequences"
                title="Fiscal Consequences"
                subtitle="Makes fiscal reality bite: treasury/debt/deficit/tax move incumbent approval, ballots surface fiscal records, tax revenue goes elastic. Deployed dark with zero-effect weights — see docs/specs/fiscal-consequence-loop.md."
                badge={savingBadge}
              >
                <div className="space-y-3">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary font-medium">Fiscal Consequence Enabled (master kill switch)</span>
                    <input type="checkbox"
                      checked={simConfig.fiscalConsequenceEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, fiscalConsequenceEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ fiscalConsequenceEnabled: simConfig.fiscalConsequenceEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">When off, the fiscal→approval phase is a no-op — the tick behaves byte-identically to before this loop existed. Each weight below defaults to 0 (zero-effect) even once this is on.</p>
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary font-medium">Ballot Fiscal Record Enabled</span>
                    <input type="checkbox"
                      checked={simConfig.ballotFiscalRecordEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, ballotFiscalRecordEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ ballotFiscalRecordEnabled: simConfig.ballotFiscalRecordEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">When on, each candidate&apos;s tenure fiscal record (deficit/day, debt Δ, tax Δ) is injected into the Phase 14 ballot prompt. Off = ballot prompt unchanged.</p>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Approval Signal Weights (0 = signal disabled)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {([
                      ['fiscalApprovalDebtWeight', 'Debt/GDP Weight', 0, 50, 'Strength of the debt/GDP-ratio penalty on incumbent approval.'],
                      ['fiscalApprovalTreasuryWeight', 'Treasury Depletion Weight', 0, 50, 'Strength of the penalty as treasury falls below the operating buffer toward zero.'],
                      ['fiscalApprovalDeficitWeight', 'Deficit Weight', 0, 50, 'Strength of the penalty proportional to deficit as a share of revenue.'],
                      ['fiscalApprovalTaxWeight', 'Tax Burden Weight', 0, 50, 'Strength of the penalty as the tax rate rises above the neutral point.'],
                    ] as [keyof RuntimeConfig, string, number, number, string][]).map(([key, label, min, max, desc]) => (
                      <div key={key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-text-secondary">{label}</label>
                          <span className="text-sm text-gold font-mono">{simConfig[key] as number}</span>
                        </div>
                        <input type="number" min={min} max={max} step={0.5}
                          value={simConfig[key] as number}
                          onChange={(e) => setSimConfig((c) => c ? { ...c, [key]: parseFloat(e.target.value) || min } : c)}
                          onBlur={() => void saveConfig({ [key]: simConfig[key] })}
                          className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                        />
                        <p className="text-xs text-text-muted">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Shaping &amp; Guards</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Party Weighting</label>
                        <span className="text-sm text-gold font-mono">{simConfig.fiscalConsequencePartyWeight}</span>
                      </div>
                      <input type="number" min={0} max={1} step={0.05}
                        value={simConfig.fiscalConsequencePartyWeight}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, fiscalConsequencePartyWeight: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ fiscalConsequencePartyWeight: simConfig.fiscalConsequencePartyWeight })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">0 = party-blind; 1 = full constituency weighting (hawks take larger tax/debt penalties).</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Max Δ / Tick</label>
                        <span className="text-sm text-gold font-mono">{simConfig.fiscalApprovalMaxDeltaPerTick}</span>
                      </div>
                      <input type="number" min={1} max={20} step={0.5}
                        value={simConfig.fiscalApprovalMaxDeltaPerTick}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, fiscalApprovalMaxDeltaPerTick: parseFloat(e.target.value) || 1 } : c)}
                        onBlur={() => void saveConfig({ fiscalApprovalMaxDeltaPerTick: simConfig.fiscalApprovalMaxDeltaPerTick })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Clamp on the total fiscal approval move per incumbent per tick (stability guard).</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Debt Health Band (ratio)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.fiscalApprovalDebtHealthBand}</span>
                      </div>
                      <input type="number" min={0} max={5} step={0.05}
                        value={simConfig.fiscalApprovalDebtHealthBand}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, fiscalApprovalDebtHealthBand: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ fiscalApprovalDebtHealthBand: simConfig.fiscalApprovalDebtHealthBand })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Debt/GDP ratio where drag begins. 1.0 = mild drag from 100% of GDP.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Debt Crisis Band (ratio)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.fiscalApprovalDebtCrisisBand}</span>
                      </div>
                      <input type="number" min={0} max={10} step={0.05}
                        value={simConfig.fiscalApprovalDebtCrisisBand}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, fiscalApprovalDebtCrisisBand: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ fiscalApprovalDebtCrisisBand: simConfig.fiscalApprovalDebtCrisisBand })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Debt/GDP ratio treated as full crisis — the debt signal saturates to −1 here.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Deficit Crisis Ratio</label>
                        <span className="text-sm text-gold font-mono">{simConfig.fiscalApprovalDeficitCrisisRatio}</span>
                      </div>
                      <input type="number" min={0} max={2} step={0.05}
                        value={simConfig.fiscalApprovalDeficitCrisisRatio}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, fiscalApprovalDeficitCrisisRatio: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ fiscalApprovalDeficitCrisisRatio: simConfig.fiscalApprovalDeficitCrisisRatio })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Deficit/revenue share at which the deficit signal saturates to −1.</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Tax Elasticity (Laffer response)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Elasticity Strength</label>
                        <span className="text-sm text-gold font-mono">{simConfig.taxElasticityStrength}</span>
                      </div>
                      <input type="number" min={0} max={1} step={0.05}
                        value={simConfig.taxElasticityStrength}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, taxElasticityStrength: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ taxElasticityStrength: simConfig.taxElasticityStrength })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">0 = today&apos;s linear revenue; 1 = full Laffer response (diminishing returns, revenue can fall past the peak).</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Neutral Rate (%)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.taxNeutralRatePercent}%</span>
                      </div>
                      <input type="number" min={0} max={40} step={0.5}
                        value={simConfig.taxNeutralRatePercent}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, taxNeutralRatePercent: parseFloat(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ taxNeutralRatePercent: simConfig.taxNeutralRatePercent })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Rate below which elasticity is ~inert and the tax-burden signal is neutral.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Revenue Peak (%)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.taxRevenuePeakPercent}%</span>
                      </div>
                      <input type="number" min={20} max={60} step={0.5}
                        value={simConfig.taxRevenuePeakPercent}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, taxRevenuePeakPercent: parseFloat(e.target.value) || 20 } : c)}
                        onBlur={() => void saveConfig({ taxRevenuePeakPercent: simConfig.taxRevenuePeakPercent })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Tax rate of maximum revenue on the elastic curve — revenue declines above this.</p>
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Office Selection (Office-Selection Fidelity) — deployed dark, off by default */}
            {simConfig && (
              <CollapsibleSection
                id="office_selection"
                title="Office Selection"
                subtitle="Replicates how each seat is really filled: the Legislature elects its own Speaker; justices + cabinet are president-nominated and Legislature-confirmed; the president is decided by the Electoral College. All off by default — off = today's engine-decided seating, byte-identical. See docs/specs/office-selection-fidelity.md."
                badge={savingBadge}
              >
                <div className="space-y-3">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary font-medium">Speaker Election Enabled</span>
                    <input type="checkbox"
                      checked={simConfig.speakerElectionEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, speakerElectionEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ speakerElectionEnabled: simConfig.speakerElectionEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">When on, sitting congress members elect a Speaker of the Legislature by internal roll-call vote (majority of votes cast). Off = no Speaker seat exists, exactly as today.</p>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Speaker Re-ballot Cap</label>
                      <span className="text-sm text-gold font-mono">{simConfig.speakerReballotCap}</span>
                    </div>
                    <input type="number" min={1} max={10} step={1}
                      value={simConfig.speakerReballotCap}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, speakerReballotCap: parseInt(e.target.value) || 1 } : c)}
                      onBlur={() => void saveConfig({ speakerReballotCap: simConfig.speakerReballotCap })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                    />
                    <p className="text-xs text-text-muted">Re-ballots per tick before a deadlocked Speaker race carries to the next tick (a Legislature that cannot organize).</p>
                  </div>

                  <label className="flex items-center justify-between border-t border-border pt-4">
                    <span className="text-sm text-text-secondary font-medium">Appointment Confirmation Enabled</span>
                    <input type="checkbox"
                      checked={simConfig.appointmentConfirmationEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, appointmentConfirmationEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ appointmentConfirmationEnabled: simConfig.appointmentConfirmationEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">When on, justices and cabinet secretaries are filled by president-nominate → Legislature-confirm. Off = today's reputation-rank justice auto-fill and no cabinet at all.</p>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Confirmation Threshold</label>
                      <span className="text-sm text-gold font-mono">{simConfig.appointmentConfirmationThreshold}</span>
                    </div>
                    <input type="number" min={0} max={1} step={0.05}
                      value={simConfig.appointmentConfirmationThreshold}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, appointmentConfirmationThreshold: parseFloat(e.target.value) || 0 } : c)}
                      onBlur={() => void saveConfig({ appointmentConfirmationThreshold: simConfig.appointmentConfirmationThreshold })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                    />
                    <p className="text-xs text-text-muted">Share of weighted Legislature alignment needed to confirm a nominee. 0.5 = simple majority (advice and consent).</p>
                  </div>

                  <label className="flex items-center justify-between border-t border-border pt-4">
                    <span className="text-sm text-text-secondary font-medium">Electoral College Enabled</span>
                    <input type="checkbox"
                      checked={simConfig.electoralCollegeEnabled}
                      onChange={e => setSimConfig(c => c ? ({ ...c, electoralCollegeEnabled: e.target.checked }) : c)}
                      onBlur={() => void saveConfig({ electoralCollegeEnabled: simConfig.electoralCollegeEnabled })}
                    />
                  </label>
                  <p className="text-xs text-text-muted">When on, presidential ballots are tallied per state and the Electoral College (538 EVs, 270 to win, winner-take-all) decides the winner. Off = today's single honest national popular-vote count.</p>
                </div>
              </CollapsibleSection>
            )}

            {/* Elections */}
            {simConfig && (
              <CollapsibleSection id="elections" title="Elections">
                <div className="space-y-6">

                  {/* Trigger new election */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-text-secondary uppercase tracking-widest">Trigger Election Now</p>
                    <div className="flex gap-2 items-center">
                      <select
                        value={electionTriggerType}
                        onChange={(e) => setElectionTriggerType(e.target.value)}
                        className="bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                      >
                        {/* Only the two lifecycle-supported types — the old
                            'congress'/'supreme_court' options created rows no
                            lifecycle code recognizes (frozen in registration). */}
                        <option value="president">President</option>
                        <option value="congress_general">Congress (General)</option>
                      </select>
                      <button
                        disabled={electionWorking}
                        onClick={async () => {
                          setElectionWorking(true);
                          try {
                            await adminApi.triggerElection(electionTriggerType);
                            flash(`${electionTriggerType} election triggered`);
                            void fetchActiveElections();
                          } catch (err) {
                            flash(err instanceof Error ? err.message : 'Failed to trigger election');
                          } finally {
                            setElectionWorking(false);
                          }
                        }}
                        className="px-3 py-1.5 rounded text-xs font-medium border bg-gold/20 text-gold border-gold/40 hover:bg-gold/30 disabled:opacity-40 transition-all"
                      >
                        {electionWorking ? 'Working...' : 'Trigger'}
                      </button>
                    </div>
                    <p className="text-xs text-text-muted">Immediately starts a new election in registration phase using current campaign/voting duration settings.</p>
                  </div>

                  {/* Active elections */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-text-secondary uppercase tracking-widest">Active Elections</p>
                      <button onClick={() => void fetchActiveElections()} className="text-xs text-text-muted hover:text-text-primary transition-colors">Refresh</button>
                    </div>
                    {activeElections.length === 0 ? (
                      <EmptyState compact title="No active elections." />
                    ) : (
                      <div className="rounded-lg border border-border overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="border-b border-border bg-white/5">
                            <tr>
                              <th className="text-left px-3 py-2 text-text-muted font-normal">Position</th>
                              <th className="text-left px-3 py-2 text-text-muted font-normal">Phase</th>
                              <th className="text-left px-3 py-2 text-text-muted font-normal">Voting Opens</th>
                              <th className="px-3 py-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeElections.map((el) => (
                              <tr key={el.id} className="border-b border-border/50 last:border-0">
                                <td className="px-3 py-2 text-text-primary capitalize">{el.positionType.replace(/_/g, ' ')}</td>
                                <td className="px-3 py-2">
                                  <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide bg-gold/10 text-gold border border-gold/20">
                                    {el.status}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-text-muted">
                                  {el.votingStartDate ? new Date(el.votingStartDate).toLocaleString() : '—'}
                                </td>
                                <td className="px-3 py-2">
                                  {el.status !== 'certified' && el.status !== 'cancelled' && (
                                    <button
                                      disabled={electionWorking}
                                      onClick={async () => {
                                        setElectionWorking(true);
                                        try {
                                          const res = await adminApi.advanceElection(el.id) as { data?: { newStatus: string } };
                                          flash(`Advanced to: ${res.data?.newStatus ?? 'next phase'}`);
                                          void fetchActiveElections();
                                        } catch (err) {
                                          flash(err instanceof Error ? err.message : 'Failed to advance');
                                        } finally {
                                          setElectionWorking(false);
                                        }
                                      }}
                                      className="px-2 py-1 rounded text-[10px] font-medium border bg-white/5 text-text-muted border-border hover:bg-white/10 disabled:opacity-40 transition-all"
                                    >
                                      Advance Phase
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Presidential term limit (elections revival minimal slice) — 0 = disabled, deploy dark */}
                  <div className="space-y-2 border-t border-border pt-4">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">President Term Limit</label>
                      <span className="text-sm text-gold font-mono">{simConfig.presidentTermTicks === 0 ? 'disabled' : `${simConfig.presidentTermTicks} ticks`}</span>
                    </div>
                    <input type="number" min={0} max={100000} step={1}
                      value={simConfig.presidentTermTicks}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, presidentTermTicks: parseInt(e.target.value) || 0 } : c)}
                      onBlur={() => void saveConfig({ presidentTermTicks: simConfig.presidentTermTicks })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                    />
                    <p className="text-xs text-text-muted">Incumbent tenure limit in ticks, counted from the tick the president was seated (presidents seated before the tick-anchor migration fall back to wall-clock-derived tenure, so the first enable triggers an election immediately). 0 = disabled; recommended 1460 ≈ 4 sim-years. When enabled and the sitting president's tenure reaches this limit, a new presidential election is triggered automatically instead of being suppressed — the incumbent stays seated until certification.</p>
                  </div>

                  {/* Election Cycles — tick-anchored phase schedule (1 tick = 1 sim-day) */}
                  <div className="space-y-4 border-t border-border pt-4">
                    <p className="text-xs font-medium text-text-secondary uppercase tracking-widest">Election Cycle Windows (ticks)</p>
                    <p className="text-xs text-text-muted">Phase schedule for elections created after the tick-anchor migration; 1 tick = 1 sim-day. Legacy in-flight elections keep the wall-clock Campaign Duration / Voting Window settings below until they finish.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-text-secondary">Registration</label>
                          <span className="text-sm text-gold font-mono">{simConfig.electionRegistrationTicks} ticks</span>
                        </div>
                        <input type="number" min={1} max={365} step={1}
                          value={simConfig.electionRegistrationTicks}
                          onChange={(e) => setSimConfig((c) => c ? { ...c, electionRegistrationTicks: parseInt(e.target.value) || 1 } : c)}
                          onBlur={() => void saveConfig({ electionRegistrationTicks: simConfig.electionRegistrationTicks })}
                          className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-text-secondary">Campaigning</label>
                          <span className="text-sm text-gold font-mono">{simConfig.electionCampaignTicks} ticks</span>
                        </div>
                        <input type="number" min={1} max={730} step={1}
                          value={simConfig.electionCampaignTicks}
                          onChange={(e) => setSimConfig((c) => c ? { ...c, electionCampaignTicks: parseInt(e.target.value) || 1 } : c)}
                          onBlur={() => void saveConfig({ electionCampaignTicks: simConfig.electionCampaignTicks })}
                          className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-text-secondary">Voting</label>
                          <span className="text-sm text-gold font-mono">{simConfig.electionVotingTicks} ticks</span>
                        </div>
                        <input type="number" min={1} max={90} step={1}
                          value={simConfig.electionVotingTicks}
                          onChange={(e) => setSimConfig((c) => c ? { ...c, electionVotingTicks: parseInt(e.target.value) || 1 } : c)}
                          onBlur={() => void saveConfig({ electionVotingTicks: simConfig.electionVotingTicks })}
                          className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Congressional general election cadence — 0 = disabled, deploy dark */}
                  <div className="space-y-2 border-t border-border pt-4">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Congress Term Length</label>
                      <span className="text-sm text-gold font-mono">{simConfig.congressTermTicks === 0 ? 'disabled' : `${simConfig.congressTermTicks} ticks`}</span>
                    </div>
                    <input type="number" min={0} max={100000} step={1}
                      value={simConfig.congressTermTicks}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, congressTermTicks: parseInt(e.target.value) || 0 } : c)}
                      onBlur={() => void saveConfig({ congressTermTicks: simConfig.congressTermTicks })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                    />
                    <p className="text-xs text-text-muted">Congressional general election cadence in ticks. 0 = disabled; recommended 730 ≈ 2 sim-years. When enabled, a chamber-wide general election recurs on this cadence (fires immediately on first enable); every seat is contested and the whole chamber turns over at certification. For contested races keep Congress Seats below the active-agent count.</p>
                  </div>

                  {/* Timing config */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Campaign Duration</label>
                        <span className="text-sm text-gold font-mono">{simConfig.campaignDurationDays}d</span>
                      </div>
                      <div className="flex gap-2">
                        <select
                          value={[1,2,3,5,7,10,14].includes(simConfig.campaignDurationDays) ? simConfig.campaignDurationDays : ''}
                          onChange={(e) => { if (e.target.value) void saveConfig({ campaignDurationDays: Number(e.target.value) }); }}
                          className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                        >
                          <option value="">Days</option>
                          {[1,2,3,5,7,10,14].map((d) => <option key={d} value={d}>{d}d</option>)}
                        </select>
                        <select
                          value={[30,45,60,90,120,180].includes(simConfig.campaignDurationDays) ? simConfig.campaignDurationDays : ''}
                          onChange={(e) => { if (e.target.value) void saveConfig({ campaignDurationDays: Number(e.target.value) }); }}
                          className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                        >
                          <option value="">Months</option>
                          {[{v:30,l:'1mo'},{v:45,l:'1.5mo'},{v:60,l:'2mo'},{v:90,l:'3mo'},{v:120,l:'4mo'},{v:180,l:'6mo'}].map(({v,l}) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Voting Window</label>
                        <span className="text-sm text-gold font-mono">{simConfig.votingDurationHours}h</span>
                      </div>
                      <div className="flex gap-2">
                        <select
                          value={simConfig.votingDurationHours < 24 ? simConfig.votingDurationHours : ''}
                          onChange={(e) => { if (e.target.value) void saveConfig({ votingDurationHours: Number(e.target.value) }); }}
                          className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                        >
                          <option value="">Hours</option>
                          {[1,2,4,6,8,12,18].map((h) => <option key={h} value={h}>{h}h</option>)}
                        </select>
                        <select
                          value={simConfig.votingDurationHours >= 24 && simConfig.votingDurationHours % 24 === 0 && simConfig.votingDurationHours / 24 <= 14 ? simConfig.votingDurationHours : ''}
                          onChange={(e) => { if (e.target.value) void saveConfig({ votingDurationHours: Number(e.target.value) }); }}
                          className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                        >
                          <option value="">Days</option>
                          {[1,2,3,5,7,10,14].map((d) => <option key={d} value={d*24}>{d}d</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Min Reputation to Run</label>
                        <span className="text-sm text-gold font-mono">{simConfig.minReputationToRun}</span>
                      </div>
                      <input type="range" min={0} max={500} step={10} value={simConfig.minReputationToRun}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, minReputationToRun: parseInt(e.target.value) } : c)}
                        onMouseUp={() => void saveConfig({ minReputationToRun: simConfig.minReputationToRun })}
                        onTouchEnd={() => void saveConfig({ minReputationToRun: simConfig.minReputationToRun })}
                        className="w-full accent-gold" />
                      <p className="text-xs text-text-muted">Reputation required to declare candidacy.</p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Min Reputation to Vote</label>
                        <span className="text-sm text-gold font-mono">{simConfig.minReputationToVote}</span>
                      </div>
                      <input type="range" min={0} max={200} step={5} value={simConfig.minReputationToVote}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, minReputationToVote: parseInt(e.target.value) } : c)}
                        onMouseUp={() => void saveConfig({ minReputationToVote: simConfig.minReputationToVote })}
                        onTouchEnd={() => void saveConfig({ minReputationToVote: simConfig.minReputationToVote })}
                        className="w-full accent-gold" />
                      <p className="text-xs text-text-muted">Reputation required to cast a vote.</p>
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
            )}
          </div>
        )}

        {activeTab === 'agents' && (
          <div className="space-y-6">
            {/* Agents */}
            <CollapsibleSection id="agents" title="Agents">
              <div className="flex justify-end mb-2">
                <button
                  onClick={() => setShowCreateAgent(!showCreateAgent)}
                  className="text-xs px-3 py-1.5 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30 transition-all"
                >
                  {showCreateAgent ? 'Cancel' : 'Create New Agent'}
                </button>
              </div>

              {showCreateAgent && (
                <form onSubmit={(e) => void handleCreateAgent(e)} className="space-y-4 border border-border rounded p-4 mb-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide">New Agent</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Display Name</label>
                      <input type="text" value={agentForm.displayName}
                        onChange={(e) => setAgentForm((f) => ({ ...f, displayName: e.target.value }))}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                        placeholder="Jane Doe" required />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Username slug</label>
                      <input type="text" value={agentForm.name}
                        onChange={(e) => setAgentForm((f) => ({ ...f, name: e.target.value }))}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                        placeholder="jane_doe" required />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Alignment</label>
                      <select value={agentForm.alignment}
                        onChange={(e) => setAgentForm((f) => ({ ...f, alignment: e.target.value }))}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50">
                        {ALIGNMENTS.map((a) => <option key={a} value={a} className="bg-surface">{a}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Provider</label>
                      <select value={agentForm.modelProvider}
                        onChange={(e) => setAgentForm((f) => ({ ...f, modelProvider: e.target.value }))}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50">
                        {AI_PROVIDERS.map((p) => <option key={p} value={p} className="bg-surface">{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Model (optional)</label>
                      {simModels.length > 0 && !simModelsFailed ? (
                        <select value={agentForm.model}
                          onChange={(e) => setAgentForm((f) => ({ ...f, model: e.target.value }))}
                          className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50">
                          <option value="" className="bg-surface">Default</option>
                          {simModels.map((m) => <option key={m} value={m} className="bg-surface">{m}</option>)}
                        </select>
                      ) : (
                        <input type="text" value={agentForm.model}
                          onChange={(e) => setAgentForm((f) => ({ ...f, model: e.target.value }))}
                          className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                          placeholder="e.g. claude-haiku-4-5-20251001" />
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Starting Balance ($)</label>
                      <input type="number" min={0} step={100} value={agentForm.startingBalance}
                        onChange={(e) => setAgentForm((f) => ({ ...f, startingBalance: parseInt(e.target.value) || 0 }))}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">Personality</label>
                    <textarea value={agentForm.personality}
                      onChange={(e) => setAgentForm((f) => ({ ...f, personality: e.target.value }))}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      rows={2} placeholder="How this agent thinks and acts..." />
                  </div>
                  <button type="submit" disabled={agentFormLoading}
                    className="px-6 py-2 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30 text-sm font-medium transition-all disabled:opacity-40">
                    {agentFormLoading ? 'Creating...' : 'Create Agent'}
                  </button>
                </form>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {['Agent', 'Alignment', 'Provider', 'Reputation', 'Balance', 'Status', ''].map((h) => (
                        <th key={h} className="pb-2 pr-4 text-xs font-medium text-text-muted uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {agentList.map((agent) => (
                      <tr key={agent.id} className={`hover:bg-white/[0.02] ${!agent.isActive ? 'opacity-50' : ''}`}>
                        <td className="py-2 pr-4 text-text-primary font-medium whitespace-nowrap">
                          {agent.displayName}
                        </td>
                        <td className="py-2 pr-4 text-text-secondary text-xs whitespace-nowrap">
                          {agent.alignment}
                        </td>
                        <td className="py-2 pr-4">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            agent.modelProvider === 'anthropic'
                              ? 'bg-purple-900/40 text-purple-300'
                              : agent.modelProvider === 'openai'
                              ? 'bg-green-900/40 text-green-300'
                              : agent.modelProvider === 'google'
                              ? 'bg-blue-900/40 text-blue-300'
                              : 'bg-gray-900/40 text-gray-300'
                          }`}>
                            {agent.modelProvider}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-text-secondary text-xs">{agent.reputation}</td>
                        <td className="py-2 pr-4 text-text-secondary text-xs">{formatMoney(agent.balance)}</td>
                        <td className="py-2 pr-4">
                          <StatusBadge ok={agent.isActive} label={agent.isActive ? 'Active' : 'Inactive'} />
                        </td>
                        <td className="py-2">
                          <button
                            onClick={() => void handleToggleAgent(agent.id)}
                            className={`text-xs px-2 py-1 rounded border transition-all ${
                              agent.isActive
                                ? 'text-red-400 border-red-800 hover:bg-red-900/30'
                                : 'text-green-400 border-green-800 hover:bg-green-900/30'
                            }`}
                          >
                            {agent.isActive ? 'Disable' : 'Enable'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>

            {/* Decision Stats */}
            {decisionStats && (
              <CollapsibleSection id="decision_stats" title="Decision Stats">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: 'Total Decisions', value: decisionStats.total },
                    { label: 'Errors', value: decisionStats.errors, warn: decisionStats.errors > 0 },
                    { label: 'Anthropic', value: decisionStats.haikuCount },
                    { label: 'Ollama', value: decisionStats.ollamaCount },
                  ].map(({ label, value, warn }) => (
                    <div key={label} className="bg-white/5 rounded p-3">
                      <div className="text-xs text-text-muted uppercase tracking-wide">{label}</div>
                      <div className={`text-xl font-semibold mt-1 ${warn ? 'text-red-400' : 'text-text-primary'}`}>
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Agent Avatars */}
            <CollapsibleSection id="agent_avatars" title="Agent Avatars" subtitle="Customize pixel portrait configurations">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 items-start">
                {avatarAgents.map((agent) => {
                  const isEditing = editingAgentId === agent.id;
                  const cfg = getDraftConfig(agent);

                  return (
                    <div key={agent.id} className="flex flex-col gap-0">
                      {/* Agent card */}
                      <div className="bg-white/5 rounded border border-border p-3 flex flex-col items-center gap-2">
                        <PixelAvatar config={cfg} seed={agent.name} size="md" />
                        <div className="text-sm font-medium text-center truncate w-full">{agent.displayName}</div>
                        <button
                          className="btn-secondary text-xs w-full"
                          onClick={() => setEditingAgentId(isEditing ? null : agent.id)}
                        >
                          {isEditing ? 'Close' : 'Edit'}
                        </button>
                      </div>

                      {/* Inline editor panel */}
                      {isEditing && (
                        <div className="border border-border border-t-0 bg-surface rounded-b p-4 space-y-4">
                          <div className="flex justify-center">
                            <PixelAvatar config={cfg} seed={agent.name} size="lg" />
                          </div>

                          <div className="space-y-2">
                            {([
                              ['Background', 'bgColor', cfg.bgColor],
                              ['Face', 'faceColor', cfg.faceColor],
                              ['Accent', 'accentColor', cfg.accentColor],
                            ] as [string, keyof AvatarConfig, string][]).map(([label, key, value]) => (
                              <div key={key} className="flex items-center justify-between gap-2">
                                <label className="text-xs text-text-secondary">{label}</label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="color"
                                    value={value}
                                    onChange={(e) => updateDraft(agent.id, { [key]: e.target.value })}
                                    className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent"
                                  />
                                  <span className="font-mono text-xs text-text-muted">{value}</span>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div>
                            <div className="text-xs text-text-muted mb-2 uppercase tracking-wide">Eyes</div>
                            <div className="grid grid-cols-4 gap-1">
                              {(['square', 'wide', 'dot', 'visor'] as AvatarConfig['eyeType'][]).map((et) => (
                                <button
                                  key={et}
                                  onClick={() => updateDraft(agent.id, { eyeType: et })}
                                  className={`flex flex-col items-center gap-1 p-1 rounded border transition-all ${
                                    cfg.eyeType === et ? 'border-gold bg-gold/10' : 'border-border bg-white/5 hover:bg-white/10'
                                  }`}
                                >
                                  <PixelAvatar config={{ ...cfg, eyeType: et }} seed={agent.name} size="xs" />
                                  <span className="text-[9px] text-text-muted">{et}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-text-muted mb-2 uppercase tracking-wide">Mouth</div>
                            <div className="grid grid-cols-4 gap-1">
                              {(['smile', 'stern', 'speak', 'grin'] as AvatarConfig['mouthType'][]).map((mt) => (
                                <button
                                  key={mt}
                                  onClick={() => updateDraft(agent.id, { mouthType: mt })}
                                  className={`flex flex-col items-center gap-1 p-1 rounded border transition-all ${
                                    cfg.mouthType === mt ? 'border-gold bg-gold/10' : 'border-border bg-white/5 hover:bg-white/10'
                                  }`}
                                >
                                  <PixelAvatar config={{ ...cfg, mouthType: mt }} seed={agent.name} size="xs" />
                                  <span className="text-[9px] text-text-muted">{mt}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-text-muted mb-2 uppercase tracking-wide">Accessory</div>
                            <div className="grid grid-cols-4 gap-1">
                              {(['none', 'antenna', 'dual_antenna', 'halo'] as AvatarConfig['accessory'][]).map((acc) => (
                                <button
                                  key={acc}
                                  onClick={() => updateDraft(agent.id, { accessory: acc })}
                                  className={`flex flex-col items-center gap-1 p-1 rounded border transition-all ${
                                    cfg.accessory === acc ? 'border-gold bg-gold/10' : 'border-border bg-white/5 hover:bg-white/10'
                                  }`}
                                >
                                  <PixelAvatar config={{ ...cfg, accessory: acc }} seed={agent.name} size="xs" />
                                  <span className="text-[9px] text-text-muted leading-tight text-center">{acc === 'dual_antenna' ? 'dual' : acc}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="flex flex-col gap-2">
                            <button
                              className="btn-secondary text-xs w-full bg-gold/10 text-gold border-gold/30 hover:bg-gold/20"
                              onClick={() => void handleSaveAvatar(agent.id)}
                              disabled={savingId === agent.id}
                            >
                              {savingId === agent.id ? 'Saving...' : 'Save'}
                            </button>
                            <button className="btn-secondary text-xs w-full" onClick={() => handleResetAvatar(agent)}>
                              Reset to Procedural
                            </button>
                            <button className="btn-secondary text-xs w-full text-text-muted" onClick={() => setEditingAgentId(null)}>
                              Cancel
                            </button>
                            {saveMessage[agent.id] && (
                              <div className={`text-xs text-center ${saveMessage[agent.id] === 'Saved!' ? 'text-green-400' : 'text-red-400'}`}>
                                {saveMessage[agent.id]}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>

            {/* Decision Log */}
            <CollapsibleSection id="decision_log" title="Decision Log">
              {loading ? (
                <p className="text-text-muted text-sm">Loading...</p>
              ) : decisions.length === 0 ? (
                <p className="text-text-muted text-sm">No decisions yet -- simulation hasn't run.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        {['Agent', 'Provider', 'Phase', 'Action', 'Status', 'Latency', 'Reasoning'].map((h) => (
                          <th key={h} className="pb-2 pr-4 text-xs font-medium text-text-muted uppercase tracking-wide">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {decisions.map((d) => (
                        <tr key={d.id} className="hover:bg-white/[0.02]">
                          <td className="py-2 pr-4 text-text-primary font-medium whitespace-nowrap">
                            {d.agentName ?? '\u2014'}
                          </td>
                          <td className="py-2 pr-4">
                            <span className="text-xs px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300">
                              {d.provider}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-text-secondary text-xs whitespace-nowrap">
                            {d.phase ?? '\u2014'}
                          </td>
                          <td className="py-2 pr-4 text-text-secondary text-xs whitespace-nowrap">
                            {d.parsedAction ?? '\u2014'}
                          </td>
                          <td className="py-2 pr-4">
                            <span className={`text-xs ${d.success ? 'text-green-400' : 'text-red-400'}`}>
                              {d.success ? 'ok' : 'err'}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-text-muted text-xs whitespace-nowrap">
                            {d.latencyMs}ms
                          </td>
                          <td className="py-2 text-text-secondary text-xs max-w-xs truncate" title={d.parsedReasoning ?? ''}>
                            {d.parsedReasoning ?? '\u2014'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CollapsibleSection>
          </div>
        )}

        {activeTab === 'providers' && (
          <div className="space-y-6">
            {/* AI Providers */}
            <CollapsibleSection id="api_providers" title="AI Providers" subtitle="Configure API keys for each provider. Keys are AES-256 encrypted at rest.">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {providers.map((p) => {
                  const testResult = providerTestResults[p.providerName];
                  return (
                    <div key={p.providerName} className="bg-white/5 rounded border border-border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text-primary capitalize">{p.providerName}</span>
                          {p.isConfigured ? (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-green-900/40 text-green-400">Configured</span>
                          ) : (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-text-muted">Not set</span>
                          )}
                        </div>
                        {p.maskedKey && <span className="text-xs font-mono text-text-muted">{p.maskedKey}</span>}
                      </div>

                      {p.providerName !== 'ollama' && (
                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={providerKeyInputs[p.providerName] ?? ''}
                            onChange={(e) => setProviderKeyInputs((prev) => ({ ...prev, [p.providerName]: e.target.value }))}
                            className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                            placeholder={p.isConfigured ? 'Replace key...' : 'Enter API key...'}
                          />
                        </div>
                      )}

                      {p.providerName === 'ollama' && (
                        <div>
                          <input
                            type="text"
                            value={providerOllamaInputs[p.providerName] ?? (p.ollamaBaseUrl ?? '')}
                            onChange={(e) => setProviderOllamaInputs((prev) => ({ ...prev, [p.providerName]: e.target.value }))}
                            className="w-full bg-white/5 border border-border rounded px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                            placeholder="http://localhost:11434"
                          />
                        </div>
                      )}

                      <div>
                        <input
                          type="text"
                          value={providerModelInputs[p.providerName] ?? (p.defaultModel ?? '')}
                          onChange={(e) => setProviderModelInputs((prev) => ({ ...prev, [p.providerName]: e.target.value }))}
                          className="w-full bg-white/5 border border-border rounded px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                          placeholder="Default model (e.g. gpt-4o)"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => void handleProviderSave(p.providerName)}
                          disabled={providerSaving === p.providerName}
                          className="px-3 py-1.5 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30 text-xs font-medium transition-all disabled:opacity-40"
                        >
                          {providerSaving === p.providerName ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => void handleProviderTest(p.providerName)}
                          disabled={providerTesting === p.providerName}
                          className="px-3 py-1.5 rounded bg-white/5 border border-border text-text-muted hover:bg-white/10 text-xs font-medium transition-all disabled:opacity-40"
                        >
                          {providerTesting === p.providerName ? 'Testing...' : 'Test'}
                        </button>
                        {p.isConfigured && (
                          <button
                            onClick={() => void handleProviderClear(p.providerName)}
                            className="px-3 py-1.5 rounded border border-red-800 text-red-400 hover:bg-red-900/30 text-xs transition-all"
                          >
                            Clear
                          </button>
                        )}
                      </div>

                      {testResult && (
                        <div className={`text-xs px-2 py-1.5 rounded ${testResult.success ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                          {testResult.success ? `OK -- ${testResult.latencyMs}ms` : `Failed${testResult.error ? `: ${testResult.error}` : ''}`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
          </div>
        )}

        {activeTab === 'access' && (
          <AccessRequestsPanel
            requests={researcherRequests}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        )}

        {activeTab === 'users' && (
          <div className="space-y-6">
            {/* Users */}
            <CollapsibleSection id="users" title="Users" subtitle="Manage registered accounts and assign roles">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-text-muted">
                      <th className="pb-2 pr-4 font-medium">Username</th>
                      <th className="pb-2 pr-4 font-medium">Email</th>
                      <th className="pb-2 pr-4 font-medium">Clerk ID</th>
                      <th className="pb-2 pr-4 font-medium">Role</th>
                      <th className="pb-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {userList.length === 0 && (
                      <tr><td colSpan={5} className="py-4 text-text-muted text-center">No users registered yet</td></tr>
                    )}
                    {userList.map((u) => (
                      <tr key={u.id} className="hover:bg-surface-2 transition-colors">
                        <td className="py-2 pr-4 font-mono text-xs">{u.username || '\u2014'}</td>
                        <td className="py-2 pr-4">{u.email || '\u2014'}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-text-muted">{u.clerkUserId ? u.clerkUserId.slice(0, 16) + '\u2026' : '\u2014'}</td>
                        <td className="py-2 pr-4">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            u.role === 'researcher' ? 'bg-blue-900/40 text-blue-300'
                            : 'bg-surface-2 text-text-muted'
                          }`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="py-2">
                          <button
                            disabled={userRoleSaving === u.id}
                            onClick={async () => {
                              const newRole = u.role === 'researcher' ? 'user' : 'researcher';
                              setUserRoleSaving(u.id);
                              try {
                                await adminApi.setUserRole(u.id, newRole);
                                setUserList((prev) => prev.map((x) => x.id === u.id ? { ...x, role: newRole } : x));
                                flash(`${u.username || u.id} is now ${newRole}`);
                              } catch (err) { console.error('[ADMIN] setUserRole failed:', err); flash('Failed to update role'); }
                              finally { setUserRoleSaving(null); }
                            }}
                            className="text-xs px-3 py-1 rounded border border-border hover:bg-surface-2 transition-colors disabled:opacity-50"
                          >
                            {userRoleSaving === u.id ? 'Saving\u2026' : u.role === 'researcher' ? 'Revoke researcher' : 'Grant researcher'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          </div>
        )}

        {activeTab === 'database' && (
          <div className="space-y-6">
            {/* Database */}
            <CollapsibleSection id="database" title="Database">
              <div className="flex items-center gap-4">
                <AdminButton onClick={handleReseed} variant="danger">
                  {reseedConfirm ? 'Confirm? Click again to wipe all data' : 'Reseed Database'}
                </AdminButton>
                <span className="text-xs text-text-muted">Truncates all tables and restores the 10-agent seed state.</span>
              </div>
            </CollapsibleSection>
          </div>
        )}

        {activeTab === 'experiments' && (
          <div className="space-y-6">
            <div>
              <h2 className="font-serif text-stone text-xl font-semibold">Experiments</h2>
              <p className="text-text-muted text-sm mt-1">Export raw simulation data as CSV for analysis.</p>
            </div>

            {exportError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                Export failed: {exportError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {([
                { dataset: 'agent-decisions', filename: 'agent-decisions.csv', label: 'Agent Decisions', description: 'Every AI decision: action, reasoning, provider, latency.' },
                { dataset: 'approval-events', filename: 'approval-events.csv', label: 'Approval Events', description: 'Full audit trail of every approval rating change by event type.' },
                { dataset: 'bills', filename: 'bills.csv', label: 'Bills', description: 'All legislation: sponsor, committee, status, and timestamps.' },
                { dataset: 'bill-votes', filename: 'bill-votes.csv', label: 'Bill Votes', description: 'How each agent voted on every bill.' },
                { dataset: 'laws', filename: 'laws.csv', label: 'Laws', description: 'All enacted laws with enactment date and active status.' },
                { dataset: 'elections', filename: 'elections.csv', label: 'Elections & Campaigns', description: 'Election results joined with candidate campaign data.' },
                { dataset: 'agents', filename: 'agents-snapshot.csv', label: 'Agent Snapshot', description: 'Current state of all agents: alignment, provider, balance, approval.' },
              ] as const).map(({ dataset, filename, label, description }) => {
                const countKey = EXPORT_KEY_MAP[dataset];
                const rowCount = exportCounts ? exportCounts[countKey] : null;
                return (
                  <div key={dataset} className="rounded-lg border border-border bg-surface p-5 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-text-primary">{label}</p>
                        <p className="text-text-muted text-xs mt-0.5">{description}</p>
                      </div>
                      {rowCount !== null && rowCount !== undefined && (
                        <span className="badge border border-border/40 text-text-muted bg-border/10 whitespace-nowrap shrink-0">
                          {rowCount.toLocaleString()} rows
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => void handleExport(dataset, filename)}
                      disabled={exportingDataset !== null}
                      className="mt-auto px-4 py-2 rounded text-sm font-medium transition-all bg-white/10 text-text-primary hover:bg-white/20 border border-border disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {exportingDataset === dataset ? (
                        <>
                          <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          Exporting...
                        </>
                      ) : (
                        'Download CSV'
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'agge' && (
          <div className="space-y-6">
            <div>
              <h2 className="font-serif text-stone text-xl font-semibold">AGGE (God Agent)</h2>
              <p className="text-text-muted text-sm mt-1">Configure and monitor the Autonomous Government Game Engine.</p>
            </div>

            {/* Inference Config */}
            {simConfig && (
              <CollapsibleSection id="agge_inference" title="Inference Config" badge={savingBadge}>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-secondary">Inference URL</label>
                    <select
                      value={allUrlPresets.find((p) => p.url === simConfig.aggeInferenceUrl)?.url ?? 'custom'}
                      onChange={(e) => {
                        const preset = allUrlPresets.find((p) => p.url === e.target.value);
                        const newUrl = preset ? preset.url : '';
                        const modelPatch = preset?.model ? { aggeInferenceModel: preset.model } : {};
                        setSimConfig((c) => c ? { ...c, aggeInferenceUrl: newUrl, ...modelPatch } : c);
                        void saveConfig({ aggeInferenceUrl: newUrl, ...modelPatch });
                        void fetchAggeModels(newUrl || undefined);
                      }}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                    >
                      {allUrlPresets.map((p) => (
                        <option key={p.url} value={p.url} className="bg-surface">{p.label}</option>
                      ))}
                      <option value="custom" className="bg-surface">Custom</option>
                    </select>
                    <input
                      type="text"
                      value={simConfig.aggeInferenceUrl ?? ''}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, aggeInferenceUrl: e.target.value } : c)}
                      onBlur={() => { void saveConfig({ aggeInferenceUrl: simConfig.aggeInferenceUrl }); void fetchAggeModels(simConfig.aggeInferenceUrl || undefined); }}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-gold/50"
                      placeholder="http://localhost:8000/v1"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-secondary">Model Name</label>
                    {aggeModels.length > 0 && !aggeModelsFailed ? (
                      <select
                        value={simConfig.aggeInferenceModel ?? ''}
                        onChange={(e) => {
                          setSimConfig((c) => c ? { ...c, aggeInferenceModel: e.target.value } : c);
                          void saveConfig({ aggeInferenceModel: e.target.value });
                        }}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      >
                        <option value="" className="bg-surface">Select a model</option>
                        {aggeModels.map((m) => (
                          <option key={m} value={m} className="bg-surface">{m}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={simConfig.aggeInferenceModel ?? ''}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, aggeInferenceModel: e.target.value } : c)}
                        onBlur={() => void saveConfig({ aggeInferenceModel: simConfig.aggeInferenceModel })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-gold/50"
                        placeholder="meta-llama/Llama-3.1-8B-Instruct"
                      />
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Temperature</label>
                      <span className="text-sm text-gold font-mono">{simConfig.aggeTemperature?.toFixed(2) ?? '1.00'}</span>
                    </div>
                    <input
                      type="range" min={50} max={200} step={5}
                      value={Math.round((simConfig.aggeTemperature ?? 1) * 100)}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, aggeTemperature: parseInt(e.target.value) / 100 } : c)}
                      onMouseUp={() => void saveConfig({ aggeTemperature: simConfig.aggeTemperature })}
                      onTouchEnd={() => void saveConfig({ aggeTemperature: simConfig.aggeTemperature })}
                      className="w-full accent-gold"
                    />
                    <p className="text-xs text-text-muted">Controls randomness of AGGE decisions (0.50 - 2.00).</p>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Timing */}
            {simConfig && (
              <CollapsibleSection id="agge_timing" title="Timing" badge={savingBadge}>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">AGGE Tick Interval</label>
                      <span className="text-sm text-gold font-mono">{msToLabel(simConfig.aggeTickIntervalMs ?? 3600000)}</span>
                    </div>
                    <div className="flex gap-2">
                      <select
                        value={(simConfig.aggeTickIntervalMs ?? 3600000) >= 60000 && (simConfig.aggeTickIntervalMs ?? 3600000) < 3600000 && (simConfig.aggeTickIntervalMs ?? 3600000) % 60000 === 0 ? (simConfig.aggeTickIntervalMs ?? 3600000) : ''}
                        onChange={(e) => { if (e.target.value) void saveConfig({ aggeTickIntervalMs: Number(e.target.value) }); }}
                        className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                      >
                        <option value="">Minutes</option>
                        {[5,10,15,20,30,45].map((m) => <option key={m} value={m*60000}>{m}m</option>)}
                      </select>
                      <select
                        value={(simConfig.aggeTickIntervalMs ?? 3600000) >= 3600000 && (simConfig.aggeTickIntervalMs ?? 3600000) < 86400000 && (simConfig.aggeTickIntervalMs ?? 3600000) % 3600000 === 0 ? (simConfig.aggeTickIntervalMs ?? 3600000) : ''}
                        onChange={(e) => { if (e.target.value) void saveConfig({ aggeTickIntervalMs: Number(e.target.value) }); }}
                        className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                      >
                        <option value="">Hours</option>
                        {Array.from({length:11},(_,i)=>i+1).map((h) => <option key={h} value={h*3600000}>{h}h</option>)}
                      </select>
                      <select
                        value={(simConfig.aggeTickIntervalMs ?? 3600000) >= 86400000 && (simConfig.aggeTickIntervalMs ?? 3600000) % 86400000 === 0 ? (simConfig.aggeTickIntervalMs ?? 3600000) : ''}
                        onChange={(e) => { if (e.target.value) void saveConfig({ aggeTickIntervalMs: Number(e.target.value) }); }}
                        className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-gold/50"
                      >
                        <option value="">Days</option>
                        {[1,2,3,5,7].map((d) => <option key={d} value={d*86400000}>{d}d</option>)}
                      </select>
                    </div>
                    <p className="text-xs text-text-muted">How often AGGE evaluates and intervenes in the simulation.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-text-secondary">Agents Per Tick (Min)</label>
                      <input
                        type="number" min={1} max={5}
                        value={simConfig.aggeAgentsPerTickMin ?? 1}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(5, parseInt(e.target.value) || 1));
                          setSimConfig((c) => c ? { ...c, aggeAgentsPerTickMin: v } : c);
                        }}
                        onBlur={() => void saveConfig({ aggeAgentsPerTickMin: simConfig.aggeAgentsPerTickMin })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-text-secondary">Agents Per Tick (Max)</label>
                      <input
                        type="number" min={1} max={10}
                        value={simConfig.aggeAgentsPerTickMax ?? 3}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
                          setSimConfig((c) => c ? { ...c, aggeAgentsPerTickMax: v } : c);
                        }}
                        onBlur={() => void saveConfig({ aggeAgentsPerTickMax: simConfig.aggeAgentsPerTickMax })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Controls */}
            <CollapsibleSection id="agge_controls" title="Controls">
              {/* Mode indicator */}
              <div className="mb-4 flex items-center gap-2">
                <span className="text-xs text-text-muted uppercase tracking-widest">Active driver:</span>
                {aggeMode === null ? (
                  <span className="text-xs text-text-muted">checking…</span>
                ) : aggeMode === 'both' ? (
                  <span className="px-2 py-0.5 rounded text-xs font-mono bg-gold/10 text-gold border border-gold/30">Bob (Openclaw) + AGGE auto-tick</span>
                ) : aggeMode === 'bob' ? (
                  <span className="px-2 py-0.5 rounded text-xs font-mono bg-gold/10 text-gold border border-gold/30">Bob (Openclaw)</span>
                ) : aggeMode === 'agge' ? (
                  <span className="px-2 py-0.5 rounded text-xs font-mono bg-white/5 text-text-secondary border border-border">AGGE auto-tick</span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-xs font-mono bg-white/5 text-text-muted border border-border">None (manual tick only)</span>
                )}
              </div>

              <div className="space-y-3">
                {/* AGGE auto-tick enable */}
                <div className="flex items-center justify-between py-2 border-b border-border/50">
                  <div>
                    <label className="text-sm font-medium text-text-secondary">AGGE Auto-Tick</label>
                    <p className="text-xs text-text-muted">Runs AGGE on its own interval, independent of Bob/BOB_ORCHESTRATOR_KEY.</p>
                  </div>
                  <button
                    onClick={() => {
                      const next = !simConfig?.aggeEnabled;
                      setSimConfig((c) => c ? { ...c, aggeEnabled: next } : c);
                      void saveConfig({ aggeEnabled: next });
                      void fetchAggeMode();
                    }}
                    className={`relative w-12 h-6 rounded-full transition-colors ${simConfig?.aggeEnabled ? 'bg-gold/60' : 'bg-white/20'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${simConfig?.aggeEnabled ? 'translate-x-6' : ''}`} />
                  </button>
                </div>

                {/* AGGE direct tick — always available */}
                <div>
                  <AdminButton
                    onClick={async () => {
                      setAggeTriggering(true);
                      try {
                        await adminApi.godTick();
                        flash('AGGE personality tick queued');
                        void fetchAggeInterventions();
                      } catch (err) {
                        console.error('[ADMIN] godTick failed:', err);
                        flash('AGGE tick failed');
                      } finally {
                        setAggeTriggering(false);
                      }
                    }}
                    disabled={aggeTriggering}
                    variant="gold"
                  >
                    {aggeTriggering ? 'Queuing...' : 'Force AGGE Personality Tick'}
                  </AdminButton>
                  <p className="text-xs text-text-muted mt-1">
                    Directly queues a personality-mod job via the Bull worker — picks {simConfig?.aggeAgentsPerTickMin ?? 1}–{simConfig?.aggeAgentsPerTickMax ?? 3} agents and calls the inference endpoint. Works regardless of Bob mode.
                  </p>
                </div>

                {/* Bob observe — only useful when Bob mode is active */}
                {aggeMode === 'bob' && (
                  <div>
                    <AdminButton
                      onClick={async () => {
                        setBobChecking(true);
                        try {
                          const res = await adminApi.godBobPing() as { success: boolean; agentCount?: number; lastTickDuration?: number | null; errorRate?: number; error?: string };
                          if (res?.success) {
                            const dur = res.lastTickDuration;
                            const durStr = dur != null ? `${(dur / 1000).toFixed(1)}s` : 'n/a';
                            flash(`Bob observe OK — ${res.agentCount ?? 0} agents, last tick ${durStr}`);
                          } else {
                            flash(res.error ?? 'Bob observe failed');
                          }
                        } catch (err) {
                          console.error('[ADMIN] orchestratorObserve failed:', err);
                          flash('Bob observe failed — check server logs');
                        } finally {
                          setBobChecking(false);
                        }
                      }}
                      disabled={bobChecking}
                      variant="default"
                    >
                      {bobChecking ? 'Checking...' : 'Bob: Test Observe Endpoint'}
                    </AdminButton>
                    <p className="text-xs text-text-muted mt-1">
                      Calls the orchestrator observe endpoint that Bob uses. Confirms the API is reachable and returns a status flash with agent count and last tick duration.
                    </p>
                  </div>
                )}

                <AdminButton onClick={() => void fetchAggeInterventions()} variant="default">
                  Refresh Interventions
                </AdminButton>
              </div>
            </CollapsibleSection>

            {/* Recent Interventions */}
            <CollapsibleSection id="agge_interventions" title={`Recent Interventions (${aggeInterventions.length})`}>
              <div className="rounded-lg border border-border overflow-hidden">
                {aggeInterventions.length === 0 ? (
                  <p className="p-4 text-text-muted text-sm">No AGGE interventions recorded yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border">
                        <tr>
                          <th className="text-left px-4 py-2 text-text-muted font-normal">Agent</th>
                          <th className="text-left px-4 py-2 text-text-muted font-normal">Action</th>
                          <th className="text-left px-4 py-2 text-text-muted font-normal">Previous Mod</th>
                          <th className="text-left px-4 py-2 text-text-muted font-normal">New Mod</th>
                          <th className="text-left px-4 py-2 text-text-muted font-normal">Reasoning</th>
                          <th className="text-left px-4 py-2 text-text-muted font-normal">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aggeInterventions.slice(0, 20).map((iv) => (
                          <tr key={iv.id} className="border-b border-border/50 last:border-0">
                            <td className="px-4 py-3 text-text-primary whitespace-nowrap">{iv.agentId.slice(0, 8)}</td>
                            <td className="px-4 py-3 text-text-secondary">{iv.action}</td>
                            <td className="px-4 py-3 text-text-muted">{iv.previousMod ?? '-'}</td>
                            <td className="px-4 py-3 text-text-secondary">{iv.newMod ?? '-'}</td>
                            <td className="px-4 py-3 text-text-muted max-w-xs truncate">{iv.reasoning}</td>
                            <td className="px-4 py-3 text-text-muted whitespace-nowrap">
                              {new Date(iv.createdAt).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </CollapsibleSection>
          </div>
        )}

        {activeTab === 'weights' && simConfig && (
          <div className="space-y-6">
            <div>
              <h2 className="font-serif text-stone text-xl font-semibold">Dynamic Weights</h2>
              <p className="text-text-muted text-sm mt-1">Fine-tune simulation engine weights and thresholds.</p>
            </div>

            {/* Relationship & Forum */}
            <CollapsibleSection id="weights_forum" title="Relationship & Forum" badge={savingBadge}>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">Relationship Decay Rate</label>
                    <span className="text-sm text-gold font-mono">{(simConfig.relationshipDecayRate ?? 0.05).toFixed(2)}</span>
                  </div>
                  <input type="range" min="0" max="0.2" step="0.01"
                    value={simConfig.relationshipDecayRate ?? 0.05}
                    onChange={(e) => setSimConfig((c) => c ? { ...c, relationshipDecayRate: Number(e.target.value) } : c)}
                    onMouseUp={() => void saveConfig({ relationshipDecayRate: simConfig.relationshipDecayRate })}
                    onTouchEnd={() => void saveConfig({ relationshipDecayRate: simConfig.relationshipDecayRate })}
                    className="w-full accent-gold" />
                  <p className="text-xs text-text-muted">Per-tick decay of relationship scores toward neutral.</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">Forum Interaction Sentiment Bonus</label>
                    <span className="text-sm text-gold font-mono">{(simConfig.forumInteractionSentimentBonus ?? 0.02).toFixed(3)}</span>
                  </div>
                  <input type="range" min="0" max="0.1" step="0.005"
                    value={simConfig.forumInteractionSentimentBonus ?? 0.02}
                    onChange={(e) => setSimConfig((c) => c ? { ...c, forumInteractionSentimentBonus: Number(e.target.value) } : c)}
                    onMouseUp={() => void saveConfig({ forumInteractionSentimentBonus: simConfig.forumInteractionSentimentBonus })}
                    onTouchEnd={() => void saveConfig({ forumInteractionSentimentBonus: simConfig.forumInteractionSentimentBonus })}
                    className="w-full accent-gold" />
                  <p className="text-xs text-text-muted">Bonus per forum reply between agents.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-text-secondary">Forum Base Silence Weight</label>
                    <input type="number" min="0" max="10" step="0.5"
                      value={simConfig.forumBaseSilenceWeight ?? 1}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, forumBaseSilenceWeight: Number(e.target.value) } : c)}
                      onBlur={() => void saveConfig({ forumBaseSilenceWeight: simConfig.forumBaseSilenceWeight })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-text-secondary">Forum Decay Half-Life (ticks)</label>
                    <input type="number" min="1" max="20" step="1"
                      value={simConfig.forumDecayHalfLifeTicks ?? 5}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, forumDecayHalfLifeTicks: Number(e.target.value) } : c)}
                      onBlur={() => void saveConfig({ forumDecayHalfLifeTicks: simConfig.forumDecayHalfLifeTicks })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-text-secondary">Silence Pressure Threshold</label>
                    <input type="number" min="1" max="20" step="1"
                      value={simConfig.forumSilencePressureThreshold ?? 3}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, forumSilencePressureThreshold: Number(e.target.value) } : c)}
                      onBlur={() => void saveConfig({ forumSilencePressureThreshold: simConfig.forumSilencePressureThreshold })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-text-secondary">Max Posts / Agent / Tick</label>
                    <input type="number" min="1" max="10" step="1"
                      value={simConfig.maxForumPostsPerAgentPerTick ?? 2}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, maxForumPostsPerAgentPerTick: Number(e.target.value) } : c)}
                      onBlur={() => void saveConfig({ maxForumPostsPerAgentPerTick: simConfig.maxForumPostsPerAgentPerTick })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-text-secondary">Max Posts / Tick</label>
                    <input type="number" min="1" max="50" step="1"
                      value={simConfig.maxForumPostsPerTick ?? 10}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, maxForumPostsPerTick: Number(e.target.value) } : c)}
                      onBlur={() => void saveConfig({ maxForumPostsPerTick: simConfig.maxForumPostsPerTick })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-text-secondary">Max Replies / Tick</label>
                    <input type="number" min="1" max="50" step="1"
                      value={simConfig.maxForumRepliesPerTick ?? 10}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, maxForumRepliesPerTick: Number(e.target.value) } : c)}
                      onBlur={() => void saveConfig({ maxForumRepliesPerTick: simConfig.maxForumRepliesPerTick })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50" />
                  </div>
                </div>
              </div>
            </CollapsibleSection>

            {/* Dynamic Weights */}
            <CollapsibleSection id="weights_dw" title="Economy & Judiciary Weights" badge={savingBadge}>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">Treasury Crisis Threshold</label>
                    <span className="text-sm text-gold font-mono">{(simConfig.treasuryCrisisThreshold ?? 0.2).toFixed(2)}</span>
                  </div>
                  <input type="range" min="0" max="0.5" step="0.05"
                    value={simConfig.treasuryCrisisThreshold ?? 0.2}
                    onChange={(e) => setSimConfig((c) => c ? { ...c, treasuryCrisisThreshold: Number(e.target.value) } : c)}
                    onMouseUp={() => void saveConfig({ treasuryCrisisThreshold: simConfig.treasuryCrisisThreshold })}
                    onTouchEnd={() => void saveConfig({ treasuryCrisisThreshold: simConfig.treasuryCrisisThreshold })}
                    className="w-full accent-gold" />
                  <p className="text-xs text-text-muted">Fraction of seed treasury that triggers a fiscal crisis.</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">Economy Proposal Multiplier (Crisis)</label>
                    <span className="text-sm text-gold font-mono">{(simConfig.economyProposalMultiplierCrisis ?? 1.5).toFixed(1)}</span>
                  </div>
                  <input type="range" min="1" max="3" step="0.1"
                    value={simConfig.economyProposalMultiplierCrisis ?? 1.5}
                    onChange={(e) => setSimConfig((c) => c ? { ...c, economyProposalMultiplierCrisis: Number(e.target.value) } : c)}
                    onMouseUp={() => void saveConfig({ economyProposalMultiplierCrisis: simConfig.economyProposalMultiplierCrisis })}
                    onTouchEnd={() => void saveConfig({ economyProposalMultiplierCrisis: simConfig.economyProposalMultiplierCrisis })}
                    className="w-full accent-gold" />
                  <p className="text-xs text-text-muted">Bill proposal boost during fiscal crisis.</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">Judicial Contestation Bonus</label>
                    <span className="text-sm text-gold font-mono">{(simConfig.judicialContestationBonus ?? 1.5).toFixed(1)}</span>
                  </div>
                  <input type="range" min="1" max="5" step="0.1"
                    value={simConfig.judicialContestationBonus ?? 1.5}
                    onChange={(e) => setSimConfig((c) => c ? { ...c, judicialContestationBonus: Number(e.target.value) } : c)}
                    onMouseUp={() => void saveConfig({ judicialContestationBonus: simConfig.judicialContestationBonus })}
                    onTouchEnd={() => void saveConfig({ judicialContestationBonus: simConfig.judicialContestationBonus })}
                    className="w-full accent-gold" />
                  <p className="text-xs text-text-muted">Weight boost for contested judicial challenges.</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">Judicial Recency Bonus</label>
                    <span className="text-sm text-gold font-mono">{(simConfig.judicialRecencyBonus ?? 1.5).toFixed(1)}</span>
                  </div>
                  <input type="range" min="1" max="5" step="0.1"
                    value={simConfig.judicialRecencyBonus ?? 1.5}
                    onChange={(e) => setSimConfig((c) => c ? { ...c, judicialRecencyBonus: Number(e.target.value) } : c)}
                    onMouseUp={() => void saveConfig({ judicialRecencyBonus: simConfig.judicialRecencyBonus })}
                    onTouchEnd={() => void saveConfig({ judicialRecencyBonus: simConfig.judicialRecencyBonus })}
                    className="w-full accent-gold" />
                  <p className="text-xs text-text-muted">Weight boost for recent judicial challenges.</p>
                </div>

                <div className="flex items-center justify-between py-2 border-t border-border/50">
                  <div>
                    <label className="text-sm font-medium text-text-secondary">Election Post-Outcome Cascade</label>
                    <p className="text-xs text-text-muted">Trigger relationship cascades after election results.</p>
                  </div>
                  <button
                    onClick={() => {
                      const next = !simConfig.electionPostOutcomeCascade;
                      setSimConfig((c) => c ? { ...c, electionPostOutcomeCascade: next } : c);
                      void saveConfig({ electionPostOutcomeCascade: next });
                    }}
                    className={`relative w-12 h-6 rounded-full transition-colors ${simConfig.electionPostOutcomeCascade ? 'bg-gold/60' : 'bg-white/20'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${simConfig.electionPostOutcomeCascade ? 'translate-x-6' : ''}`} />
                  </button>
                </div>
              </div>
            </CollapsibleSection>

            {/* Approval & AGGE */}
            <CollapsibleSection id="weights_approval" title="Approval & AGGE" badge={savingBadge}>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">Approval Decay Target</label>
                    <span className="text-sm text-gold font-mono">{simConfig.approvalDecayTarget ?? 50}</span>
                  </div>
                  <input type="range" min="0" max="100" step="5"
                    value={simConfig.approvalDecayTarget ?? 50}
                    onChange={(e) => setSimConfig((c) => c ? { ...c, approvalDecayTarget: Number(e.target.value) } : c)}
                    onMouseUp={() => void saveConfig({ approvalDecayTarget: simConfig.approvalDecayTarget })}
                    onTouchEnd={() => void saveConfig({ approvalDecayTarget: simConfig.approvalDecayTarget })}
                    className="w-full accent-gold" />
                  <p className="text-xs text-text-muted">Target approval rating that scores decay toward.</p>
                </div>

                <div className="flex items-center justify-between py-2 border-t border-border/50">
                  <div>
                    <label className="text-sm font-medium text-text-secondary">Approval in System Prompt</label>
                    <p className="text-xs text-text-muted">Inject approval rating into agent system prompts.</p>
                  </div>
                  <button
                    onClick={() => {
                      const next = !simConfig.approvalInSystemPrompt;
                      setSimConfig((c) => c ? { ...c, approvalInSystemPrompt: next } : c);
                      void saveConfig({ approvalInSystemPrompt: next });
                    }}
                    className={`relative w-12 h-6 rounded-full transition-colors ${simConfig.approvalInSystemPrompt ? 'bg-gold/60' : 'bg-white/20'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${simConfig.approvalInSystemPrompt ? 'translate-x-6' : ''}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between py-2 border-t border-border/50">
                  <div>
                    <label className="text-sm font-medium text-text-secondary">AGGE Evolution Pressure Weighted</label>
                    <p className="text-xs text-text-muted">Use weighted selection by trauma/elections/defection in AGGE.</p>
                  </div>
                  <button
                    onClick={() => {
                      const next = !simConfig.aggeEvolutionPressureWeighted;
                      setSimConfig((c) => c ? { ...c, aggeEvolutionPressureWeighted: next } : c);
                      void saveConfig({ aggeEvolutionPressureWeighted: next });
                    }}
                    className={`relative w-12 h-6 rounded-full transition-colors ${simConfig.aggeEvolutionPressureWeighted ? 'bg-gold/60' : 'bg-white/20'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${simConfig.aggeEvolutionPressureWeighted ? 'translate-x-6' : ''}`} />
                  </button>
                </div>
              </div>
            </CollapsibleSection>
          </div>
        )}

        {activeTab === 'health' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-stone text-xl font-semibold">Simulation Health</h2>
              <AdminButton onClick={() => void fetchHealth()} variant="default">Refresh</AdminButton>
            </div>

            {/* Tick Timing */}
            <CollapsibleSection id="health_ticks" title={`Tick Timing (last ${healthTicks.length})`}>
              <p className="text-xs text-text-muted mb-2">
                Current tick interval: <span className="text-gold font-mono">{simConfig?.tickIntervalMs ? `${simConfig.tickIntervalMs}ms` : '—'}</span>
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 text-text-muted text-left text-xs uppercase tracking-wider">
                      <th className="px-4 py-2">Fired At</th>
                      <th className="px-4 py-2">Completed At</th>
                      <th className="px-4 py-2">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {healthTicks.length === 0 ? (
                      <tr><td colSpan={3} className="px-4 py-6 text-center text-text-muted">No tick data yet</td></tr>
                    ) : healthTicks.map((t) => (
                      <tr key={t.id} className="border-b border-border/50 last:border-0">
                        <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{new Date(t.firedAt).toLocaleTimeString()}</td>
                        <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{t.completedAt ? new Date(t.completedAt).toLocaleTimeString() : '—'}</td>
                        <td className={`px-4 py-3 font-mono whitespace-nowrap ${t.durationMs != null && t.durationMs > 120000 ? 'text-red-400 font-bold' : 'text-text-primary'}`}>
                          {t.durationMs != null ? `${t.durationMs.toLocaleString()}ms` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>

            {/* LLM Latency */}
            <CollapsibleSection id="health_latency" title="LLM Latency">
              {healthLatency ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {(['avg', 'p50', 'p95', 'p99'] as const).map((k) => (
                      <div key={k} className="bg-surface-secondary rounded-lg p-3">
                        <div className="text-xs text-text-muted uppercase">{k}</div>
                        <div className="text-lg font-mono text-gold">{Math.round(healthLatency[k])}ms</div>
                      </div>
                    ))}
                    <div className="bg-surface-secondary rounded-lg p-3">
                      <div className="text-xs text-text-muted uppercase">Decisions</div>
                      <div className="text-lg font-mono text-text-primary">{healthLatency.count.toLocaleString()}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* By Provider */}
                    <div>
                      <h4 className="text-sm text-text-muted uppercase tracking-wider mb-2">By Provider</h4>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/50 text-text-muted text-left text-xs uppercase tracking-wider">
                            <th className="px-3 py-2">Provider</th>
                            <th className="px-3 py-2">Avg</th>
                            <th className="px-3 py-2">Count</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(healthLatency.byProvider).map(([name, v]) => (
                            <tr key={name} className="border-b border-border/50 last:border-0">
                              <td className="px-3 py-2 text-text-primary">{name}</td>
                              <td className="px-3 py-2 font-mono text-gold">{Math.round(v.avg)}ms</td>
                              <td className="px-3 py-2 font-mono text-text-muted">{v.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* By Phase */}
                    <div>
                      <h4 className="text-sm text-text-muted uppercase tracking-wider mb-2">By Phase</h4>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/50 text-text-muted text-left text-xs uppercase tracking-wider">
                            <th className="px-3 py-2">Phase</th>
                            <th className="px-3 py-2">Avg</th>
                            <th className="px-3 py-2">Count</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(healthLatency.byPhase).map(([name, v]) => (
                            <tr key={name} className="border-b border-border/50 last:border-0">
                              <td className="px-3 py-2 text-text-primary">{name}</td>
                              <td className="px-3 py-2 font-mono text-gold">{Math.round(v.avg)}ms</td>
                              <td className="px-3 py-2 font-mono text-text-muted">{v.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-text-muted text-sm">No latency data available</p>
              )}
            </CollapsibleSection>

            {/* Error Rate */}
            <CollapsibleSection id="health_errors" title="Error Rate (24h)">
              {healthErrors ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-surface-secondary rounded-lg p-3">
                      <div className="text-xs text-text-muted uppercase">Total Decisions</div>
                      <div className="text-lg font-mono text-text-primary">{healthErrors.total.toLocaleString()}</div>
                    </div>
                    <div className="bg-surface-secondary rounded-lg p-3">
                      <div className="text-xs text-text-muted uppercase">Errors</div>
                      <div className={`text-lg font-mono ${healthErrors.errors > 0 ? 'text-red-400' : 'text-green-400'}`}>{healthErrors.errors.toLocaleString()}</div>
                    </div>
                    <div className="bg-surface-secondary rounded-lg p-3">
                      <div className="text-xs text-text-muted uppercase">Error Rate</div>
                      <div className={`text-lg font-mono ${healthErrors.rate > 5 ? 'text-red-400' : healthErrors.rate > 1 ? 'text-yellow-400' : 'text-green-400'}`}>
                        {healthErrors.rate.toFixed(2)}%
                      </div>
                    </div>
                  </div>

                  {Object.keys(healthErrors.byPhase).length > 0 && (
                    <div>
                      <h4 className="text-sm text-text-muted uppercase tracking-wider mb-2">Errors by Phase</h4>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/50 text-text-muted text-left text-xs uppercase tracking-wider">
                            <th className="px-3 py-2">Phase</th>
                            <th className="px-3 py-2">Errors</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(healthErrors.byPhase).map(([phase, count]) => (
                            <tr key={phase} className="border-b border-border/50 last:border-0">
                              <td className="px-3 py-2 text-text-primary">{phase}</td>
                              <td className="px-3 py-2 font-mono text-red-400">{count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-text-muted text-sm">No error data available</p>
              )}
            </CollapsibleSection>
          </div>
        )}

        {logsDrawerOpen && (
          <LogsDrawer
            entries={logEntries}
            activeTab={activeLogTab}
            onTabChange={setActiveLogTab}
            onClose={() => setLogsDrawerOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
