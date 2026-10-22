// Offline diagnostic: unmodified Workflowz bridge, fake local harness, no provider/auth/report token.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const temporary = mkdtempSync(path.join(os.tmpdir(), "wf-wait-diagnostic-"));
const fixture = path.join(temporary, "fake-server.mjs");
const preload = path.join(temporary, "fetch-observer.mjs");
const observation = path.join(temporary, "observation.json");
writeFileSync(
  fixture,
  `import http from 'node:http';
const session='ses_offlinefixture';
const server=http.createServer(async(req,res)=>{
 let text='';for await(const chunk of req)text+=chunk;
 const body=text?JSON.parse(text):{};
 res.setHeader('content-type','application/json');
 if(req.url==='/api/session')res.end(JSON.stringify({data:{id:session,location:{directory:process.cwd()},time:{}}}));
 else if(req.url.endsWith('/prompt'))res.end(JSON.stringify({data:{id:body.id,sessionID:session,type:'user',time:{created:2}}}));
 else if(req.url.endsWith('/wait'))setTimeout(()=>{res.statusCode=204;res.end()},310000).unref();
 else {res.statusCode=404;res.end('{}')}
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+server.address().port+'/'})));
process.stdin.resume();process.stdin.on('end',()=>{server.closeAllConnections();server.close()});
`,
);
writeFileSync(
  preload,
  `import {writeFileSync} from 'node:fs';
const original=globalThis.fetch;
globalThis.fetch=async(...args)=>{const start=Date.now();try{return await original(...args)}catch(error){
 writeFileSync(${JSON.stringify(observation)},JSON.stringify({route:new URL(args[0]).pathname,elapsedMs:Date.now()-start,name:error.name,message:error.message,causeCode:error.cause?.code,causeName:error.cause?.name}));throw error;
}};
`,
);
const started = Date.now();
const child = spawn(
  process.execPath,
  ["--import", preload, path.resolve("dist/adapters/opencode-bridge.js")],
  {
    cwd: temporary,
    env: { PATH: process.env.PATH, HOME: temporary },
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  },
);
const output = [];
child.stdout.on("data", (chunk) => output.push(chunk));
child.stderr.resume();
child.stdin.end(
  JSON.stringify({
    binary: process.execPath,
    args: [fixture],
    password: "offline-fixture-placeholder",
    prompt: "offline diagnostic, no model",
  }),
);
const safety = setTimeout(() => process.kill(-child.pid, "SIGTERM"), 340000);
try {
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const result = {
    providerCalls: 0,
    nodeVersion: process.version,
    bridge: "unmodified dist/adapters/opencode-bridge.js",
    delayedLocalWaitMs: 310000,
    elapsedMs: Date.now() - started,
    exitCode,
    bridgeEvents: Buffer.concat(output)
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
    fetchError: JSON.parse(readFileSync(observation, "utf8")),
  };
  writeFileSync(
    "trials/equipment-lending/evidence/wait-diagnostic.json",
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  clearTimeout(safety);
  rmSync(temporary, { recursive: true, force: true });
}
