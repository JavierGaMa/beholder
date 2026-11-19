export interface McpSnippet {
  id: string;
  label: string;
  filename: string;
  note: string;
  code: string;
}

export interface SnippetInput {
  command: string;
  discoveryPath: string;
}

export function tokenHandlingNote(discoveryPath: string): string {
  return `The bridge token is never pasted into client config: the beholder-mcp sidecar reads port and token from ${discoveryPath} (mode 0600) when a client connects.`;
}

export function buildMcpSnippets(input: SnippetInput): McpSnippet[] {
  const { command, discoveryPath } = input;
  const mcpServers = JSON.stringify(
    { mcpServers: { beholder: { command } } },
    null,
    2,
  );
  return [
    {
      id: "generic",
      label: "Generic MCP",
      filename: "mcp.json",
      note: `Standard mcpServers entry for any MCP client. Reads port and token from ${discoveryPath} at connect time.`,
      code: mcpServers,
    },
    {
      id: "claude-code",
      label: "Claude Code",
      filename: ".mcp.json",
      note: `Save as .mcp.json in the project root, or add the entry to ~/.claude.json. Equivalent CLI: claude mcp add beholder -- ${command}`,
      code: mcpServers,
    },
    {
      id: "cursor",
      label: "Cursor",
      filename: ".cursor/mcp.json",
      note: "Save as .cursor/mcp.json in the project root.",
      code: mcpServers,
    },
    {
      id: "opencode",
      label: "OpenCode",
      filename: "opencode.json",
      note: "Save as opencode.json in the project root or ~/.config/opencode/opencode.json.",
      code: JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          mcp: {
            beholder: {
              type: "local",
              command: [command],
              enabled: true,
            },
          },
        },
        null,
        2,
      ),
    },
  ];
}
