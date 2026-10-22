// New app (/ui/): Workflows, creating and editing a draft, Save and Create run. No run starts.
import { noSideScroll, pairApp, shot, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

test.use({ scenario: "gate" });

test("create a workflow from an example, connect results directly, save, then prepare a run", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const mutations = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/ui/api") || request.method() !== "POST") return;
    const body = request.postDataJSON();
    if (
      ![
        "session",
        "runs",
        "workflows",
        "status",
        "events",
        "reports",
        "load",
        "draft",
        "preview",
        "run-edit",
      ].includes(body.op)
    )
      mutations.push(body.op);
  });
  // Leaving with an unsaved draft asks first; tests accept.
  page.on("dialog", (dialog) => void dialog.accept());

  await pairApp(page, app, "#/workflows");
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("Workflows");
  await expect(page.getByRole("heading", { name: "No saved workflows yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Task loop/ })).toBeVisible();
  await shot(page, "e01-workflows-empty");

  // New workflow: three answers, checked in the browser before anything is sent.
  await page.getByRole("link", { name: "New workflow" }).click();
  await expect(heading).toHaveText("New workflow");
  await expect(heading).toBeFocused();
  await page.getByLabel("Name", { exact: true }).fill("Fix tests");
  await page.getByLabel("Project folder").fill("relative/path");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/#\/workflows\/new$/);
  await page.getByLabel("Project folder").fill(app.root);
  await page.getByRole("radio", { name: /Task loop/ }).check();
  await page.getByLabel(/Task checklist/).fill("tasks.md");
  await shot(page, "e02-new");
  await page.getByRole("button", { name: "Create draft" }).click();

  await expect(page).toHaveURL(/#\/workflows\/draft\/\d+$/);
  await expect(heading).toHaveText("Fix tests");
  await expect(page.getByText("New draft · not saved yet")).toBeVisible();
  const checks = page.getByRole("complementary", { name: "Checks" });
  await expect(checks).toContainText("All good");
  const list = page.getByRole("region", { name: "Steps" });
  await expect(list.getByRole("button")).toHaveText([
    /Pick task/,
    /Implement/,
    /Mark done/,
    /Done/,
    /Add step/,
  ]);
  await shot(page, "e03-editor-new");

  await list.getByRole("button", { name: /Implement/ }).click();
  const form = page.getByRole("region", { name: "Selected step" });
  await expect(form.getByRole("heading", { level: 2 })).toHaveText("Implement");
  await expect(form).toContainText("Codex:");

  // A new result is unconnected until a destination is chosen, and the checks say so in context.
  await form.getByLabel("New outcome name").fill("needs info");
  await form.getByRole("button", { name: "Add outcome" }).click();
  await expect(form).toContainText("Added “needs_info”");
  const needsInfo = form.getByLabel("When the outcome is needs_info, then");
  await expect(needsInfo).toBeFocused();
  await expect(checks).toContainText("Implement: choose what happens after “needs_info”");
  await expect(form).toContainText("Not connected yet");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await shot(page, "e04-missing");
  await needsInfo.selectOption({ label: "Pause and wait for me" });
  await expect(checks).toContainText("All good");

  // "New step…" creates the destination directly and opens it.
  await form
    .getByLabel("When the outcome is blocked, then")
    .selectOption({ label: "＋ New step…" });
  await form.getByLabel("Name", { exact: true }).fill("Ask for help");
  await form.getByRole("button", { name: "Agent" }).click();
  await expect(form.getByRole("heading", { level: 2 })).toHaveText("Ask for help");
  await expect(form).toContainText("New step, reached when Implement's outcome is blocked");
  await expect(checks).toContainText("Ask for help: write a prompt.");
  await expect(checks).toContainText("More checks run once these are fixed.");
  await expect(form.getByLabel("When the outcome is complete, then")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  const prompt = form.getByLabel("Prompt text");
  await prompt.fill("Explain what blocked {{task.text}}");
  await form
    .getByLabel("When the outcome is complete, then")
    .selectOption({ label: "Go to Mark done" });
  await expect(checks).toContainText("All good");
  await expect(prompt).toHaveValue("Explain what blocked {{task.text}}");
  await shot(page, "e05-new-step");

  // Save creates an immutable revision; the draft becomes that revision.
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText(/Saved as revision \d+\. No run was created\./)).toBeVisible();
  await expect(page).toHaveURL(/#\/workflows\/\d+$/);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  const revision = Number(page.url().match(/#\/workflows\/(\d+)$/)?.[1]);
  await expect(form.getByRole("heading", { level: 2 })).toHaveText("Ask for help");

  // YAML and Map views show the same draft.
  await page.getByRole("link", { name: "YAML" }).click();
  await expect(page.locator("pre.yaml")).toContainText("ask_for_help:");
  await expect(page.locator("pre.yaml")).toContainText("needs_info:");
  await page.getByRole("link", { name: "Graph" }).click();
  await expect(page.getByRole("region", { name: "Workflow graph", exact: true })).toBeVisible();
  await shot(page, "e06-map");

  // Create run prepares a run and opens it with a confirmation; Start stays separate.
  await page.getByRole("button", { name: "Create run…" }).click();
  const panel = page.getByRole("region", { name: "Create a run" });
  await expect(panel.getByRole("heading")).toBeFocused();
  await expect(panel).toContainText("2 tasks will be copied from tasks.md");
  await shot(page, "e07-create-panel");
  await panel.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(/#\/runs\/[^/]+$/);
  await expect(
    page.getByRole("status").filter({ hasText: "Run created from revision" }),
  ).toContainText(`Run created from revision ${revision}. Nothing has started`);
  await expect(heading).toContainText("Ready to start");
  await shot(page, "e08-run-created");

  await page.getByRole("link", { name: "Workflows", exact: true }).click();
  const row = page.getByRole("row", { name: /Fix tests/ });
  await expect(row).toContainText(`Revision ${revision}`);
  await expect(row).toContainText("1 run");
  await noSideScroll(page);
  await shot(page, "e09-workflows");

  expect(mutations).toEqual(["save", "create"]);
  await policy();
});
