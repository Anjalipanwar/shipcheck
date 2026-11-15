import type { CoverageArea, Finding } from './schema.js';

/** The two groups of the "What this report covers" table, in table order. */
export const VISITOR_AREAS: readonly CoverageArea[] = [
  'signup',
  'login',
  'core',
  'forms',
  'phone-flows',
];
export const AUTOMATIC_AREAS: readonly CoverageArea[] = [
  'phone-layout',
  'errors',
  'links',
  'seo',
  'security',
  'accessibility',
];

const TOPICS = new Set<string>(['errors', 'seo', 'security', 'accessibility']);

/**
 * The table rows a finding counts under. Info notes are not problems and count nowhere. A
 * problem seen on both devices counts under its flow and under "Using it on a phone". Landing
 * page and speed findings have no row of their own.
 */
export function areasOf(
  finding: Pick<Finding, 'rule' | 'category' | 'flow' | 'device' | 'severity'>,
): CoverageArea[] {
  if (finding.severity === 'info') return [];
  if (finding.rule.startsWith('links/')) return ['links'];
  if (TOPICS.has(finding.category)) return [finding.category as CoverageArea];
  // Phone-only findings carry the flow "mobile": layout rules are automatic checks, the rest
  // was found while using the app on a phone.
  if (finding.flow === 'mobile') {
    return [finding.rule.startsWith('mobile/') ? 'phone-layout' : 'phone-flows'];
  }
  if (!finding.flow) return [];
  const own: CoverageArea[] = finding.flow === 'landing' ? [] : [finding.flow];
  if (finding.device === 'desktop') return own;
  return finding.device === 'mobile' ? ['phone-flows'] : [...own, 'phone-flows'];
}
