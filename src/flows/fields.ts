import { readElementFacts } from '../browser/element.js';
import type { ElementFacts, ProposedAction } from '../browser/guard.js';
import type { FlowContext } from './context.js';

export type FieldKind =
  'email' | 'password' | 'name' | 'text' | 'longtext' | 'checkbox' | 'submit' | 'other';

export interface Field {
  kind: FieldKind;
  action: ProposedAction;
  facts: ElementFacts;
  /** Short name for reports: the label, or the visible text. */
  label: string;
}

const TEXT_TYPES = new Set(['', 'text', 'search', 'tel', 'url', 'number']);

export function classify(facts: ElementFacts, action: ProposedAction): FieldKind {
  const hint = `${facts.name} ${facts.label}`.toLowerCase();
  if (facts.tag === 'textarea') return 'longtext';
  if (facts.tag === 'input') {
    if (facts.type === 'password') return 'password';
    if (facts.type === 'checkbox' || facts.type === 'radio') return 'checkbox';
    if (facts.type === 'submit' || facts.type === 'button' || facts.type === 'image')
      return 'submit';
    if (facts.type === 'email' || /e-?mail|username|user name|benutzername/.test(hint))
      return 'email';
    if (/\bname\b|vorname|nachname/.test(hint) && TEXT_TYPES.has(facts.type)) return 'name';
    return TEXT_TYPES.has(facts.type) ? 'text' : 'other';
  }
  if (facts.tag === 'button' || facts.tag === 'a') return 'submit';
  return (action.method ?? '').toLowerCase() === 'click' ? 'submit' : 'other';
}

/** Reads each element the AI pointed at and works out what kind of field it really is. */
export async function readFields(
  ctx: FlowContext,
  actions: readonly ProposedAction[],
): Promise<Field[]> {
  const fields: Field[] = [];
  const seen = new Set<string>();
  for (const action of actions) {
    if (seen.has(action.selector)) continue;
    seen.add(action.selector);
    const facts = await readElementFacts(ctx.page, action.selector);
    if (!facts) continue;
    const label = (
      facts.label.split(' | ')[0] ||
      facts.text ||
      facts.name ||
      action.description
    ).slice(0, 60);
    fields.push({ kind: classify(facts, action), action, facts, label });
  }
  return fields;
}

/** The same field, as an action that types the given value. */
export const fill = (field: Field, value: string): ProposedAction => ({
  ...field.action,
  method: 'fill',
  arguments: [value],
});

export const click = (field: Field): ProposedAction => ({
  ...field.action,
  method: 'click',
  arguments: [],
});

export const first = (fields: readonly Field[], kind: FieldKind): Field | undefined =>
  fields.find((field) => field.kind === kind);
