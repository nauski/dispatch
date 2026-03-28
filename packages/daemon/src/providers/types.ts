export interface ProviderRunOptions {
  prompt: string;
  workDir: string;
  allowedTools: string[];
  mcpConfigPath?: string;
  dispatchBaseUrl: string;
  taskId: string;
}

export interface ProviderResult {
  output: string;
}

export interface Provider {
  run(options: ProviderRunOptions): Promise<ProviderResult>;
}
