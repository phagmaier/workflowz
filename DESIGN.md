# Workflowz — UI design brief

## Goal

Make Workflowz understandable through its interface. The owner should be able to create a
workflow, understand what it will do, start it and inspect its results without being coached
through internal field names and scattered controls.

**Current task:** Implement the selected direction in slices (see Decisions).
The existing engine is the baseline. React + TypeScript is the proposed frontend direction;
the selected interaction design comes first. No production UI changes have been made yet.

## What the walkthrough established

The command-only workflow ran successfully. The owner could not reliably tell what common
actions did: validation, run creation and new-draft creation appeared to do nothing because
results appeared elsewhere on a long page. Workflow editing mixed unfinished graph diagnostics,
manual apply controls, technical IDs and unrelated run information. Run history was raw event data.
The owner stopped the walkthrough because these interactions prevented learning.

This calls for a substantial navigation and interaction redesign. Preserve these findings as
context, without maintaining a separate task for every symptom. The [unfinished walkthrough](archive/history/usability-walkthrough.md)
is available if particular observations or verified startup details are needed.

## Product shape to explore

Use separate navigable views with browser back/forward behavior and a clear current location:

- **Workflows:** saved definitions/revisions, useful starting examples and a clear Create workflow action.
- **Create / edit workflow:** focused project setup and step authoring; readable labels and direct next-step choices. Show which draft is being edited and whether changes are saved.
- **Runs:** executions and their statuses, with an obvious way to inspect one.
- **Run details:** ready/running/completed/paused status, relevant controls, readable per-step results and technical evidence on demand.

A workflow draft and an inspected run must never look like competing sections of the same form.
A successful action should leave the user looking at the relevant result, with visible feedback.
Creating a run still prepares it; Start remains an explicit action.

The editor should support adding an outcome and choosing its action directly. A user should
not have to add a pause rule as an intermediate editing trick. Explain missing connections in
context. Preserve branching, retries, custom outcomes, task loops, policies, YAML and paused-run
intervention; advanced capabilities need deliberate homes rather than all being expanded at once.

## How we will choose a design

First compare three distinct design directions using the **same workflow editor and run-detail
content**. Show actual screens or clickable prototypes. Each direction should have a clear
navigation model, visual hierarchy, typography, density and interaction approach.

Possible starting directions are a calm developer workspace, a guided builder, and a visual
workflow studio. These are exploration candidates, not chosen layouts or approved new features.
A complex graph canvas is optional and should earn its place through usability.

Choose based on whether the owner can understand where they are, what will run, what just happened
and what they can do next. Then expand the chosen direction into a complete main journey and
its empty/loading/error/invalid/running/paused/disconnected states. Settle components and frontend
integration after that, implement in complete slices, and write the tutorial against the result.

## Reusable design prompt

Use this with the repository context and current screenshots when available:

> Redesign Workflowz, a local desktop-oriented web app for coding-agent workflows. The engine
> works, but its current giant single-page UI is too confusing to use even with guided instructions.
> Help me choose a professional design before production implementation.
>
> Propose three meaningfully different visual and interaction directions. For each, show the
> same two screens: a workflow editor and a run-detail page. Use realistic sample content and
> make navigation and the primary action obvious. Include a concise explanation of the tradeoffs.
> Give me actual mockups or clickable prototypes, not just a written list of recommendations.
>
> The full app needs Workflows, Create/Edit workflow, Runs, and Run details as distinct navigable
> views. Keep a clear current location, consistent navigation, readable typography, deliberate
> spacing, and restrained use of color. Avoid putting every feature on one long page.
>
> Make basic authoring understandable: choose a project, add agent/command steps, choose the
> agent/model and prompt, and say what happens after each outcome. Support direct next-step
> choices without requiring knowledge of engine IDs or temporary editing workarounds. Preserve
> advanced branching, policies, retries, task loops, YAML and intervention in appropriate views.
>
> Put loading/success/error feedback at the action. Make created runs and active drafts apparent.
> Show a readable step-by-step run history, with technical event data available on demand.
> Account for empty, incomplete, running, blocked and disconnected states, keyboard focus and
> responsive layout. Use helpful interface copy instead of requiring a manual to explain controls.
>
> Use the existing code as the functionality source. Preserve the engine, saved state and
> execution/recovery contracts. Prototypes use sample data and must not call the daemon or
> providers. We will choose and refine a direction before implementing the frontend in React
> and TypeScript. Do not add unrelated product features or rebuild the backend.

## Decisions

The owner chose **UI overhaul before further tutorial work**.

**Selected direction (2026-10-20):** Direction A, the developer workspace, is the base. It
borrows two elements from B and one from C. The three prototypes remain in
[prototypes/design-directions/](prototypes/design-directions/index.html) as reference until
the implementation replaces them.

- **Structure (A):** persistent sidebar (Workflows, Runs) with an attention count, breadcrumbs
  and page actions in a top bar. The editor has Steps / Project / Rules & limits / YAML tabs. The
  Steps tab has three panes: ordered step list, selected-step form, and checks with the first step.
- **Plain language (B):** each step shows a sentence summary and "result → what happens next"
  lines. Outcome destinations are chosen directly ("Go to …", "Finish", "Pause and wait for me",
  "Retry this step", "＋ New step…"). Inherited rules show their source. Technical failures and
  advanced fields sit behind disclosures.
- **Paused runs (B):** run details ask "What should happen next?" and show the consequence of
  each choice: Resume, set the step's result, jump, mark the task done, edit the workflow for
  this run, or stop. Each needs a reason, and every choice except Resume leaves the run paused.
- **Map (C):** a read-only, automatically arranged map is a tab in the editor and on run details.
  On a run, it shows the path taken and how many times each step ran. Editing stays in the forms.
- **Run details (A):** a status headline, a fact strip and the decision area, then history grouped
  by task beside the selected step's result. Raw events open on demand.
- **Feedback:** results appear beside the action that caused them. Created runs open their run page
  with a confirmation. Stale-state and disconnected failures say that nothing changed.
- **Unchanged contracts:** Save creates an immutable revision. Create run only prepares a run, and
  Start is separate. Interrupted-run recovery stays in the CLI unless a browser API is separately
  approved.

**Implementation plan (2026-10-20):** React + TypeScript built by project-local Vite. During
migration the daemon serves the new app at `/ui/app/` beside the legacy UI at `/ui/`. Then `/ui/`
switches to the new app and the legacy UI is removed. Routes use URL hashes. The CSP and the
browser API are unchanged. Slices: (1) frame, pairing, Runs, Run details and Map;
(2) Workflows and editor; (3) advanced (shared rules, limits, YAML text, paused-run revision);
(4) legacy removal and the user guide. Empty, loading, error and disconnected states are designed
inside each slice rather than in a separate prototype round.

React can be integrated into an existing application without replacing its backend; see the
[official integration guidance](https://react.dev/learn/add-react-to-an-existing-project).
