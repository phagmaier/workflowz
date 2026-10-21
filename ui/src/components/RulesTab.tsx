import { type FormEvent, useRef, useState } from "react";
import type { Session, SessionState } from "../editor-session.ts";
import { humanize, outcomeLabel } from "../lib/format.ts";
import { clone, type Doc, outcomesOf, type Problem, type Rule } from "../lib/workflow-edit.ts";
import { focusField } from "./editor-fields.tsx";
import { RuleDestination } from "./RuleDestination.tsx";

type Policy = NonNullable<Doc["policies"]>[number];
type Scope = "all" | "tags" | "step_ids";
const scopeOf = (p: Policy): Scope =>
  "tags" in p.match ? "tags" : "step_ids" in p.match ? "step_ids" : "all";

export function RulesTab({
  session,
  state,
  list,
}: {
  session: Session;
  state: SessionState;
  list: readonly Problem[];
}) {
  const doc = state.model as Doc;
  // Stable card identities keep inputs/focus when an earlier policy is deleted.
  const sequence = useRef((doc.policies ?? []).length);
  const [keys, setKeys] = useState(() => (doc.policies ?? []).map((_, i) => i));
  const change = (edit: (d: Doc) => void) =>
    session.edit((d) => {
      const next = clone(d);
      edit(next);
      return next;
    }, 400);
  const errors = list.filter((p) => p.place === "rules");
  return (
    <div className="rules-layout">
      <div className="rules-main">
        <section className="pane" aria-labelledby="shared-title">
          <div className="pane-head">
            <h2 id="shared-title" tabIndex={-1}>
              Shared rules
            </h2>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                const index = doc.policies?.length ?? 0;
                setKeys([...keys, sequence.current++]);
                change((d) => {
                  d.policies = [
                    ...(d.policies ?? []),
                    { match: { all: true }, on: { "system.error": { pause: true } } },
                  ];
                });
                focusField(`policy-${index}-scope`);
              }}
            >
              ＋ Add shared rule
            </button>
          </div>
          <p className="muted">
            Choose which steps a rule covers, then what happens after a result. A tag selector
            matches any of its tags.
          </p>
          <p className="hint">
            Exact result rules take priority over “any technical failure”. Within each: step rule →
            named steps → tags → all steps → workflow defaults. Conflicting rules at the same level
            need fixing.
          </p>
          {(doc.policies ?? []).map((policy, index) => (
            <PolicyCard
              key={keys[index] ?? index}
              policy={policy}
              index={index}
              doc={doc}
              session={session}
              onChange={(nextDoc, nextPolicy) =>
                session.edit(() => {
                  const next = clone(nextDoc);
                  if (next.policies) next.policies[index] = nextPolicy;
                  return next;
                }, 400)
              }
              onRemove={() => {
                setKeys(keys.filter((_, i) => i !== index));
                change((d) => {
                  d.policies = d.policies?.filter((_, i) => i !== index);
                  if (!d.policies?.length) delete d.policies;
                });
                focusField(index > 0 ? `policy-${index - 1}-scope` : "shared-title");
              }}
            />
          ))}
          {!doc.policies?.length ? (
            <p className="muted">
              No shared rules yet. Each step can still set its own destinations.
            </p>
          ) : null}
        </section>
        <section className="pane" aria-labelledby="defaults-title">
          <h2 id="defaults-title">Workflow defaults</h2>
          <p className="muted">
            Used when no step or shared rule chooses a destination. Unrouted technical failures
            pause.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={(doc.defaults?.report_correction_attempts ?? 1) === 1}
              onChange={(e) =>
                change((d) => {
                  d.defaults = {
                    ...d.defaults,
                    report_correction_attempts: e.target.checked ? 1 : 0,
                  };
                })
              }
            />
            Ask the agent once for its report
          </label>
          <p className="hint">
            After clean execution without a valid report, ask once in the exact same session if the
            harness supports it. Technical execution failures bypass this correction. The agent must
            report one of the step’s declared results.
          </p>
          <RuleList
            id="defaults"
            doc={doc}
            rules={doc.defaults?.on ?? {}}
            session={session}
            onChange={(nextDoc, on) =>
              session.edit(() => ({ ...nextDoc, defaults: { ...nextDoc.defaults, on } }), 400)
            }
          />
        </section>
      </div>
      <aside className="pane rules-side" aria-labelledby="limits-title">
        <h2 id="limits-title" tabIndex={-1}>
          Safety limits
        </h2>
        <p className="hint">
          Leave empty for no limit. Reaching a step or wall time limit pauses the run. These limits
          do not undo file changes.
        </p>
        {(
          [
            [
              "max_step_executions",
              "Maximum step executions",
              "Counts committed transitions, including retries.",
            ],
            [
              "max_wall_time_seconds",
              "Maximum run time (seconds)",
              "Elapsed time since Start, including pauses and daemon downtime. Caps a running agent or command at the remaining time; no further steps start after the limit.",
            ],
            [
              "agent_idle_timeout_seconds",
              "Agent silence timeout (seconds)",
              "Ends an agent invocation if no stdout or stderr arrives for this long. Routes as a technical timeout; commands are unaffected.",
            ],
          ] as const
        ).map(([field, label, hint]) => (
          <Limit key={field} field={field} label={label} hint={hint} doc={doc} session={session} />
        ))}
        {errors.length ? (
          <div role="status">
            <h3 className="h3">Checks</h3>
            <ul className="problems">
              {errors.map((p) => (
                <li key={p.text} className={`problem ${p.severity}`}>
                  {p.text}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="hint" role="status">
            {state.checking || state.generation !== state.checked
              ? "Checking the latest change…"
              : (state.checkError ?? "No rules or limits problems found.")}
          </p>
        )}
        {list
          .filter((p) => p.code === "unbounded_cycle")
          .map((p) => (
            <p className="callout" key={p.text}>
              {p.text}
            </p>
          ))}
      </aside>
    </div>
  );
}

function Limit({
  field,
  label,
  hint,
  doc,
  session,
}: {
  field: keyof NonNullable<Doc["limits"]>;
  label: string;
  hint: string;
  doc: Doc;
  session: Session;
}) {
  const [text, setText] = useState(String(doc.limits?.[field] ?? ""));
  return (
    <div className="block">
      <label htmlFor={`limit-${field}`}>{label}</label>
      <input
        id={`limit-${field}`}
        inputMode="numeric"
        value={text}
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          session.edit((d) => {
            const next = clone(d);
            next.limits ??= {};
            if (value.trim() === "") delete next.limits[field];
            else next.limits[field] = /^\d+$/.test(value) ? Number(value) : Number.NaN;
            return next;
          }, 400);
        }}
      />
      <span className="hint">{hint}</span>
    </div>
  );
}

function PolicyCard({
  policy,
  index,
  doc,
  session,
  onChange,
  onRemove,
}: {
  policy: Policy;
  index: number;
  doc: Doc;
  session: Session;
  onChange: (doc: Doc, policy: Policy) => void;
  onRemove: () => void;
}) {
  const scope = scopeOf(policy);
  const [tags, setTags] = useState("tags" in policy.match ? policy.match.tags.join(", ") : "");
  const id = `policy-${index}`;
  const selected = "step_ids" in policy.match ? policy.match.step_ids : [];
  return (
    <section className="policy-card" aria-labelledby={`${id}-title`}>
      <div className="pane-head">
        <h3 className="h3" id={`${id}-title`}>
          Shared rule {index + 1}
        </h3>
        <button type="button" className="btn btn-sm btn-quiet" onClick={onRemove}>
          Remove shared rule {index + 1}
        </button>
      </div>
      <div className="block">
        <label htmlFor={`${id}-scope`}>Applies to</label>
        <select
          id={`${id}-scope`}
          value={scope}
          onChange={(e) => {
            const next = e.target.value as Scope;
            onChange(doc, {
              ...policy,
              match:
                next === "all"
                  ? { all: true }
                  : next === "tags"
                    ? { tags: tags.split(/[\s,]+/).filter(Boolean) }
                    : { step_ids: [] },
            });
          }}
        >
          <option value="all">All steps</option>
          <option value="tags">Steps with tags</option>
          <option value="step_ids">Named steps</option>
        </select>
      </div>
      {scope === "tags" ? (
        <div className="block">
          <label htmlFor={`${id}-tags`}>Tags (separated by commas)</label>
          <input
            id={`${id}-tags`}
            value={tags}
            placeholder="e.g. review, checks"
            onChange={(e) => {
              setTags(e.target.value);
              onChange(doc, {
                ...policy,
                match: { tags: e.target.value.split(/[\s,]+/).filter(Boolean) },
              });
            }}
          />
          <span className="hint">Set tags in each step’s Advanced fields.</span>
        </div>
      ) : null}
      {scope === "step_ids" ? (
        <fieldset className="step-choices">
          <legend>Steps covered</legend>
          {[...new Set([...Object.keys(doc.steps), ...selected])].map((stepId) => (
            <label className="check" key={stepId}>
              <input
                type="checkbox"
                checked={selected.includes(stepId)}
                onChange={(e) =>
                  onChange(doc, {
                    ...policy,
                    match: {
                      step_ids: e.target.checked
                        ? [...selected, stepId]
                        : selected.filter((id) => id !== stepId),
                    },
                  })
                }
              />
              {humanize(stepId)}
              {!doc.steps[stepId] ? " (missing)" : ""}
            </label>
          ))}
        </fieldset>
      ) : null}
      <RuleList
        id={id}
        doc={doc}
        rules={policy.on}
        session={session}
        onChange={(nextDoc, on) => onChange(nextDoc, { ...policy, on })}
      />
    </section>
  );
}

function RuleList({
  id,
  doc,
  rules,
  session,
  onChange,
}: {
  id: string;
  doc: Doc;
  rules: Record<string, Rule>;
  session: Session;
  onChange: (doc: Doc, on: Record<string, Rule>) => void;
}) {
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const choices = [
    ...new Set([
      ...Object.values(doc.steps).flatMap(outcomesOf),
      ...(session.state.draft?.systemOutcomes ?? []),
    ]),
  ];
  const add = (e: FormEvent) => {
    e.preventDefault();
    const key = result.trim();
    if (!key) return setError("Choose or type a result first.");
    if (Object.hasOwn(rules, key)) return setError("This result already has a rule here.");
    onChange(doc, { ...rules, [key]: { pause: true } });
    setResult("");
    setError("");
    focusField(`${id}-${key}`);
  };
  return (
    <>
      <ul className="shared-routes">
        {Object.entries(rules).map(([outcome, rule]) => (
          <li className="shared-route-row" key={outcome}>
            <div className="block">
              <label htmlFor={`${id}-${outcome}`}>
                {outcome === "system.error"
                  ? "Any technical failure (fallback)"
                  : outcomeLabel(outcome)}
              </label>
              <RuleDestination
                id={`${id}-${outcome}`}
                doc={doc}
                rule={rule}
                onChange={(nextDoc, next) => {
                  if (next) onChange(nextDoc, { ...rules, [outcome]: next });
                }}
              />
            </div>
            <button
              type="button"
              className="btn-icon"
              aria-label={`Remove ${outcome} from ${id}`}
              onClick={() => {
                const next = { ...rules };
                delete next[outcome];
                onChange(doc, next);
                focusField(`${id}-result`);
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form className="row add-result" onSubmit={add}>
        <label htmlFor={`${id}-result`}>Result to add</label>
        <input
          id={`${id}-result`}
          list={`${id}-results`}
          value={result}
          placeholder="Choose or type a result"
          onChange={(e) => {
            setResult(e.target.value);
            setError("");
          }}
        />
        <datalist id={`${id}-results`}>
          {choices
            .filter((c) => !Object.hasOwn(rules, c))
            .map((c) => (
              <option key={c} value={c}>
                {outcomeLabel(c)}
              </option>
            ))}
        </datalist>
        <button type="submit" className="btn btn-sm">
          Add rule
        </button>
        {error ? <span className="field-err">{error}</span> : null}
      </form>
    </>
  );
}
