import { fireEvent, render, screen } from "@testing-library/react";
import { BottleImage } from "../components/BottleImage";

describe("BottleImage", () => {
  it("shows the photo, lazily when asked", () => {
    render(<BottleImage src="https://img.test/a.jpg" family="Woods" alt="A bottle" lazy />);
    const img = screen.getByRole("img", { name: "A bottle" });
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("swaps in a placeholder tinted by the family when the photo fails", () => {
    render(<BottleImage src="https://img.test/blocked.jpg" family="Soft Floral" alt="A bottle" />);
    fireEvent.error(screen.getByRole("img", { name: "A bottle" }));
    const placeholder = screen.getByTestId("placeholder-bottle");
    expect(placeholder).toHaveStyle({ color: "var(--color-family-soft-floral)" });
    expect(screen.getByRole("img", { name: "A bottle" })).toBe(placeholder);
  });

  it("uses the placeholder when there is no image URL", () => {
    render(<BottleImage src={null} family="Citrus" />);
    expect(screen.getByTestId("placeholder-bottle")).toBeInTheDocument();
  });
});
