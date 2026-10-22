import { describe, it, expect } from 'vitest';
import { historicalAuditChanges } from './historical-balances-validation';
const fields = [{key:'metrics.rfi.accumulatedIssued',label:'RFI — Acc. till Last Month'}, {key:'qtbt.accumulatedManhours',label:'QTBT — Accumulated hours'}];
describe('Historical audit balance display',()=>{
  it('extracts numeric old/new balances without rendering envelope objects or request metadata',()=>{
    const changes=historicalAuditChanges(fields,
      {version:1,reason:'Original reason',balances:{[fields[0].key]:100,[fields[1].key]:45.5}},
      {version:2,reason:'Correction reason',balances:{[fields[0].key]:101,[fields[1].key]:45.5},_requestIp:'example',updatedDrafts:1});
    expect(changes).toEqual([{...fields[0],before:100,after:101}]);
  });
  it('preserves zeros and decimal hours and supports flat legacy audit values',()=>{
    expect(historicalAuditChanges(fields,{[fields[1].key]:0},{balances:{[fields[1].key]:18.25}}))
      .toEqual([{...fields[1],before:0,after:18.25}]);
  });
  it('never formats nested metadata as a balance value',()=>{
    expect(historicalAuditChanges(fields,null,{balances:{[fields[0].key]:{value:10}}})).toEqual([]);
  });
});
