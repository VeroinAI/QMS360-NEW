import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {CC_MODES,initialCcDraft,ccModeError,ccRecipientFromDraft,recipientModeForDraft,EmailRuleCcEditor} from './email-rule-cc-editor';
import {isReportAssignedToUser} from '../qaqc/reporting/approval-summary';

describe('CC recipient mode editor',()=>{
  it.each(CC_MODES)('allows shared workspace-role mode and excludes other matching To modes: $value',({value})=>{
    for(const option of CC_MODES)
      expect(!!ccModeError(option.value,value,'lessons.lesson_form.approve')).toBe(option.value===value&&value!=='workspace_role');
    expect(ccModeError('none',value,'lessons.lesson_form.approve')).toBeUndefined();
  });
  it('preserves legacy role-only rules in the editor until explicitly changed',()=>{
    const cc=initialCcDraft({ccRoleNames:['Reviewer']});
    expect(cc.mode).toBe('workspace_role');
    expect(ccRecipientFromDraft(cc)).toEqual({mode:'workspace_role',roleNames:['Reviewer']});
    expect(ccModeError(cc.mode,'workspace_role','lessons.lesson_form.approve')).toBeUndefined();
  });
  it('round-trips each explicitly saved CC mode and ignores inactive input values',()=>{
    for(const {value} of CC_MODES){
      const cc={...initialCcDraft(undefined),mode:value,userId:'a-user',name:' Copy ',email:' copy@example.test ',
        roleNames:['Reviewer','Reviewer'],roleName:' Reviewer ',projectIds:['a-project']};
      const saved=ccRecipientFromDraft(cc)!;
      expect(initialCcDraft({ccRecipient:saved}).mode).toBe(value);
      expect(saved.userId).toBe(value==='internal_user'?'a-user':undefined);
      expect(saved.email).toBe(value==='external_email'?'copy@example.test':undefined);
      expect(saved.roleNames).toEqual(value==='workspace_role'?['Reviewer']:undefined);
      expect(saved.projectIds).toEqual(['project_members','project_role'].includes(value)?['a-project']:undefined);
    }
    expect(ccRecipientFromDraft(initialCcDraft(undefined))).toBeUndefined();
  });
  it('maps existing To editor values to the same canonical modes',()=>{
    expect(recipientModeForDraft('user')).toBe('internal_user');
    expect(recipientModeForDraft('external')).toBe('external_email');
    expect(recipientModeForDraft('role')).toBe('workspace_role');
    expect(recipientModeForDraft('project')).toBe('project_members');
    expect(recipientModeForDraft('default')).toBe('all_users');
  });
  it('keeps linked Lessons modes unavailable outside Lessons',()=>{
    expect(ccModeError('linked_creator','internal_user','audit.audit_schedule.approve')).toContain('only available');
    expect(ccModeError('linked_approver','internal_user','qaqc.daily_report.submit')).toContain('only available');
  });
  it.each(['internal_user','external_email','workspace_role','project_members','project_role'] as const)('renders the corresponding CC controls for %s',mode=>{
    const html=renderToStaticMarkup(<EmailRuleCcEditor value={{...initialCcDraft(undefined),mode}}
      onChange={()=>{}} toMode="all_users" eventType="lessons.lesson_form.approve"
      users={[{id:'user',fullName:'Reviewer'}]} projects={[{id:'project',name:'Project'}]} roles={[{id:'role',name:'Manager'}]}/>);
    expect(html).toContain('CC recipient mode');
    expect(html).toContain({internal_user:'Internal CC user',external_email:'CC recipient email',workspace_role:'CC application workspace roles',project_members:'CC project',project_role:'CC workspace role name'}[mode]);
  });
  it('preserves saved CC roles when To also uses workspace roles without a conflict',()=>{
    const html=renderToStaticMarkup(<EmailRuleCcEditor value={initialCcDraft({ccRoleNames:['Manager']})} onChange={()=>{}}
      toMode="workspace_role" eventType="lessons.lesson_form.approve" users={[]} projects={[]} roles={[{id:'role',name:'Manager'}]}/>);
    expect(html).not.toContain('CC recipient mode must differ');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('checked=""');
    expect(html).toContain('separate role selections');
  });
});
describe('Pending report assignment identity',()=>{
  it('uses the selected current reviewer, never a future candidate or an empty identity',()=>{
    expect(isReportAssignedToUser({state:'submitted',approverId:'current'},'current')).toBe(true);
    expect(isReportAssignedToUser({state:'submitted',approverId:'current'},'future')).toBe(false);
    expect(isReportAssignedToUser({state:'submitted'},undefined)).toBe(false);
    expect(isReportAssignedToUser({state:'draft',approverId:'current'},'current')).toBe(false);
  });
});
