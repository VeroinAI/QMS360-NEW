// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditPlanNumberingSettings } from "./audit-plan-numbering";
import { AuditReportNumberingSettings } from "./audit-report-numbering";
import { AuditFindingNumberingSettings } from "./audit-finding-numbering";
import { AuditCarNumberingSettings } from "./audit-car-numbering";
import { CsatNumberingSettings } from "./csat-numbering";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(), reset: vi.fn(), refetch: vi.fn(), toast: vi.fn(),
  data: {
    pattern: { prefix: "AGH", middle: "AP", separator: "-", padding: 4,
      codes: { "Minor NC": "MIN", "Major NC": "MAJ" } },
    findingTypes: ["Minor NC", "Major NC"],
    sources: [
      { key: "project:p", label: "Example project", kind: "project", sourceValue: "CTR100" },
      { key: "department:d", label: "Civil", kind: "department", sourceValue: "001" },
    ],
    ranges: {
      "project:p": { continuous: 125 }, "department:d": { continuous: 5 },
      "Minor NC": { "project:p": { continuous: 125 }, "department:d": { continuous: 5 } },
      "Major NC": { "project:p": { continuous: 3 } },
    },
  },
}));
vi.mock("@workspace/api-client-react", () => {
  const query = () => ({ data: mocks.data, refetch: mocks.refetch });
  const mutation = () => ({ mutate: mocks.mutate, reset: mocks.reset });
  return {
    useGetAuditPlanNumbering: query, useGetAuditReportNumbering: query,
    useGetAuditFindingNumbering: query, useGetAuditCarNumbering: query,
    useGetCsatNumbering: query, useUpdateCsatNumbering: mutation, useUpdateCsatNumberRange: mutation,
    useUpdateAuditPlanNumbering: mutation, useUpdateAuditReportNumbering: mutation,
    useUpdateAuditFindingNumbering: mutation, useUpdateAuditCarNumbering: mutation,
    useUpdateAuditPlanNumberRange: mutation, useUpdateAuditReportNumberRange: mutation,
    useUpdateAuditFindingNumberRange: mutation, useUpdateAuditCarNumberRange: mutation,
    getGetAuditFindingNumberingQueryKey: () => [], getGetAuditCarNumberingQueryKey: () => [],
  };
});
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const Context = React.createContext<(value: string) => void>(() => {});
  const Wrapper = ({ children }: any) => <div>{children}</div>;
  return {
    Select: ({ children, onValueChange }: any) => <Context.Provider value={onValueChange}>{children}</Context.Provider>,
    SelectTrigger: Wrapper, SelectContent: Wrapper, SelectValue: () => null,
    SelectItem: ({ children, value }: any) => {
      const select = React.useContext(Context);
      return <button type="button" onClick={() => select(value)}>{children}</button>;
    },
  };
});
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe.each([
  ["plan", AuditPlanNumberingSettings],
  ["report", AuditReportNumberingSettings],
  ["finding", AuditFindingNumberingSettings],
  ["car", AuditCarNumberingSettings],
  ["csat", CsatNumberingSettings],
] as const)("%s continuous numbering settings", (kind, Component) => {
  it("removes year inputs and saves last-used numbers, not next numbers", () => {
    render(<Component />);
    expect(screen.queryByLabelText(/year/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: kind === "csat" ? "Example project" : "Project — Example project" }));
    const input = screen.getByLabelText(/Last number already used/);
    expect((input as HTMLInputElement).value).toBe("125");
    expect(screen.getByTestId(kind === "csat" ? "csat-number-preview" : `audit-${kind}-number-preview`).textContent)
      .toBe(kind === "finding" ? "AGH-CTR100-MIN-0126" : "AGH-CTR100-AP-0126");
    fireEvent.change(input, { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: kind === "csat" ? "Save CSAT last-used number" : "Save last-used number" }));
    expect(mocks.mutate).toHaveBeenCalledWith({
      data: { ...(kind === "csat" ? { projectId: "project:p" } : { scope: "project:p" }),
        lastNumber: 250, ...(kind === "finding" ? { findingType: "Minor NC" } : {}) },
    }, expect.any(Object));
  });
  it("blocks backwards values and switches to the selected department's counter", () => {
    render(<Component />);
    fireEvent.click(screen.getByRole("button", { name: kind === "csat" ? "Example project" : "Project — Example project" }));
    const input = screen.getByLabelText(/Last number already used/);
    fireEvent.change(input, { target: { value: "124" } });
    expect((screen.getByRole("button", { name: kind === "csat" ? "Save CSAT last-used number" : "Save last-used number" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: kind === "csat" ? "Civil" : "Department — Civil" }));
    expect((input as HTMLInputElement).value).toBe("5");
    expect(screen.getByTestId(kind === "csat" ? "csat-number-preview" : `audit-${kind}-number-preview`).textContent).toContain("-001-");
  });
});

it("edits and saves CSAT middle text and uses it in the yearless preview", () => {
  render(<CsatNumberingSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Example project" }));
  fireEvent.change(screen.getByLabelText("Middle text"), { target: { value: "SURVEY" } });
  expect(screen.getByTestId("csat-number-preview").textContent).toBe("AGH-CTR100-SURVEY-0126");
  fireEvent.click(screen.getByRole("button", { name: "Save CSAT format" }));
  expect(mocks.mutate).toHaveBeenCalledWith({ data: expect.objectContaining({ middle: "SURVEY" }) }, expect.any(Object));
});

it("keeps finding-type selection and counters separate", () => {
  render(<AuditFindingNumberingSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Project — Example project" }));
  fireEvent.click(screen.getByRole("button", { name: "Major NC" }));
  expect((screen.getByLabelText(/Last number already used/) as HTMLInputElement).value).toBe("3");
  expect(screen.getByTestId("audit-finding-number-preview").textContent).toBe("AGH-CTR100-MAJ-0004");
});
