import test from "node:test";
import assert from "node:assert/strict";
import { classifySafeWrite, parseSafeWritePayload, installSafeWriteAudit, classifySafeDependency, type FirestoreWrite } from "../../utils/inssa-safe-write-audit";
import type { BrowserContext, Request, Route } from "@playwright/test";
const document = "projects/fixture/databases/(default)/documents/users/account";
const endpoint = "https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel?database=projects/fixture/databases/(default)";
const fields = { bio: { stringValue: "" }, displayName: { stringValue: "" }, profileImage: { stringValue: "" }, publicHandle: { stringValue: "fixture" }, searchTokens: { arrayValue: { values: [{ stringValue: "fixture" }] } } };
const hydration = (): FirestoreWrite => ({ update: { name: document, fields: structuredClone(fields) }, updateMask: { fieldPaths: Object.keys(fields) }, currentDocument: { exists: true } });
const encoded = (writes: FirestoreWrite[]) => new URLSearchParams({ req0___data__: JSON.stringify({ writes }) }).toString();
test("exact unchanged bootstrap is classified only against the matching server baseline", () => {
  assert.equal(classifySafeWrite(hydration(), document, fields), "AUTH_PROFILE_INITIALIZATION_NO_CHANGE");
  assert.equal(classifySafeWrite(hydration(), document), "PRODUCT_MUTATION_OR_UNKNOWN");
  assert.equal(classifySafeWrite(hydration(), document + "other", fields), "PRODUCT_MUTATION_OR_UNKNOWN");
  const reordered = Object.fromEntries(Object.entries(fields).reverse());
  assert.equal(classifySafeWrite(hydration(), document, reordered), "AUTH_PROFILE_INITIALIZATION_NO_CHANGE");
});
test("unknown/changed profile, draft, capsule, media, preferences, deletes and transforms fail closed", () => {
  const changed = hydration(); changed.update!.fields!.bio = { stringValue: "new content" };
  const extra = hydration(); extra.update!.fields!.preference = { booleanValue: true }; extra.updateMask!.fieldPaths!.push("preference");
  const masked = hydration(); masked.updateMask!.fieldPaths = ["bio"];
  const replacement = hydration(); delete replacement.updateMask;
  const creation = hydration(); delete creation.currentDocument;
  const transformed = hydration(); transformed.updateTransforms = [{ fieldPath: "lastActive", setToServerValue: "REQUEST_TIME" }];
  for (const write of [changed, extra, masked, replacement, creation, transformed, {delete:document},
    ...["drafts", "timeCapsules", "media"].map(collection => ({ ...hydration(), update: { name: document.replace("users", collection), fields } }))]) {
    assert.equal(classifySafeWrite(write, document, fields), "PRODUCT_MUTATION_OR_UNKNOWN");
  }
});
test("existing activity and FCM semantics are narrow; metadata names alone cannot authorize unrelated writes", () => {
  const activity = { update: {name:document}, updateMask: {fieldPaths:[]}, currentDocument:{exists:true}, updateTransforms:[{fieldPath:"lastActive",setToServerValue:"REQUEST_TIME"}] };
  assert.equal(classifySafeWrite(activity,document),"SESSION_ACTIVITY");
  const fcm = { update: {name:document,fields:{fcmSyncStatus:{mapValue:{fields:{state:{stringValue:"blocked"},updatedAt:{timestampValue:"2026-10-04T00:00:00Z"}}}}}}, updateMask:{fieldPaths:["fcmSyncStatus"]},currentDocument:{exists:true} };
  assert.equal(classifySafeWrite(fcm,document),"FCM_NOTIFICATION_METADATA");
  assert.equal(classifySafeWrite({...activity,update:{name:document.replace("account","someone-else")}},document),"PRODUCT_MUTATION_OR_UNKNOWN");
  assert.equal(classifySafeWrite({...activity,updateTransforms:[{fieldPath:"lastActive",increment:1}] } as unknown as FirestoreWrite,document),"PRODUCT_MUTATION_OR_UNKNOWN");
});
test("host, method, endpoint, malformed payload and unknown envelope checks", () => {
  assert.equal(parseSafeWritePayload(endpoint,"POST",encoded([hydration()])).length,1);
  for(const [url,method,body] of [[endpoint.replace("firestore.googleapis.com","firestore.googleapis.com.evil.test"),"POST",encoded([])],[endpoint,"PATCH",encoded([])],[endpoint.replace("/Write/","/Anything/"),"POST",encoded([])],[endpoint,"POST","req0___data__=bad"],[endpoint,"POST","unknown=1"],[endpoint,"POST","req0___data__={}"]])assert.throws(()=>parseSafeWritePayload(url,method,body));
});
test("guard reads current profile before forwarding, blocks changes and never reports values/tokens", async () => {
  let handler: (route:Route,request:Request)=>Promise<void> = async()=>{};
  let serverFields: unknown=fields; const order:string[]=[];
  const context = { route:async(_p:unknown,h:typeof handler)=>{handler=h;},unroute:async()=>{},request:{get:async(url:string)=>{assert.equal(url,'https://firestore.googleapis.com/v1/'+document);order.push('server-read');return {ok:()=>true,json:async()=>({name:document,fields:serverFields}),dispose:async()=>{}};}} } as unknown as BrowserContext;
  const audit=await installSafeWriteAudit(context,"account");
  const token=`header.${Buffer.from(JSON.stringify({sub:'account',aud:'fixture'})).toString('base64url')}.private-signature`;
  async function send(body:string){const route={continue:async()=>{order.push('forward');},abort:async()=>{order.push('abort');}} as unknown as Route;await handler(route,{url:()=>endpoint,method:()=>"POST",postData:()=>body,headers:()=>({})} as unknown as Request);}
  await send(new URLSearchParams({headers:`Authorization: Bearer ${token}\r\n`,req0___data__:JSON.stringify({database:'projects/fixture/databases/(default)'})}).toString());
  order.length=0;await send(encoded([hydration()]));assert.deepEqual(order,['server-read','forward']);
  serverFields={...fields,bio:{stringValue:'real profile change'}};
  order.length=0;await send(encoded([hydration()]));assert.deepEqual(order,['server-read','abort']);
  assert.equal(audit.failures.length,1);assert.equal(audit.records[0].classification,'AUTH_PROFILE_INITIALIZATION_NO_CHANGE');
  const serialized=JSON.stringify(audit.records);for(const secret of ['private-signature','real profile change','stringValue','account'])assert.ok(!serialized.includes(secret));
});
test("unknown REST profile, draft and upload writes fail instead of inheriting a broad POST exception", async () => {
  let handler: (route:Route,request:Request)=>Promise<void> = async()=>{};
  const context={route:async(_p:unknown,h:typeof handler)=>{handler=h;},unroute:async()=>{}} as unknown as BrowserContext;
  const audit=await installSafeWriteAudit(context,'account');
  for(const [url,method,allowed] of [
    ['https://kbeanbetastaging.azurewebsites.net/api/public/GetUserProfileByEmail','POST',true],
    ['https://kbeanbetastaging.azurewebsites.net/api/public/UpdateUserProfile','POST',false],
    ['https://staging.inssa.us/api/drafts','POST',false],
    ['https://firebasestorage.googleapis.com/v0/b/fixture/o','POST',false],
    ['https://identitytoolkit.googleapis.com/v1/accounts:update','POST',false],
    ['https://identitytoolkit.googleapis.com/v1/accounts:lookup','PATCH',false]
  ] as const){let forwarded=false,blocked=false;await handler({continue:async()=>{forwarded=true;},abort:async()=>{blocked=true;}} as unknown as Route,{url:()=>url,method:()=>method,postData:()=>"{}"} as unknown as Request);assert.equal(forwarded,allowed);assert.equal(blocked,!allowed);}
  assert.equal(audit.failures.length,5);
});

test("Maps viewport RPC requires exact method/host/path and observed read payload; unknown Cloud Functions stay blocked", () => {
  const url="https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetViewportInfo";
  const payload=JSON.stringify([[[1,2],[3,4]],1,null,"en",1,"fixture",1,1,null,null,null,1,"fixture",1,null,null,"fixture"]);
  assert.equal(classifySafeDependency(url,"POST",payload).outcome,"ALLOWED_READ_ONLY");
  for(const [target,method,body] of [[url,"PATCH",payload],[url.replace("maps.googleapis.com","evil.test"),"POST",payload],[url+"Other","POST",payload],[url,"POST",'{"write":true}'],["https://us-central1-kbean-stg-fcm.cloudfunctions.net/discover_seedQuickFindCategories","POST",'{"data":{"center":{},"categories":[]}}']]) {
    assert.equal(classifySafeDependency(target,method,body).outcome,"BLOCKED_UNEXPECTED_WRITE");
  }
});

test("proven claims is exact read-only; seed and unknown functions remain blocked", () => {
  const host="https://us-central1-kbean-stg-fcm.cloudfunctions.net";
  assert.deepEqual(classifySafeDependency(host+"/listMyRaffleClaims","POST","{}"), {classification:"READ_ONLY_DEPENDENCY",outcome:"ALLOWED_READ_ONLY"});
  assert.deepEqual(classifySafeDependency(host+"/discover_seedQuickFindCategories","POST",'{"reusedCapsuleIds":["existing"]}'), {classification:"PRODUCT_MUTATION",outcome:"BLOCKED_UNEXPECTED_WRITE"});
  for(const [url,method] of [[host+"/listMyRaffleClaimsExtra","POST"],[host+"/unknown","POST"],[host+"/listMyRaffleClaims","PATCH"],[host.replace("stg","prod")+"/listMyRaffleClaims","POST"]]) assert.equal(classifySafeDependency(url,method,"{}").outcome,"BLOCKED_UNEXPECTED_WRITE");
});
