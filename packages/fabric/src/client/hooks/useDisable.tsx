/**
 * useDisable — server-side component factory for CSS-only disable/enable.
 *
 * Dims and blocks an element until a condition is met (form validity, radio
 * selection, focus, etc.) using generated data attributes and CSS rules —
 * no selectors to write, no client-side JS.
 *
 * Usage:
 *
 *   const Confirm = useDisable({ scope: "confirm" });
 *
 *   <Confirm>
 *     <Confirm.Trigger value="agree">
 *       <input type="checkbox" />
 *     </Confirm.Trigger>
 *     <Confirm.Disable when="unchecked">
 *       <button type="submit">Submit</button>
 *     </Confirm.Disable>
 *   </Confirm>
 *
 * The target renders enabled by default and dims/blocks (opacity 0.5,
 * pointer-events none, user-select none) when the condition matches. The
 * `time` option sets the transition so it fades smoothly between the enabled
 * and disabled states. Animation presets do not apply to disable/enable.
 */

import { JSX } from "react";
import { buildConditionSelector, cssBlock } from "../../utils";
import { makeScope, type EffectProps } from "./shared/interactionCore";

export type DisableEffectProps<V extends string> = EffectProps<V>;

export interface DisableOptions {
  scope?: string;
  time?: `${number}${"s" | "ms"}`;
}

const DISABLED: Record<string, string> = {
  opacity: "0.5",
  pointerEvents: "none",
  userSelect: "none",
};

const ENABLED: Record<string, string> = {
  opacity: "1",
  pointerEvents: "auto",
  userSelect: "auto",
};

/**
 * Create a scoped Wrapper + Trigger + Disable set for CSS-only disable/enable.
 *
 * @typeParam V  Allowed condition values for `when` (defaults to `string`)
 * @param opts  Optional configuration (scope name, fade timing)
 */
export function useDisable<V extends string = string>(opts: DisableOptions = { time: "150ms" }) {
  const { scopeId, Wrapper, Trigger } = makeScope({ scope: opts.scope });
  const time = opts.time ?? "150ms";

  function Disable({ when, tag, children, ...rest }: DisableEffectProps<V>) {
    const Tag = (tag ?? "div") as keyof JSX.IntrinsicElements;
    const scopeSelector = `[data-state-scope="${scopeId}"]`;
    const condSelector = buildConditionSelector(when, scopeSelector);
    const targetAttr = `data-state-disable="${when}"`;
    const transition = `opacity ${time}`;

    const baseRule = `${scopeSelector} [${targetAttr}] { ${cssBlock(ENABLED)}; transition: ${transition}; }`;
    const disabledRule = `${condSelector} [${targetAttr}] { ${cssBlock(DISABLED)}; transition: ${transition}; }`;
    const css = `${baseRule}\n${disabledRule}`;

    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <Tag data-state-disable={when} {...rest}>
          {children}
        </Tag>
      </>
    );
  }

  // Object.assign yields the Wrapper type intersected with its statics, so
  // consumers see <Field.Trigger> / <Field.Disable> as members.
  return Object.assign(Wrapper, { Trigger, Disable });
}
