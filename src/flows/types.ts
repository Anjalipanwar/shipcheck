import type { Page } from 'playwright';
import type { AiDriver } from '../ai/driver.js';
import type { LlmBudget } from '../ai/budget.js';
import type { DeviceName } from '../browser/devices.js';
import type { Evidence } from '../browser/evidence.js';
import type { Config } from '../config.js';
import type { Finding, Flow as FlowName, Severity } from '../report/schema.js';

export type { FlowName };

/** Per-flow limit on actions (SPEC §7.4). */
export const MAX_FLOW_STEPS = 25;

/** A test account: given by the user, or created by the signup flow. */
export interface Account {
  email: string;
  password: string;
}

/**
 * One thing a flow checked, in a structured form (expected vs actual) so that the AI judge of
 * milestone M6 can reword and merge them. Until then, problems are turned into findings as is.
 */
export interface Observation {
  flow: FlowName;
  /** Machine-readable name, e.g. "login/no-error-on-wrong-password". */
  rule: string;
  ok: boolean;
  /** Plain-English headline: the finding title if not ok, the "what worked" line if ok. */
  title: string;
  expected: string;
  actual: string;
  severity: Severity;
  category: Finding['category'];
  whyItMatters: string;
  steps: string[];
  screenshots: string[];
  logs: string[];
  url: string;
  fixPrompt?: string;
  /** "verified" when measured in code, "ai-judgement" when the model's reading decided it. */
  confidence: Finding['confidence'];
}

export type FlowStatus = 'completed' | 'stopped' | 'skipped' | 'failed';

export interface FlowResult {
  name: FlowName;
  status: FlowStatus;
  observations: Observation[];
  /** Lines for "What we couldn't test". */
  notTested: string[];
  steps: number;
}

/** What flows share with each other during one run. */
export interface SharedState {
  account?: Account;
  loggedIn: boolean;
}

export interface FlowDeps {
  page: Page;
  device: DeviceName;
  config: Config;
  ai: AiDriver;
  evidence: Evidence;
  budget: LlmBudget;
  /** Point in time (ms) of the run's hard stop. */
  deadline: number;
  shared: SharedState;
  /** The address the run started on (after redirects). */
  homeUrl: string;
  /**
   * Test-only switch. Production code never sets it to false; the e2e suite does, to prove
   * that the network backstop alone keeps the trap counters at zero.
   */
  guardEnabled?: boolean;
}
