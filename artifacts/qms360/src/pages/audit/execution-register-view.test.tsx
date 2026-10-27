// @vitest-environment jsdom
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EXECUTION_COLUMNS, ExecutionRegisterTable } from "./execution-register-view";

afterEach(cleanup);

describe("Audit Execution register scrolling", () => {
  it("makes the accessible region the single scroll owner, without a nested table overflow trap", () => {
    render(<ExecutionRegisterTable rows={[]} renderActions={() => null}/>);
    const region = screen.getByRole("region", { name: "Audit execution register" });
    const table = region.querySelector(":scope > table");
    expect(table).not.toBeNull();
    expect(region.querySelectorAll("div")).toHaveLength(0);
    expect(region.className).toContain("overflow-x-auto");
    expect(region.tabIndex).toBe(0);
    expect(table?.className).toContain("min-w-[1400px]");
    expect(screen.getAllByRole("columnheader").map(header => header.textContent))
      .toEqual([...EXECUTION_COLUMNS, "Actions"]);
  });
});
