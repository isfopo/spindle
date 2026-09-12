import { describe, it, expect } from "vitest";
import { renderToString } from "hono/jsx/dom/server";
import { useDisable } from "./useDisable";

describe("useDisable", () => {
  it("renders a scope with Disable and a Trigger", () => {
    const Confirm = useDisable("confirm");

    const html = renderToString(
      <Confirm>
        <Confirm.Trigger value="agree">
          <input type="checkbox" name="agree" />
        </Confirm.Trigger>
        <Confirm.Disable when="unchecked">
          <button type="submit">Submit</button>
        </Confirm.Disable>
      </Confirm>
    );

    expect(html).toContain('data-state-scope="confirm-');
    expect(html).toContain("data-state-wrap");
    expect(html).toContain('data-state-value="agree"');
    expect(html).toContain('data-state-disable="unchecked"');
    expect(html).toContain("<style>");
  });

  it("renders the target enabled by default and dims on condition", () => {
    const Confirm = useDisable();

    const html = renderToString(
      <Confirm>
        <Confirm.Disable when="unchecked">
          <button>Submit</button>
        </Confirm.Disable>
      </Confirm>
    );

    // enabled base
    expect(html).toContain("opacity: 1");
    expect(html).toContain("pointer-events: auto");
    // dimmed on condition
    expect(html).toContain("opacity: 0.5");
    expect(html).toContain("pointer-events: none");
    expect(html).toContain("user-select: none");
  });

  it("uses the :has(:checked) condition selector for unchecked", () => {
    const Confirm = useDisable();

    const html = renderToString(
      <Confirm>
        <Confirm.Disable when="unchecked">
          <button>Submit</button>
        </Confirm.Disable>
      </Confirm>
    );

    expect(html).toContain(":not(:has(:checked))");
  });

  it("applies a fade transition using the time option", () => {
    const Confirm = useDisable({ time: "300ms" });

    const html = renderToString(
      <Confirm>
        <Confirm.Disable when="unchecked">
          <button>Submit</button>
        </Confirm.Disable>
      </Confirm>
    );

    expect(html).toContain("transition: opacity 300ms");
  });

  it("uses a default fade transition when time is omitted", () => {
    const Confirm = useDisable();

    const html = renderToString(
      <Confirm>
        <Confirm.Disable when="x">
          <button>Submit</button>
        </Confirm.Disable>
      </Confirm>
    );

    expect(html).toContain("transition: opacity 150ms");
  });

  it("does not emit animation preset CSS", () => {
    const Confirm = useDisable();

    const html = renderToString(
      <Confirm>
        <Confirm.Disable when="x">
          <button>Submit</button>
        </Confirm.Disable>
      </Confirm>
    );

    expect(html).not.toContain("visibility: hidden");
    expect(html).not.toContain("translate");
    expect(html).not.toContain("scale(");
  });

  it("uses a fixed scope when provided", () => {
    const Form = useDisable({ scope: "form-actions" });
    const html = renderToString(
      <Form tag="form">
        <Form.Disable when="invalid">
          <button>Submit</button>
        </Form.Disable>
      </Form>
    );

    expect(html).toContain('data-state-scope="form-actions"');
    expect(html).toContain(":invalid");
    expect(html).toContain("<form");
  });

  it("passes extra props through Wrapper and Disable", () => {
    const W = useDisable();
    const html = renderToString(
      <W class="actions">
        <W.Disable when="x" id="submit" data-test="disable-me">
          <button>Go</button>
        </W.Disable>
      </W>
    );

    expect(html).toContain('class="actions"');
    expect(html).toContain('id="submit"');
    expect(html).toContain('data-test="disable-me"');
  });
});
