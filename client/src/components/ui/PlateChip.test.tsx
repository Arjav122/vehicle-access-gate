import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlateChip } from "./PlateChip";

describe("PlateChip", () => {
  it("draws the plate grouped as printed, with the IND strip", () => {
    const { container } = render(<PlateChip plate="UP16AB1234" />);
    expect(container.textContent).toBe("INDUP16AB1234");
    const groups = Array.from(container.querySelectorAll("span > span:last-child > span")).map(
      (s) => s.textContent,
    );
    expect(groups).toEqual(["UP16", "AB", "1234"]);
  });

  it("is read out character by character, group by group", () => {
    render(<PlateChip plate="22BH1234AA" />);
    expect(
      screen.getByRole("img", { name: "Number plate 2 2, B H, 1 2 3 4, A A" }),
    ).toBeInTheDocument();
  });
});
