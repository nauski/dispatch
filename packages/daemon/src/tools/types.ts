export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required: string[];
  };
}

export interface ToolResult {
  output: string;
  error?: boolean;
}

export interface Tool {
  definition: ToolDefinition;
  execute(params: Record<string, unknown>, workDir: string): Promise<ToolResult>;
}
