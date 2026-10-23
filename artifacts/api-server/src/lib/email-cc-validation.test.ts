import {describe,it,expect} from 'vitest';
import {CreateEmailRuleBody} from '@workspace/api-zod';
import {emailCcTargetError,type CcTarget} from './email-cc-validation';
const event='lessons.lesson_form.approve';
const valid: CcTarget[]=[
  {mode:'all_users'}, {mode:'internal_user',userId:'12345678-1234-1234-1234-123456789012'},
  {mode:'external_email',name:'Copy',email:'copy@example.test'},
  {mode:'workspace_role',roleNames:['Reviewer']},
  {mode:'project_members',projectIds:['12345678-1234-1234-1234-123456789012']},
  {mode:'project_role',roleName:'Reviewer',projectIds:['12345678-1234-1234-1234-123456789012']},
  {mode:'linked_approver'},{mode:'linked_creator'},
];
describe('CC target server validation',()=>{
  it.each(valid)('rejects matching To and CC modes: $mode',cc=>{
    expect(emailCcTargetError(cc.mode,cc,event)).toContain('must differ');
  });
  it.each(valid)('accepts and preserves a valid distinct mode: $mode',cc=>{
    const toMode=cc.mode==='all_users'?'internal_user':'all_users';
    expect(emailCcTargetError(toMode,cc,event)).toBeUndefined();
    const parsed=CreateEmailRuleBody.parse({name:'Rule',enabled:true,priority:0,eventType:event,recipientMode:toMode,recipientConfig:{ccRecipient:cc}});
    expect(parsed.recipientConfig?.ccRecipient).toEqual(cc);
  });
  it.each([{mode:'unknown'},{mode:'internal_user'},{mode:'external_email',name:'Name',email:'bad'},
    {mode:'workspace_role',roleNames:[]},{mode:'project_role',projectIds:['project']},
    {mode:'project_members'},{mode:'project_role',roleName:'Reviewer'}])('rejects incomplete or unknown targets: %j',cc=>{
    expect(emailCcTargetError('all_users',cc,event)).toBeTruthy();
  });
  it('does not activate a CC mode if no CC is configured',()=>{
    expect(emailCcTargetError('all_users',undefined,event)).toBeUndefined();
  });
  it('restricts linked modes to Lessons and validates UUIDs before querying the database',()=>{
    expect(emailCcTargetError('all_users',{mode:'linked_creator'},'audit.audit_schedule.approve')).toContain('only available');
    for(const cc of [{mode:'internal_user',userId:'invalid'},{mode:'project_members',projectIds:['invalid']}]){
      expect(CreateEmailRuleBody.safeParse({name:'Rule',enabled:true,priority:0,eventType:event,recipientMode:'all_users',recipientConfig:{ccRecipient:cc}}).success).toBe(false);
    }
  });
});
