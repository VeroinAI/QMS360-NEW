import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DailyForm } from './daily-form';
import { FormCtx } from './form-kit';
import { DailyValidationIssues, jumpToDailyIssue } from './daily-validation-navigation';
import { calcDaily, dailyPaths, dailyValidationIssues, zeroFill, type Obj } from './reporting-types';

afterEach(() => vi.unstubAllGlobals());
function render(data: Obj = {}, readOnly = false, locked = false) {
  const calculated = calcDaily(data);
  return renderToStaticMarkup(<>
    <FormCtx.Provider value={{data, readOnly, fc: () => ({disabled: locked, required: true}), set: () => {}}}>
      <DailyForm calc={calculated} baseline={{}} />
    </FormCtx.Provider>
    <DailyValidationIssues rootRef={{current:null}} issues={calculated.validationIssues} />
  </>);
}
/** The same small DOM doubles as Monthly's navigation tests; no extra browser dependency. */
function destination(path: string, disabled = false, readonly = false) {
  const parent = {tabIndex:0, focus:vi.fn(), tagName:'TD', parentElement:null as any};
  const input = {dataset:{reportField:path},parentElement:parent,scrollIntoView:vi.fn(),focus:vi.fn(),
    matches:vi.fn(() => disabled),hasAttribute:vi.fn(() => readonly),disabled,value:''};
  const unrelated = {dataset:{reportField:'unrelated'},focus:vi.fn()};
  const root = {querySelectorAll:vi.fn(() => [unrelated,input])};
  const outer = {tagName:'DETAILS',open:false,parentElement:root};
  const inner = {tagName:'DETAILS',open:false,parentElement:outer};
  parent.parentElement=inner;
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callback(0);return 1;});
  return {root:root as unknown as HTMLElement,input,parent,inner,outer,unrelated};
}
describe('Daily field-specific validation', () => {
  it('lists every missing required count separately with contextual labels and exact rendered targets', () => {
    const html=render(),issues=dailyValidationIssues({});
    expect(issues).toHaveLength(108);
    expect(issues.map(issue=>issue.path).sort()).toEqual(dailyPaths().map(path=>path.join('.')).sort());
    const buttonTags: string[] = html.match(/<button\b[^>]*>/g)??[];
    expect(buttonTags.filter(tag=>tag.includes('text-left underline'))).toHaveLength(108);
    for(const issue of issues)expect(html).toContain(`data-report-field="${issue.path}"`);
    for(const label of ['Drawings → Civil → Approved','Submittals → Electrical → Under review',
      'Document Types → Vendor Documents','Correspondence → Incoming','Rejected Submissions → Calculation','Pending Days → Client →'])
      expect(html).toContain(label);
    expect(html).not.toContain('current numeric fields are still blank');
    expect(html).toContain('max-h-96');
  });
  it.each([undefined,null,'',-1,0.5,NaN,Infinity,'2'])('identifies missing or invalid count %s instead of treating it as zero', value=>{
    const data=zeroFill('daily',{});data.correspondence.incoming=value;
    expect(dailyValidationIssues(data)).toMatchObject([{path:'correspondence.incoming'}]);
    expect(dailyValidationIssues(data)).toHaveLength(1);
  });
  it('accepts explicit zero and removes each corrected issue without hiding remaining ones',()=>{
    const data:Obj={disciplines:{drawings:{Civil:{approved:0}}}};
    expect(dailyValidationIssues(data)).toHaveLength(107);
    expect(dailyValidationIssues(data).some(issue=>issue.path==='disciplines.drawings.Civil.approved')).toBe(false);
    expect(dailyValidationIssues(data).some(issue=>issue.path==='disciplines.submittals.Civil.approved')).toBe(true);
    expect(render(zeroFill('daily',data))).toContain('No issues found');
    expect(dailyValidationIssues(zeroFill('daily',data))).toEqual([]);
  });
  it('validates supplied legacy values without making absent optional legacy types required',()=>{
    const data=zeroFill('daily',{});
    expect(dailyValidationIssues(data)).toEqual([]);
    data.documentTypes.IFR=-2;
    expect(dailyValidationIssues(data)).toMatchObject([{path:'documentTypes.IFR'}]);
    expect(render(data)).toContain('data-report-field="documentTypes.IFR"');
  });
  it('identifies revision names, duplicates and counts on their exact rows; names may repeat across categories',()=>{
    const data=zeroFill('daily',{});
    data.revisions={drawings:[{name:'A',value:0},{name:' a ',value:undefined},{name:'',value:-1}],submittals:[{name:'A',value:0}]};
    const issues=dailyValidationIssues(data),html=render(data);
    expect(issues.map(issue=>issue.path)).toEqual(['revisions.drawings.1.name','revisions.drawings.1.value','revisions.drawings.2.name','revisions.drawings.2.value']);
    expect(issues[0].message).toContain('Drawing row 2');
    for(const issue of issues)expect(html).toContain(`data-report-field="${issue.path}"`);
  });
  it('preserves current input locks and read-only form state',()=>{
    for(const [readOnly,locked] of [[true,false],[false,true]]){
      const html=render({},readOnly,locked);
      expect(html).toMatch(/data-report-field="correspondence.incoming"[^>]*disabled=""/);
    }
  });
});
describe('Daily validation navigation',()=>{
  it.each(['disciplines.drawings.Civil.approved','documentTypes.Vendors','correspondence.incoming',
    'rejectedSubmissions.general','pending.Supplier.E.over30','revisions.drawings.1.name','revisions.submittals.0.value'])('reveals all collapsed parents and focuses the correct current field: %s',path=>{
    const {root,input,inner,outer,unrelated}=destination(path);
    expect(jumpToDailyIssue(root,path)).toBe(true);
    expect(inner.open).toBe(true);expect(outer.open).toBe(true);
    expect(input.focus).toHaveBeenCalledWith({preventScroll:true});
    expect(unrelated.focus).not.toHaveBeenCalled();
    expect(input.scrollIntoView).toHaveBeenCalledWith({behavior:'smooth',block:'center',inline:'nearest'});
    expect(input.value).toBe('');
  });
  it.each([[true,false],[false,true]])('does not unlock disabled or read-only fields (%s, %s)',(disabled,readonly)=>{
    const {root,input,parent}=destination('correspondence.incoming',disabled,readonly);
    jumpToDailyIssue(root,'correspondence.incoming');
    expect(input.focus).not.toHaveBeenCalled();
    expect(parent.focus).toHaveBeenCalledWith({preventScroll:true});
    expect(input.disabled).toBe(disabled);expect(input.value).toBe('');
  });
  it('wires the visible error button to its exact path',()=>{
    const issue={path:'pending.Supplier.E.over30',message:'Pending supplier count is required'};
    const {root,input}=destination(issue.path);
    const element=DailyValidationIssues({issues:[issue],rootRef:{current:root}}) as any;
    const button=element.props.children[1].props.children[0].props.children;
    expect(button.type).toBe('button');
    expect(button.props.type).toBe('button');
    button.props.onClick();
    expect(input.focus).toHaveBeenCalled();
  });
  it('returns safely for a removed dynamic row without escaping the form root',()=>{
    const {root}=destination('unrelated');
    expect(jumpToDailyIssue(root,'revisions.drawings.9.name')).toBe(false);
    const element=DailyValidationIssues({issues:[{path:'removed',message:'Missing row'}],rootRef:{current:null}}) as any;
    expect(()=>element.props.children[1].props.children[0].props.children.props.onClick()).not.toThrow();
  });
});
