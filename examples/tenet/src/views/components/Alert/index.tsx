import type { FC, PropsWithChildren } from "hono/jsx";
import styles from "./index.module.css";
import { useHandler } from "@spindle/spindle/fabric";
import { DismissHandler } from "views/handlers/DismissHandler";

export type AlertVariant = "info" | "success" | "warning" | "error";

export interface AlertProps extends PropsWithChildren {
  variant: AlertVariant;
  header: string;
  subheader?: string;
}

export const Alert: FC<AlertProps> = ({ variant, header, children }) => {
  const Dismiss = useHandler(DismissHandler);

  return (
    <Dismiss class={styles.alert} data-alert={variant}>
      <span class={styles.icon} aria-hidden="true"></span>
      <div class={styles.content}>
        <h5 class={styles.header}>{header}</h5>
        {children}
      </div>
      <Dismiss.Trigger event="click" method="hide">
        <button class={styles.dismiss} aria-label="Dismiss">
          ✕
        </button>
      </Dismiss.Trigger>
    </Dismiss>
  );
};

