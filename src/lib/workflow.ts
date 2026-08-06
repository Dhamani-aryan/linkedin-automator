import type { WorkflowCard } from "../types";

export type WorkflowActionInput = {
  id: string;
  title: string;
  subtitle: string;
  count: number;
};

export const defaultWorkflowActions: WorkflowActionInput[] = [
  {
    id: "invite",
    title: "Invite 2nd and 3rd level contacts",
    subtitle: "Connection request with message template",
    count: 16
  },
  {
    id: "filter-network",
    title: "Filter contacts out of my network",
    subtitle: "Keep accepted contacts for the next step",
    count: 0
  },
  {
    id: "follow-up",
    title: "Send follow-up message",
    subtitle: "Message accepted contacts with variables",
    count: 0
  }
];

export function buildWorkflowWithReplyChecks(input: {
  actions: WorkflowActionInput[];
  sourceCount: number;
}): WorkflowCard[] {
  const cards: WorkflowCard[] = [
    {
      id: "source",
      kind: "source",
      title: "Profiles to process",
      subtitle: "Lead queue source",
      count: input.sourceCount,
      successful: 0,
      failed: 0
    }
  ];

  for (const [index, action] of input.actions.entries()) {
    cards.push({
      id: action.id,
      kind: "action",
      title: action.title,
      subtitle: action.subtitle,
      count: action.count,
      successful: 0,
      failed: 0
    });

    cards.push({
      id: `${action.id}-reply-check`,
      kind: "reply_check",
      title: "Check for replies",
      subtitle: `Auto-added after ${ordinal(index + 1)} action`,
      count: action.count,
      successful: 0,
      failed: 0
    });
  }

  return cards;
}

function ordinal(value: number): string {
  if (value === 1) return "1st";
  if (value === 2) return "2nd";
  if (value === 3) return "3rd";
  return `${value}th`;
}
