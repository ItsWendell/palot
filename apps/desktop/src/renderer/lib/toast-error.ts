import { actionableErrorMessage, errorDiagnostic } from "../../shared";
import { toast } from "../components/ui/toast";

export function showErrorToast(title: string, cause: unknown, fallback = title): void {
  console.error(
    `[palot-action] failed ${JSON.stringify({ title, error: errorDiagnostic(cause) })}`,
  );
  toast.add({
    type: "error",
    title,
    description: actionableErrorMessage(cause, fallback),
  });
}
