import { FC } from "hono/jsx";
import { Layout } from "./Layout";
import { Alert } from "views/components/Alert";
import { AppError, ValidationError } from "@spindle/spindle/thread";

const DEFAULT_ERROR_MESSAGE = "Something's wrong";

export interface ResultsViewProps {
  variant: "success" | "error" | "info";
  message?: string;
  error?: AppError | Error;
}

export const ResultsView: FC<ResultsViewProps> = ({ variant, message, error }) => {
  const title = message ?? DEFAULT_ERROR_MESSAGE;
  const isAppError = error instanceof AppError;

  const subheader = isAppError && error.statusCode
    ? `Error ${error.statusCode}`
    : undefined;

  const fieldErrors = error instanceof ValidationError && error.fields
    ? Object.entries(error.fields).map(([field, msg]) => (
        <li>
          <strong>{field}:</strong> {msg}
        </li>
      ))
    : null;

  return (
    <Layout>
      <Alert
        variant={variant}
        header={title}
        subheader={subheader}
      >
        {fieldErrors && <ul>{fieldErrors}</ul>}
      </Alert>
    </Layout>
  );
};

