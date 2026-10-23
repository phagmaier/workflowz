// Disposable verification fixture: API/page success can coexist with input loss after a save.
import { createServer } from "node:http";

const html = (broken) => `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Browser acceptance fixture</title>
<style>body{font:16px system-ui;margin:24px;max-width:700px}label{display:block;margin:12px 0}
input,textarea{display:block;box-sizing:border-box;width:100%}td{overflow-wrap:anywhere}
table{width:100%;table-layout:fixed}button{margin:4px}th{text-align:left}</style>
<h1>Items</h1><form aria-label="Item editor">
<label>Item name<input required id="name"></label>
<label>Description<textarea id="description"></textarea></label>
<button type="submit">Add item</button></form>
<table aria-label="Items" aria-busy="true"><thead><tr><th>Name</th><th>Description</th><th>Actions</th></tr></thead>
<tbody></tbody></table><p role="status" id="status"></p>
<script>
const form = document.querySelector('form');
const name = document.querySelector('#name');
const description = document.querySelector('#description');
const submit = form.querySelector('button');
let editing = null;
let saved = false;
async function api(method, id = '', body) {
  const response = await fetch('api/items' + (id ? '/' + id : ''), {
    method, headers: {'content-type':'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return response.json();
}
async function render() {
  document.querySelector('table').setAttribute('aria-busy', 'true');
  const items = await api('GET');
  const rows = document.querySelector('tbody');
  rows.replaceChildren();
  for (const item of items) {
    const row = document.createElement('tr');
    for (const value of [item.name, item.description]) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    const actions = document.createElement('td');
    const edit = document.createElement('button'); edit.textContent = 'Edit';
    edit.onclick = () => {
      editing = item.id; name.value = item.name; description.value = item.description;
      submit.textContent = 'Save item'; name.focus();
    };
    const remove = document.createElement('button'); remove.textContent = 'Delete';
    remove.onclick = async () => { await api('DELETE', item.id); await render(); };
    actions.append(edit, remove); row.append(actions); rows.append(row);
  }
  document.querySelector('table').setAttribute('aria-busy', 'false');
}
form.addEventListener('input', () => { if (${broken} && saved) form.reset(); });
form.onsubmit = async (event) => {
  event.preventDefault();
  await api(editing ? 'PUT' : 'POST', editing || '', {name:name.value, description:description.value});
  editing = null; saved = true; form.reset(); submit.textContent = 'Add item';
  document.querySelector('#status').textContent = 'Saved'; await render();
};
render();
</script></html>`;

export async function startAcceptanceTarget() {
  const records = { broken: new Map(), fixed: new Map() };
  let sequence = 0;
  const server = createServer(async (request, response) => {
    const [mode, api, resource, id] = new URL(request.url, "http://127.0.0.1").pathname
      .split("/")
      .filter(Boolean);
    const rows = records[mode];
    const send = (status, value) => {
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    };
    if (!rows) return send(404, { error: "unknown fixture" });
    if (!api && request.method === "GET") {
      response.writeHead(200, { "content-type": "text/html" }).end(html(mode === "broken"));
      return;
    }
    if (api !== "api" || resource !== "items") return send(404, {});
    if (request.method === "GET") return send(200, [...rows.values()]);
    if (request.method === "DELETE") {
      rows.delete(id);
      return send(200, {});
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const item = { id: id ?? String(++sequence), name: body.name, description: body.description };
    rows.set(item.id, item);
    send(200, item);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    records,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
