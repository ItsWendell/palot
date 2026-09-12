import { useEffect, useRef, useState } from "react";
import type { OpenCodeProfile, OpenCodeProfileSnapshot } from "../../shared";
import { palot } from "../services/palot";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

export function SshConnectionDialog({
  profile,
  onClose,
  onSaved,
}: {
  profile?: Extract<OpenCodeProfile, { kind: "ssh" }>;
  onClose(): void;
  onSaved(snapshot: OpenCodeProfileSnapshot): void;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [target, setTarget] = useState(profile?.ssh.target ?? "");
  const [port, setPort] = useState(profile?.ssh.port?.toString() ?? "");
  const [identityFile, setIdentityFile] = useState(profile?.ssh.identityFile ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const validPort = !port || (/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535);
  const save = async () => {
    if (busy || !target.trim() || !validPort) return;
    setBusy(true);
    setError(null);
    const input = {
      kind: "ssh" as const,
      name: name.trim() || target.trim(),
      ssh: {
        target: target.trim(),
        ...(port ? { port: Number(port) } : {}),
        ...(identityFile.trim() ? { identityFile: identityFile.trim() } : {}),
      },
    };
    try {
      await palot.testOpenCodeProfile(input);
      if (!mounted.current) return;
      onSaved(
        profile
          ? await palot.updateOpenCodeProfile({ ...input, id: profile.id })
          : await palot.createOpenCodeProfile(input),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "SSH connection failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{profile ? "Edit SSH connection" : "Add SSH connection"}</DialogTitle>
          <DialogDescription>
            Connect using your system SSH configuration. Tools and files stay on the remote
            computer.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy} className="space-y-4">
            <label className="grid gap-2 text-sm">
              Name (optional)
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Development server"
              />
            </label>
            <label className="grid gap-2 text-sm">
              SSH target
              <Input
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder="config-alias or user@host"
                autoCapitalize="none"
                autoCorrect="off"
                required
              />
            </label>
            <label className="grid gap-2 text-sm">
              Port (optional)
              <Input
                value={port}
                onChange={(event) => setPort(event.target.value)}
                inputMode="numeric"
                placeholder="Use SSH configuration"
                aria-invalid={!validPort}
              />
            </label>
            <label className="grid gap-2 text-sm">
              Identity file (optional)
              <Input
                value={identityFile}
                onChange={(event) => setIdentityFile(event.target.value)}
                placeholder="~/.ssh/id_ed25519"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </label>
          </fieldset>
          <p className="text-compact text-muted-foreground">
            Palot asks before installing, starting, or replacing the required OpenCode runtime.
            Closing the SSH tunnel leaves the remote service running. The profile is saved only
            after a successful connection test.
          </p>
          {error ? (
            <p role="alert" className="text-compact text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !target.trim() || !validPort}>
              {busy ? "Testing connection…" : "Test and save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
