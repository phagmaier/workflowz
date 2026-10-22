# Live demo feedback — 2026-10-21

> Archived on 2026-10-21. Research from the rejected interface; its conclusions are incorporated
> into [DESIGN.md](../DESIGN.md). Open questions and proposed interactions below are historical,
> not current implementation instructions.

The owner drove the current UI through pairing, creating a Commands only draft,
editing its command to `node --version`, saving, creating a run and starting it.
The demo used `/tmp/workflowz-demo/project` with separate disposable daemon state.
No AI provider was used.

The owner reported that startup was clear and the overall flow went smoothly.
Command editing and the Ready run page were each only somewhat clear ("kinda").
The particular labels or interactions causing that hesitation have not been identified.

The owner subsequently identified command entry as a major usability problem:
`node --version` cannot be entered on one line, because the form requires one
argument per line. Ordinary command entry should feel natural; this is explicit
negative feedback, not just mild hesitation. No replacement interaction has
been selected yet.

After execution, the owner could recognize success but could not see command output.
They were unsure how important output is for an agent-focused product. This is a
reported observation, not yet a verified implementation defect or a decision to
omit output. Consider making stdout/stderr discoverable from the selected step's
result so command behavior is inspectable.

No frontend changes or design decisions were made during this demo.

During setup of a two-agent demo, adding a destination through “＋ New step…”
required clarification: the owner could not tell whether “Agent” meant the new
step's name or its type. The walkthrough wording contributed, and the UI did
not make that distinction apparent. After creating the step, the owner said
the UI was still awful. Treat the builder's clarity as an unresolved usability
problem despite the successful command run.

The owner's screenshot showed the inline “New destination step” form: Name,
then “Add as” buttons including “Ask an agent”. The walkthrough called that
type “Agent”, adding a terminology mismatch. The owner could not tell where
the new agent's settings or prompt would appear; creation and configuration
were not apparent as separate interactions.

The owner subsequently reported that the two-agent run completed successfully.
They would use the product if it were easier and looked nicer, but strongly
rejected the current appearance and usability after seeing it in action. They
have additional notes still to collect. Successful execution does not establish
interface acceptance; earlier acceptance should not be treated as resolving
these newly observed problems.

Additional owner feedback: the UI feels like a cheap website rather than a
polished application, with cluttered pages and insufficient visual separation.
They want modern, sleek styling and more visual authoring. Path entry should
support paste and filesystem navigation. The map is conceptually useful but
poorly presented and should be available during editing or easy to check.
“Ask an agent” was explicitly rejected as a label.

The owner suggested connected nodes with selectable types (Agent, Command,
etc.), opening a node to configure details and potentially reveal children,
failure modes or optional review. They also value sequential authoring, with
branch choices opening a focused view. They raised graph clutter themselves
and have not selected a graph-only interaction. These are proposal inputs,
not an implementation decision.

Further feedback: offer harness-specific effort presets and/or remember custom
effort entries. Agent output is missing from the experience; showing agents work
is a later aspiration. Concurrent agents are explicitly a future dream, not a
request to implement now. Pairing codes and manually starting/stopping the
“thread” felt unacceptable, and the owner could not tell whether it was still
running. The exact meaning of “thread” needs clarification before lifecycle
changes. Inspection after the demo found both runs completed and the demo daemon
still available; no active run was listed.

The owner wants a better process for choosing both appearance and flow after
two unsatisfactory designs, and asked whether the app actually uses React.
It uses React + TypeScript, built with Vite; the framework itself does not resolve
the design issues.
