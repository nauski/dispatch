export interface TaskComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  toRole: string | null;
  status?: string | null;
  workDir?: string | null;
  executionId?: string | null;
}

export function buildConversationalPrompt(task: Task, newComment: TaskComment, allComments: TaskComment[]): string {
  let prompt = `Someone has commented on a completed task that was assigned to you. Respond to their comment.\n\n`;
  prompt += `## Task: ${task.title}\n`;
  prompt += `**Task ID:** ${task.id}\n`;
  prompt += `**Status:** ${task.status || "done"}\n\n`;
  if (task.description) {
    prompt += `## Original Description\n${task.description}\n\n`;
  }

  if (allComments.length > 1) {
    prompt += `## Comment Thread\n`;
    for (const c of allComments) {
      prompt += `**${c.author}** (${c.createdAt}):\n${c.body}\n\n`;
    }
  }

  prompt += `## New Comment from ${newComment.author}\n${newComment.body}\n\n`;

  prompt += `## Instructions\n`;
  prompt += `- Respond to the comment using \`post_task_comment\` (taskId: "${task.id}").\n`;
  prompt += `- This is a conversation, not a new task. The task is already ${task.status || "done"}.\n`;
  prompt += `- If the comment asks a question, answer it based on what you know and can find in the working directory.\n`;
  prompt += `- If the comment requests new work, use \`update_task\` to set the task back to "assigned" and describe what needs to be done. Do NOT do the work in this session.\n`;
  prompt += `- Keep your response concise.\n`;
  return prompt;
}

export function buildPrompt(task: Task, context?: { comments: TaskComment[] }): string {
  let prompt = `You have been assigned a task by the Dispatch coordination system.\n\n`;
  prompt += `## Task: ${task.title}\n`;
  prompt += `**Task ID:** ${task.id}\n\n`;
  if (task.description) {
    prompt += `## Description\n${task.description}\n\n`;
  }

  if (context?.comments?.length) {
    prompt += `## Previous Comments\n`;
    prompt += `This task was previously paused for clarification. Review the comment thread below and the current state of the working directory before continuing.\n\n`;
    for (const c of context.comments) {
      prompt += `**${c.author}** (${c.createdAt}):\n${c.body}\n\n`;
    }
  }

  prompt += `## Instructions\n`;
  prompt += `- Complete the task as described above.\n`;
  prompt += `- Be thorough but concise.\n`;
  prompt += `- Report your result clearly.\n`;
  prompt += `\n## Asking for Clarification\n`;
  prompt += `If the task is ambiguous, you encounter unexpected state, or you need more information:\n`;
  prompt += `1. Use the \`post_task_comment\` tool to describe what you need (taskId: "${task.id}").\n`;
  prompt += `2. Use the \`update_task\` tool to set the task status to "needs_info" (taskId: "${task.id}").\n`;
  prompt += `3. Stop working — a human or another agent will reply, and the task will be re-assigned to you with context.\n`;
  prompt += `\n## Honesty — CRITICAL\n`;
  prompt += `- ONLY report success if you actually performed the action and verified it worked.\n`;
  prompt += `- If you lack the tools or permissions to complete a task, say so explicitly. NEVER fabricate output.\n`;
  prompt += `- If a command is not available to you, report failure with "missing tool: <tool name>".\n`;
  prompt += `- Guessing or hallucinating results is the worst possible outcome — a wrong "success" is far worse than an honest "I can't do this".\n`;
  prompt += `\n## Safety\n`;
  prompt += `- NEVER delete files or directories.\n`;
  prompt += `- NEVER run destructive git commands (push --force, reset --hard, clean -f, branch -D).\n`;
  prompt += `- NEVER modify files outside your working directory.\n`;
  prompt += `- If a task seems destructive or unclear, report that you need clarification instead of proceeding.\n`;
  return prompt;
}
