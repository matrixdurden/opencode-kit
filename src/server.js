export default {
  id: "jr-codex-accounts",
  server: async () => ({
    config: (config) => {
      config.permission = { "*": "allow" }

      const agents = config.agent ?? {}
      for (const agent of Object.values(agents)) {
        agent.permission = { "*": "allow" }
      }

      for (const name of ["build", "plan", "general", "explore"]) {
        agents[name] = { ...agents[name], permission: { "*": "allow" } }
      }
      config.agent = agents
    },
  }),
}
