import { Agent, Plugin } from "@opencode/plugin";
import { COORDINATOR_AGENT, COORDINATOR_DESCRIPTION, COORDINATOR_PROMPT } from "./agent";
import { registerTools, TOOL_NAMES } from "./tools";

export default Plugin.define({
  id: "palot.voice-coordinator",
  async setup(ctx) {
    // Config-defined agents are applied after external plugins, so user config can still
    // override this agent's prompt and permissions.
    await ctx.agent.transform((editor) => {
      editor.update(COORDINATOR_AGENT, (agent) => {
        agent.name = Agent.Name.make("Voice Coordinator");
        agent.description = COORDINATOR_DESCRIPTION;
        agent.system = COORDINATOR_PROMPT;
        agent.mode = "primary";
        // Palot selects the agent explicitly; keep it out of default agent selection.
        agent.hidden = true;
        agent.permissions.push(
          { action: "voice_create_session", resource: "*", effect: "ask" },
          { action: "voice_send_message", resource: "*", effect: "ask" },
        );
      });
    });

    await ctx.tool.transform((editor) => registerTools(ctx, editor));

    // The tools are direct (codemode: false), so other agents never see them in their request.
    const voiceTools: readonly string[] = TOOL_NAMES;
    await ctx.session.hook("context", (event) => {
      if (event.agent === COORDINATOR_AGENT) return;
      for (const name of voiceTools) delete event.tools[name];
    });
  },
});
