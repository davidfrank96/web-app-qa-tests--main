import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenlessContentObserved } from '../../utils/inssa-security-observations';
test('authorized tokenized content cannot be mislabeled a tokenless exposure',()=>{
 const artifacts=[{subject:'QA_subject',message:'QA_message'}];
 for(const context of ['clean-tokenized','authenticated-tokenized'])assert.equal(tokenlessContentObserved([{context,bodySample:'QA_subject QA_message'}],artifacts),false);
 for(const context of ['logged-out-tokenless','authenticated-tokenless'])assert.equal(tokenlessContentObserved([{context,bodySample:'QA_subject QA_message'}],artifacts),true);
 assert.equal(tokenlessContentObserved([{context:'logged-out-tokenless',bodySample:'Sign in'}],artifacts),false);
});
