/**
 * useHide — server-side component factory for CSS-only show/hide interactivity.
 *
 * Declare visibility (show/hide based on form validity, radio selection,
 * focus, etc.) in JSX. Data attributes and CSS rules using :has(), :valid,
 * :focus-within, and :checked are generated automatically — no selectors to
 * write, no client-side JS.
 *
 * Usage:
 *
 *   const Plan = useHide<"free" | "pro">({ scope: "plan" });
 *
 *   <Plan>
 *     <Plan.Trigger value="free">
 *       <input type="radio" name="plan" value="free" />
 *     </Plan.Trigger>
 *     <Plan.Show when="free">Free tier</Plan.Show>
 *     <Plan.Hide when="pro">Pro tier</Plan.Hide>
 *   </Plan>
 *
 * Each Wrapper auto-generates a unique scope ID and emits a <style> block
 * with scoped CSS rules. Provide a `scope` option to use a fixed name
 * instead.
 *
 * Animation presets (fade, slide-up, slide-down, scale, slide-left, slide-right)
 * switch from display:none to opacity/visibility/transform so CSS transitions
 * can animate. A per-effect `transition` prop overrides the group's timing.
 */

import { JSX } from "react";
import { buildConditionSelector, cssBlock, TAG_DISPLAY } from "../../utils";
import {
  makeScope,
  type EffectProps,
  type InteractionCondition,
} from "./shared/interactionCore";

export type AnimationPresetName =
  | "none"
  | "fade"
  | "fade-in"
  | "slide-up"
  | "slide-down"
  | "scale"
  | "slide-left"
  | "slide-right";

export interface AnimationPreset {
  hidden: Record<string, string>;
  transition: string;
}

export type HideEffectProps<V extends string> = EffectProps<V> & {
  animate?: AnimationPresetName;
  transition?: string;
};

export interface HideOptions {
  scope?: string;
  time?: `${number}${"s" | "ms"}`;
  offset?: `${number}${"px" | "em" | "rem"}`;
  scale?: number;
}

/**
 * Create a scoped Wrapper + Trigger + Show/Hide set for CSS-only show/hide.
 *
 * @typeParam V  Allowed condition values for `when` (defaults to `string`)
 * @param opts  Optional configuration (scope name, timing)
 */
export function useHide<V extends string = string>(
  opts: HideOptions = { time: "200ms", offset: "8px", scale: 0.95 },
) {
  const { scopeId, Wrapper, Trigger } = makeScope({ scope: opts.scope });
  const time = opts.time ?? "200ms";
  const offset = opts.offset ?? "8px";
  const scale = opts.scale ?? 0.95;

  const HIDDEN_BASE: Record<string, string> = {
    opacity: "0",
    pointerEvents: "none",
    visibility: "hidden",
  };

  const ANIMATION_PRESETS: Record<AnimationPresetName, AnimationPreset> = {
    none: { hidden: HIDDEN_BASE, transition: "" },
    "fade": { hidden: HIDDEN_BASE, transition: `opacity ${time}` },
    "fade-in": { hidden: HIDDEN_BASE, transition: `opacity ${time}` },
    "slide-up": {
      hidden: { ...HIDDEN_BASE, transform: `translateY(${offset})` },
      transition: `opacity ${time}, transform ${time}`,
    },
    "slide-down": {
      hidden: { ...HIDDEN_BASE, transform: `translateY(-${offset})` },
      transition: `opacity ${time}, transform ${time}`,
    },
    "scale": {
      hidden: { ...HIDDEN_BASE, transform: `scale(${scale})` },
      transition: `opacity ${time}, transform ${time}`,
    },
    "slide-left": {
      hidden: { ...HIDDEN_BASE, transform: `translateX(${offset})` },
      transition: `opacity ${time}, transform ${time}`,
    },
    "slide-right": {
      hidden: { ...HIDDEN_BASE, transform: `translateX(-${offset})` },
      transition: `opacity ${time}, transform ${time}`,
    },
  };

  function effectCSS(
    type: "show" | "hide",
    when: string,
    tag: string,
    animate: AnimationPresetName = "none",
  ): string {
    const scopeSelector = `[data-state-scope="${scopeId}"]`;
    const condSelector = buildConditionSelector(when, scopeSelector);
    const targetAttr = `data-state-${type}`;
    const displayValue = TAG_DISPLAY[tag] ?? "block";
    const preset = ANIMATION_PRESETS[animate];
    const { transition } = preset;
    const lines: string[] = [];

    if (type === "show") {
      if (preset) {
        lines.push(
          `${scopeSelector} [${targetAttr}="${when}"] { ${cssBlock(preset.hidden)}; transition: ${transition}; }`,
        );
        lines.push(
          `${condSelector} [${targetAttr}="${when}"] { opacity: 1; pointer-events: auto; visibility: visible; transition: ${transition}; }`,
        );
      } else {
        lines.push(`${condSelector} [${targetAttr}="${when}"] { display: ${displayValue} !important; }`);
      }
    } else {
      if (preset) {
        lines.push(
          `${scopeSelector} [${targetAttr}="${when}"] { transition: ${transition}; }`,
        );
        lines.push(
          `${condSelector} [${targetAttr}="${when}"] { ${cssBlock(preset.hidden)}; transition: ${transition}; }`,
        );
      } else {
        lines.push(`${condSelector} [${targetAttr}="${when}"] { display: none; }`);
      }
    }

    return lines.join("\n");
  }

  function Show({
    when, tag, animate, transition, children, ...rest
  }: HideEffectProps<V>) {
    const isAnimated = !!(animate ?? transition);
    const Tag = (tag ?? "div") as keyof JSX.IntrinsicElements;
    const css = effectCSS("show", when, tag ?? "div", animate);

    return (
      <>
        {css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null}
        <Tag
          data-state-show={when}
          {...(isAnimated ? {} : { hidden: true })}
          {...rest}
        >
          {children}
        </Tag>
      </>
    );
  }

  function Hide({
    when, tag, animate, transition, children, ...rest
  }: HideEffectProps<V>) {
    const Tag = (tag ?? "div") as keyof JSX.IntrinsicElements;
    const css = effectCSS("hide", when, tag ?? "div", animate);

    return (
      <>
        {css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null}
        <Tag data-state-hide={when} {...rest}>
          {children}
        </Tag>
      </>
    );
  }

  // Object.assign yields the Wrapper type intersected with its statics, so
  // consumers see <Plan.Trigger> / <Plan.Show> / <Plan.Hide> as members.
  return Object.assign(Wrapper, { Trigger, Show, Hide });
}
