import { expect } from "@jest/globals";
const { container } = render(<Dialog />);
expect(document.activeElement).toBe(button);
it("has no violations", async () => {
  expect(await axe(container)).toHaveNoViolations();
});
