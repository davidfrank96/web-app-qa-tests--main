import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium, type BrowserContext, type Request, type Route } from "@playwright/test";
import { installSafeWriteAudit } from "../../utils/inssa-safe-write-audit";

async function main() {
  let unexpectedServerPosts = 0;
  const server = createServer((req, res) => {
    if (req.method === "POST") unexpectedServerPosts++;
    if (req.url === "/sw.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(`
        self.addEventListener('install', () => self.skipWaiting());
        self.addEventListener('activate', event => event.waitUntil(clients.claim()));
        self.addEventListener('fetch', event => event.respondWith(fetch(event.request)));
        self.addEventListener('message', event => {
          event.waitUntil((async () => {
            for (const request of event.data) {
              try {
                const response = await fetch(request.url, {method:'POST', body:request.body, headers:{'Content-Type':'text/plain'}});
                event.ports[0].postMessage({name:request.name, ok:response.ok});
              } catch { event.ports[0].postMessage({name:request.name, ok:false}); }
            }
          })());
        });
      `);
    } else { res.setHeader("Content-Type", "text/html"); res.end("<body>Safe Suite service-worker fixture</body>"); }
  });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  const address=server.address();assert.ok(address && typeof address!=="string");const origin=`http://127.0.0.1:${address.port}`;
  const browser=await chromium.launch();
  try {
    const context=await browser.newContext({serviceWorkers:"allow"});
    // Only this isolated fixture fulfills external dependencies. Real acceptance
    // always forwards allowed requests; no staging response is mocked.
    const fixtureContext=new Proxy(context, {get(target,key){
      if(key!=="route") return Reflect.get(target,key);
      return async(pattern:string, handler:(route:Route,request:Request)=>Promise<void>)=>target.route(pattern,async(route,request)=>{
        const intercepted=new Proxy(route,{get(real,property){
          if(property!=="continue")return Reflect.get(real,property);
          return async()=>new URL(request.url()).origin===origin ? real.continue() : real.fulfill({status:200,contentType:"application/json",headers:{"Access-Control-Allow-Origin":"*"},body:'{"fixture":true}'});
        }});
        await handler(intercepted,request);
      });
    }}) as BrowserContext;
    const audit=await installSafeWriteAudit(fixtureContext,"fixture");const page=await context.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);
    await page.evaluate(async()=>{const registration=await navigator.serviceWorker.register('/sw.js');if(!registration)throw Error('Missing registration');void registration.waiting;await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise<void>(resolve=>navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true}));});
    assert.equal(context.serviceWorkers().length,1);
    const viewport=JSON.stringify([[[1,2],[3,4]],1,null,"en",1,"fixture",1,1,null,null,null,1,"fixture",1,null,null,"fixture"]);
    const requests=[
      {name:"viewport",url:"https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetViewportInfo",body:viewport},
      {name:"session",url:"https://securetoken.googleapis.com/v1/token",body:"grant_type=refresh_token&refresh_token=fixture"},
      {name:"notification",url:"https://firebaseinstallations.googleapis.com/v1/projects/fixture/installations",body:'{}'},
      ...["draft","capsule","media","profile"].map(name=>({name,url:origin+'/'+name,body:'{"change":true}'}))
    ];
    const results=await page.evaluate(async requests=>{const channel=new MessageChannel();const rows:Array<{name:string;ok:boolean}>=[];const done=new Promise<typeof rows>(resolve=>{channel.port1.onmessage=event=>{rows.push(event.data);if(rows.length===requests.length)resolve(rows);};});navigator.serviceWorker.controller!.postMessage(requests,[channel.port2]);return done;},requests);
    assert.deepEqual(results.map(result=>result.ok),[true,true,true,false,false,false,false]);
    assert.equal(unexpectedServerPosts,0,"blocked service-worker writes never reach the server");
    assert.ok(audit.records.every(record=>record.serviceWorker===true));
    assert.deepEqual(audit.records.map(record=>record.outcome),["ALLOWED_READ_ONLY","ALLOWED_BENIGN_INITIALIZATION","ALLOWED_BENIGN_INITIALIZATION",...Array(4).fill("BLOCKED_UNEXPECTED_WRITE")]);
    assert.deepEqual(errors,[]);await audit.dispose();await context.close();
    console.log("PASS normal SW registration/activation; real SW outbound routing; allowed requests recorded; unknown draft/capsule/media/profile writes blocked before server; no registration/page errors");
  } finally {await browser.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
