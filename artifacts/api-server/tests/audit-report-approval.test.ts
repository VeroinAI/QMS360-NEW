import {describe,expect,it} from "vitest";
import {auditScheduleApprovalPermission} from "@workspace/field-controls";
import {submitReportApproval,reviewReportApproval,reportApprovalSummary,reportContentLocked,reportAssignmentAllowsProject,
  canReviewReport,type ReportReviewer} from "../src/lib/audit-report-approval";
const reviewer=(level:number,userId=`u${level}`,roleId=`r${level}`):ReportReviewer=>({
  level,userId,roleId,userName:userId,roleName:roleId,projectIds:["project-a"],businessUnitIds:[],
});
describe("Independent Audit Report approval",()=>{
  it("preserves legacy scheduling but keeps report-only roles out of scheduling",()=>{
    expect(auditScheduleApprovalPermission(["approve_reject"])).toBe(true);
    expect(auditScheduleApprovalPermission(["approve_reject","audit.audits.approve_reject"])).toBe(false);
    expect(auditScheduleApprovalPermission(["audit.audits.approve_reject"])).toBe(false);
    expect(auditScheduleApprovalPermission(["approve_reject","audit.audits.approve_reject","audit.schedules.approve_reject"])).toBe(true);
  });
  it("honors project authorization and organization-wide assignments, including projectless records",()=>{
    expect(reportAssignmentAllowsProject(["project-a"],"project-a")).toBe(true);
    expect(reportAssignmentAllowsProject(["project-b"],"project-a")).toBe(false);
    expect(reportAssignmentAllowsProject([], "project-a")).toBe(true);
    expect(reportAssignmentAllowsProject([],null)).toBe(true);
    expect(reportAssignmentAllowsProject(["project-a"],null)).toBe(false);
    expect(reportAssignmentAllowsProject([], "project-a", [], null, ["unit-a"])).toBe(false);
    expect(reportAssignmentAllowsProject([], null, [], null, ["unit-a"])).toBe(false);
    expect(reportAssignmentAllowsProject(["project-a"], "project-a", [], null, ["unit-a"])).toBe(true);
    expect(reportAssignmentAllowsProject(["project-b"], "project-a", [], null, ["unit-a"])).toBe(false);
    expect(reportAssignmentAllowsProject([], null, ["department-a"], "department-a", ["unit-a"])).toBe(true);
    expect(reportAssignmentAllowsProject([], null, ["department-a"], "department-b", ["unit-a"])).toBe(false);
  });
  it("groups same-level roles and requires every applicable role's saved level",()=>{
    const state=submitReportApproval([reviewer(3),reviewer(1),reviewer(1,"other","other-role"),reviewer(1)],"author");
    expect(state.steps.map(step=>step.level)).toEqual([1,3]);
    expect(state.steps[0]!.approvers).toHaveLength(2);
    expect(()=>submitReportApproval([],"author")).toThrow(/No Audit Report approvers/);
    expect(()=>submitReportApproval([{...reviewer(1),level:null}],"author")).toThrow(/Approval Level/);
  });
  it("moves sequentially, only allowing the current eligible reviewer, and closes at the final level",()=>{
    const people=[reviewer(1),reviewer(2)];
    const state=submitReportApproval(people,"author");
    expect(()=>reviewReportApproval(state,people,"u2","Two","approve")).toThrow(/current Audit Report approval level/);
    expect(canReviewReport(state,[],"u1")).toBe(false);
    const next=reviewReportApproval(state,people,"u1","One","approve");
    expect(next.status).toBe("Pending approval");
    expect(reportApprovalSummary(next).pendingLevel).toBe(2);
    const approved=reviewReportApproval(next,people,"u2","Two","approve");
    expect(approved.status).toBe("Approved");
    expect(approved.history).toHaveLength(2);
    expect(reportContentLocked(approved)).toBe(true);
    expect(()=>reviewReportApproval(approved,people,"u2","Two","approve")).toThrow(/no longer pending/);
    expect(state.index).toBe(0);
  });
  it("requires send-back remarks, unlocks corrections, and restarts with retained history",()=>{
    const people=[reviewer(1),reviewer(2)],state=submitReportApproval(people,"author");
    expect(()=>reviewReportApproval(state,people,"u1","One","send_back"," ")).toThrow(/changes required/);
    const back=reviewReportApproval(state,people,"u1","One","send_back","Please correct the scope.");
    expect(back.status).toBe("Sent back");
    expect(reportContentLocked(back)).toBe(false);
    const resubmitted=submitReportApproval(people,"author",back);
    expect(resubmitted.index).toBe(0);
    expect(resubmitted.history[0]!.remarks).toBe("Please correct the scope.");
    expect(reportContentLocked(resubmitted)).toBe(true);
  });
  it("does not silently skip a next level whose saved reviewer was revoked",()=>{
    const state=submitReportApproval([reviewer(1),reviewer(2)],"author");
    expect(()=>reviewReportApproval(state,[reviewer(1)],"u1","One","approve")).toThrow(/Level 2 has no eligible/);
    expect(state.index).toBe(0);
    expect(state.history).toEqual([]);
  });
  it("retains submitted levels despite later configuration changes",()=>{
    const state=submitReportApproval([reviewer(1),reviewer(2)],"author");
    const next=reviewReportApproval(state,[reviewer(10,"u1","r1"),reviewer(20,"u2","r2")],"u1","One","approve");
    expect(reportApprovalSummary(next).pendingLevel).toBe(2);
    expect(reportApprovalSummary().status).toBe("Not submitted");
  });
});
