import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it("renders running status with a pulse dot", () => {
    render(<StatusBadge status="running" />);
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(document.querySelector("span.animate-pulse")).toBeInTheDocument();
  });

  it("renders info status with an explicit pulse", () => {
    render(<StatusBadge status="info" pulse />);
    expect(screen.getByText("Info")).toBeInTheDocument();
    expect(document.querySelector("span.animate-pulse")).toBeInTheDocument();
  });

  it("renders failed status without a pulse dot", () => {
    render(<StatusBadge status="failed" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(
      document.querySelector("span.animate-pulse"),
    ).not.toBeInTheDocument();
  });

  it("falls back to the raw status when unknown", () => {
    render(<StatusBadge status="custom_state" />);
    expect(screen.getByText("custom_state")).toBeInTheDocument();
  });
});
