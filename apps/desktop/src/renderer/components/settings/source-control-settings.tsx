import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SaveCodeHostInput } from "../../../shared/source-control-contract";
import { sourceControlKeys, SourceControlError } from "../../hooks/use-source-control";
import { SettingsGroup, SettingsRow, SettingsSection } from "../settings-layout";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { CopyField } from "../ui/copy-field";

export function SourceControlSettings() {
  const queryClient = useQueryClient();
  const hosts = useQuery({
    queryKey: [...sourceControlKeys.all, "hosts"],
    queryFn: () => window.palot.sourceControl.codeHosts(),
  });
  const [kind, setKind] = useState<SaveCodeHostInput["kind"]>("gitlab");
  const [url, setUrl] = useState("https://gitlab.com");
  const [token, setToken] = useState("");
  const mutation = useMutation({
    mutationFn: async (input: SaveCodeHostInput | { remove: string }) => {
      const result =
        "remove" in input
          ? await window.palot.sourceControl.removeCodeHost(input.remove)
          : await window.palot.sourceControl.saveCodeHost(input);
      if (!result.ok) throw new SourceControlError(result.error);
    },
    onSuccess: () => {
      setToken("");
      void queryClient.invalidateQueries({ queryKey: sourceControlKeys.all });
    },
  });
  return (
    <>
      <SettingsSection
        title="Code hosts"
        description="Tokens stay in this device's encrypted credential vault, never on your OpenCode server or in task prompts. Git push uses the Git credentials on the task's machine, not these API tokens."
      >
        <SettingsGroup>
          <SettingsRow
            title="GitHub"
            description="Uses GH_TOKEN / GITHUB_TOKEN or gh auth login."
          />
          {(hosts.data ?? []).map((host) => (
            <SettingsRow
              key={host.host}
              title={host.host}
              description={`${host.kind} · ${host.source === "saved" ? "Encrypted token saved" : host.source === "env" ? "Environment token" : host.kind === "gitlab" ? "Token or glab sign-in" : "Not configured"}`}
            >
              <CopyField value={host.url} valueName="Host URL" />
              {host.source === "saved" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ remove: host.host })}
                >
                  Remove token
                </Button>
              ) : null}
            </SettingsRow>
          ))}
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection title="Add a code host token">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate({ kind, url, token });
          }}
        >
          <SettingsGroup>
            <SettingsRow
              title="Provider"
              control={
                <Select
                  value={kind}
                  onValueChange={(value) => {
                    if (!value) return;
                    const next = value as SaveCodeHostInput["kind"];
                    setKind(next);
                    setUrl(
                      next === "gitlab"
                        ? "https://gitlab.com"
                        : next === "bitbucket"
                          ? "https://bitbucket.org"
                          : "https://codeberg.org",
                    );
                  }}
                >
                  <SelectTrigger
                    className="w-full @lg/settings:w-48"
                    aria-label="Code host provider"
                  >
                    <SelectValue>
                      {kind === "gitlab"
                        ? "GitLab"
                        : kind === "forgejo"
                          ? "Forgejo / Gitea"
                          : "Bitbucket Cloud"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="gitlab">GitLab</SelectItem>
                    <SelectItem value="forgejo">Forgejo / Gitea</SelectItem>
                    <SelectItem value="bitbucket">Bitbucket Cloud</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
            <SettingsRow
              title="Host URL"
              description="Saving a token trusts this exact HTTPS host."
              layout="stacked"
              control={
                <Input
                  aria-label="Code host URL"
                  type="url"
                  required
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://gitlab.example.com"
                />
              }
            />
            <SettingsRow
              title="Access token"
              description="GitLab needs api scope and repository access. Forgejo / Gitea needs repository, issue and user access. Bitbucket accepts repository, project or workspace bearer access tokens with pull request read/write permissions."
              layout="stacked"
              control={
                <Input
                  aria-label="Code host access token"
                  type="password"
                  autoComplete="new-password"
                  required
                  maxLength={16384}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
              }
            />
          </SettingsGroup>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!token.trim() || mutation.isPending}>
              Save token
            </Button>
            {mutation.error || hosts.error ? (
              <p role="alert" className="text-sm text-destructive">
                {(mutation.error ?? hosts.error)?.message}
              </p>
            ) : null}
            {mutation.isSuccess ? (
              <p role="status" className="text-meta text-muted-foreground">
                Code host settings saved.
              </p>
            ) : null}
          </div>
        </form>
      </SettingsSection>
    </>
  );
}
