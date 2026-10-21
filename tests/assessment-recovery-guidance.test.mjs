import test from 'node:test';
import assert from 'node:assert/strict';
import {qaOwnerActionForResult_} from '../src/engine/reporting/actions.js';

const base={verdict:'UNVERIFIED',issues:['SOURCE_DESTINATION_MATCH_UNCONFIRMED']};
test('ambiguous structural candidates retain item IDs without claiming a confirmed match',()=>{
  const result={...base,checks:{mappingAmbiguity:{status:'AMBIGUOUS',candidates:[{itemId:'candidate-a',name:'Assessment'},{itemId:'candidate-b',name:'Assessment'}]}}};
  const before=JSON.stringify(result);
  const action=qaOwnerActionForResult_(result);
  assert.match(action.action,/Assessment \[candidate-a\].*Assessment \[candidate-b\]/);
  assert.match(action.action,/unconfirmed destination candidates/);
  assert.doesNotMatch(action.action,/identity matches|with \./);
  assert.equal(action.severity,'EVIDENCE');
  assert.equal(JSON.stringify(result),before);
});
test('missing or malformed candidate evidence produces actionable unresolved guidance',()=>{
  for(const candidates of [undefined,[],[null,{name:'No identity'}]]){
    const action=qaOwnerActionForResult_({...base,checks:{reconciliationDiagnostic:{candidates}}});
    assert.match(action.action,/No destination candidate with a recorded item ID/);
    assert.doesNotMatch(action.action,/undefined|with \./);
    assert.match(action.action,/No missing activity or verified equivalence/);
  }
});
test('legacy reconciliation IDs remain visible without becoming verified identity',()=>{
  const action=qaOwnerActionForResult_({...base,checks:{reconciliationDiagnostic:{candidates:[{id:'discussion-id',name:'Discussion'}]}}});
  assert.match(action.action,/Discussion \[discussion-id\]/);
  assert.match(action.action,/unique destination match.*not established/);
});
