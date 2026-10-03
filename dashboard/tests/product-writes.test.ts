import test from "node:test";
import assert from "node:assert/strict";
import { firestoreWrites, isExpectedInssaAccountMetadata } from "../../utils/inssa-product-writes";
const url="https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel";
const document=(collection:string)=>`projects/fixture/databases/(default)/documents/${collection}/redacted`;
test("write audit parses encoded update and transform field names without retaining values",()=>{
  const payload={writes:[{update:{name:document('users'),fields:{fcmSyncStatus:{stringValue:'private'}}}},{update:{name:document('users')},updateTransforms:[{fieldPath:'lastActive',setToServerValue:'REQUEST_TIME'}]}]};
  const rows=firestoreWrites(url,new URLSearchParams({'req0___data__':JSON.stringify(payload)}).toString());
  assert.equal(rows.length,2);assert.ok(rows.every(isExpectedInssaAccountMetadata));assert.ok(!JSON.stringify(rows).includes('private'));
});
test("capsule writes, media writes, profile edits and deletes are never expected Safe side effects",()=>{
  const writes=[{update:{name:document('timeCapsules'),fields:{status:{stringValue:'draft'}}}},{update:{name:document('media')}},{update:{name:document('users'),fields:{name:{stringValue:'changed'}}}},{delete:document('timeCapsules')}];
  assert.ok(firestoreWrites(url,JSON.stringify({writes})).every(row=>!isExpectedInssaAccountMetadata(row)));
  assert.deepEqual(firestoreWrites(url,JSON.stringify({database:'fixture'})),[]);
  assert.deepEqual(firestoreWrites(url.replace('/Write/','/Listen/'),JSON.stringify({writes})),[]);
  assert.throws(()=>firestoreWrites(url,'req0___data__=invalid'));
});
