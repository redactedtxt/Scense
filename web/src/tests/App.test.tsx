import { render, screen } from "@testing-library/react";
import { App } from "../App";

describe("App", () => {
  it("shows the hello page", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hello, Scense");
  });
});
