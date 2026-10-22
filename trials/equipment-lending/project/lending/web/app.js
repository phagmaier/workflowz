(function () {
  "use strict";

  const countNodes = document.querySelectorAll("[data-count]");
  const summaryStatus = document.getElementById("summary-status");

  function readPath(source, path) {
    return path.split(".").reduce(function (value, key) {
      return value && typeof value === "object" ? value[key] : undefined;
    }, source);
  }

  async function loadOverview() {
    try {
      const response = await fetch("/api/summary", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Overview request failed");
      const data = await response.json();
      countNodes.forEach(function (node) {
        const value = readPath(data, node.dataset.count);
        if (typeof value === "number") node.textContent = String(value);
      });
      summaryStatus.textContent = "Counts updated for " + data.as_of + ".";
      summaryStatus.dataset.state = "ready";
    } catch (error) {
      summaryStatus.textContent = "Counts are unavailable. Start the local service and reload.";
      summaryStatus.dataset.state = "error";
    }
  }

  const configs = [
    { kind: "equipment", singular: "equipment", list: "equipment-list", form: "equipment-form", title: "equipment-form-title", fields: ["name", "asset_tag", "category", "notes"] },
    { kind: "borrowers", singular: "borrower", list: "borrower-list", form: "borrower-form", title: "borrower-form-title", fields: ["name", "email", "notes"] },
  ];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  async function request(url, options) {
    const response = await fetch(url, options || { headers: { Accept: "application/json" } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The request could not be completed.");
    return data;
  }

  function clearForm(config, form) {
    form.reset();
    form.elements.id.value = "";
    document.getElementById(config.title).textContent = "Add " + config.singular;
    form.querySelector('[data-error="form"]').textContent = "";
    form.querySelector('button[type="submit"]').textContent = "Save " + config.singular;
  }

  function render(config, records) {
    const target = document.getElementById(config.list);
    target.replaceChildren();
    if (!records.length) {
      target.append(element("p", "empty-state", "No " + config.kind + " yet. Add the first record below."));
      return;
    }
    records.forEach(function (record) {
      const card = element("article", "record-card");
      const details = element("div", "record-details");
      const title = config.kind === "equipment" ? record.name : record.name;
      details.append(element("h3", "record-name", title));
      if (config.kind === "equipment") {
        details.append(element("p", "record-meta", record.asset_tag + " · " + record.category));
        details.append(element("p", "record-meta", record.on_loan ? "On loan" : "Available"));
      } else {
        details.append(element("p", "record-meta", record.email));
      }
      if (record.notes) details.append(element("p", "record-meta", record.notes));
      const actions = element("div", "record-actions");
      const edit = element("button", "secondary", "Edit");
      edit.type = "button";
      edit.addEventListener("click", function () {
        const form = document.getElementById(config.form);
        config.fields.forEach(function (field) { form.elements[field].value = record[field] || ""; });
        form.elements.id.value = String(record.id);
        form.querySelector('[data-error="form"]').textContent = "";
        document.getElementById(config.title).textContent = "Edit " + config.singular;
        form.querySelector('button[type="submit"]').textContent = "Save changes";
        form.elements.name.focus();
      });
      const remove = element("button", "danger-button", "Delete");
      remove.type = "button";
      remove.addEventListener("click", async function () {
        if (!window.confirm("Delete “" + (config.kind === "equipment" ? record.name + " (" + record.asset_tag + ")" : record.name) + "”?")) return;
        remove.disabled = true;
        try {
          await request("/api/" + config.kind + "/" + record.id, { method: "DELETE" });
          await refresh(config);
          loadOverview();
        } catch (error) {
          window.alert(error.message);
        } finally { remove.disabled = false; }
      });
      actions.append(edit, remove);
      card.append(details, actions);
      target.append(card);
    });
  }

  async function refresh(config) {
    const records = await request("/api/" + config.kind);
    render(config, records);
  }

  configs.forEach(function (config) {
    const form = document.getElementById(config.form);
    refresh(config).catch(function () {
      document.getElementById(config.list).textContent = "Could not load records. Reload the page to try again.";
    });
    form.addEventListener("reset", function () {
      window.setTimeout(function () { clearForm(config, form); }, 0);
    });
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      const errorBox = form.querySelector('[data-error="form"]');
      const original = submit.textContent;
      const data = {};
      config.fields.forEach(function (field) { data[field] = form.elements[field].value; });
      const id = form.elements.id.value;
      submit.disabled = true;
      submit.textContent = "Saving…";
      errorBox.textContent = "";
      try {
        await request("/api/" + config.kind + (id ? "/" + id : ""), {
          method: id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(data),
        });
        clearForm(config, form);
        await refresh(config);
        loadOverview();
        const status = document.createElement("p");
        status.className = "save-status";
        status.setAttribute("role", "status");
        status.textContent = "Saved " + config.singular + ".";
        form.insertBefore(status, form.querySelector("h3").nextSibling);
        window.setTimeout(function () { status.remove(); }, 3500);
      } catch (error) {
        errorBox.textContent = error.message;
      } finally {
        submit.disabled = false;
        if (submit.textContent === "Saving…") submit.textContent = original;
      }
    });
  });

  loadOverview();
})();
