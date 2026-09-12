/**
 * interactionCore — shared Wrapper/Trigger machinery for the CSS-only
 * interactivity hooks (useHide, useDisable).
 *
 * Both hooks need the same scoped container and a value-trigger that pair
 * with generated CSS selectors. This single factory produces that shell so
 * each hook only adds its own effect components.
 */

import type { JSX } from "react";
import { genId } from "../../../utils";

export type BuiltInCondition =
  | "valid"
  | "invalid"
  | "checked"
  | "unchecked"
  | "focused";

export type InteractionCondition<V extends string> = BuiltInCondition | V;

export type WrapperProps = {
  tag?: string;
  children?: any;
} & Record<string, any>;

export type TriggerProps = {
  value: string;
  children?: any;
};

export type EffectProps<V extends string> = {
  when: InteractionCondition<V>;
  tag?: string;
  children?: any;
} & Record<string, any>;

export interface Scope {
  scopeId: string;
  Wrapper: (props: WrapperProps) => any;
  Trigger: (props: TriggerProps) => any;
}

/**
 * Build the shared scoped container + value trigger for an interaction group.
 *
 * @param opts  Optional configuration (e.g. fixed scope name)
 */
export function makeScope(opts?: { scope?: string }): Scope {
  const scopeId = opts?.scope ?? genId();

  function Wrapper({ tag, children, ...rest }: WrapperProps) {
    const Tag = (tag ?? "div") as keyof JSX.IntrinsicElements;
    return (
      <Tag data-state-scope={scopeId} data-state-wrap {...rest}>
        {children}
      </Tag>
    );
  }

  function Trigger({ value, children }: TriggerProps) {
    const inject: Record<string, string> = { "data-state-value": value };

    if (
      children != null &&
      typeof children === "object" &&
      "tag" in children &&
      !Array.isArray(children)
    ) {
      const ChildTag = (children as any).tag as keyof JSX.IntrinsicElements;
      const childProps = (children as any).props || {};
      return (
        <ChildTag {...childProps} {...inject}>
          {(children as any).children}
        </ChildTag>
      );
    }

    return <span {...inject}>{children}</span>;
  }

  return { scopeId, Wrapper, Trigger };
}
