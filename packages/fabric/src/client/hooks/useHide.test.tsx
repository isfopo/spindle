import { describe, it, expect } from "vitest";
import { renderToString } from "hono/jsx/dom/server";
import { useHide } from "./useHide";

describe("useHide", () => {
  it("renders a scope with Show/Hide set and a Trigger", () => {
    const Plan = useHide<"plan", "free" | "pro">("plan");

    const html = renderToString(
      <Plan>
        <Plan.Trigger value="free">
          <input type="radio" name="plan" value="free" />
        </Plan.Trigger>
        <Plan.Show when="free">Free plan</Plan.Show>
        <Plan.Hide when="pro">Pro plan</Plan.Hide>
      </Plan>
    );

    expect(html).toContain('data-state-scope="plan-');
    expect(html).toContain("data-state-wrap");
    expect(html).toContain('data-state-value="free"');
    expect(html).toContain('data-state-show="free"');
    expect(html).toContain('data-state-hide="pro"');
    expect(html).toContain("Free plan");
    expect(html).toContain("Pro plan");
    expect(html).toContain("<style>");
  });

  it("renders a non-animated Show hidden by default", () => {
    const Form = useHide();
    const html = renderToString(
      <Form tag="form">
        <Form.Show when="valid">Valid</Form.Show>
      </Form>
    );

    expect(html).toContain('hidden=""');
    expect(html).toContain(":valid");
    expect(html).toContain("display: block");
  });

  it("renders a non-animated Hide visible by default, hidden on condition", () => {
    const Tog = useHide();
    const html = renderToString(
      <Tog>
        <Tog.Hide when="checked">Hide me</Tog.Hide>
      </Tog>
    );

    expect(html).not.toContain('hidden=""');
    expect(html).toContain('data-state-hide="checked"');
    expect(html).toContain("display: none");
  });

  it("applies an animation preset when animate is set", () => {
    const Toggle = useHide();
    const html = renderToString(
      <Toggle>
        <Toggle.Show when="checked" animate="fade">
          Content
        </Toggle.Show>
      </Toggle>
    );

    expect(html.match(/hidden=""/g)).toBeNull();
    expect(html).toContain("transition");
    expect(html).toContain("opacity 200ms");
    expect(html).toContain("opacity: 0");
    expect(html).toContain("visibility: hidden");
  });

  it("supports slide-up preset with offset", () => {
    const Anim = useHide();
    const html = renderToString(
      <Anim>
        <Anim.Show when="checked" animate="slide-up">
          Up
        </Anim.Show>
      </Anim>
    );

    expect(html).toContain("translateY(8px)");
    expect(html).toContain("opacity 200ms, transform 200ms");
  });

  it("uses :has(:checked) for the checked condition", () => {
    const Tog = useHide();
    const html = renderToString(
      <Tog>
        <Tog.Show when="checked">Visible when checked</Tog.Show>
      </Tog>
    );

    expect(html).toContain(":has(:checked)");
    expect(html).toContain('data-state-show="checked"');
  });

  it("uses a fixed scope when provided", () => {
    const Nav = useHide({ scope: "main-nav" });
    const html = renderToString(
      <Nav>
        <Nav.Show when="open">Menu</Nav.Show>
      </Nav>
    );

    expect(html).toContain('data-state-scope="main-nav"');
  });

  it("renders Wrapper and Show with a different tag", () => {
    const Form = useHide();
    const html = renderToString(
      <Form tag="form">
        <Form.Show when="valid" tag="span">
          Inline
        </Form.Show>
      </Form>
    );

    expect(html).toContain("<form");
    expect(html).toContain("<span");
    expect(html).toContain("display: inline");
  });

  it("passes extra props through Wrapper and Show", () => {
    const W = useHide();
    const html = renderToString(
      <W class="my-class" id="my-id">
        <W.Show when="x" class="custom-show">
          Show content
        </W.Show>
      </W>
    );

    expect(html).toContain('class="my-class"');
    expect(html).toContain('id="my-id"');
    expect(html).toContain('class="custom-show"');
  });

  it("generates unique scope ids for separate calls", () => {
    const A = useHide();
    const B = useHide();

    const htmlA = renderToString(<A><A.Show when="x">X</A.Show></A>);
    const htmlB = renderToString(<B><B.Show when="y">Y</B.Show></B>);

    expect(htmlA).toContain('data-state-scope="a-1"');
    expect(htmlB).toContain('data-state-scope="b-2"');
  });
});
