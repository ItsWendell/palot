import { actionableErrorMessage, errorDiagnostic, openCodeErrorReference } from "../../shared";
import { toast } from "../components/ui/toast";

/** "Message (UnknownError · ref 01J…)" when OpenCode declared the error, so it can be found in its log. */
function withReference(message: string, cause: unknown): string {
  const reference = openCodeErrorReference(cause);
  return reference ? `${message} (${reference})` : message;
}

export function showErrorToast(title: string, cause: unknown, fallback = title): void {
  console.error(
    `[palot-action] failed ${JSON.stringify({ title, error: errorDiagnostic(cause) })}`,
  );
  toast.add({
    type: "error",
    title,
    description: withReference(actionableErrorMessage(cause, fallback), cause),
  });
}
