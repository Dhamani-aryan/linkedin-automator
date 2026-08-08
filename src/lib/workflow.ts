import type { CampaignWorkflowAction, WorkflowActionType, WorkflowCard, WorkflowDelay } from "../types";

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

export const connectionRequestTemplate =
  "Hi {firstName},\n\nI came across your profile and would be glad to connect.";

export const directMessageTemplate =
  "Hi {firstName},\n\nThanks for connecting. I wanted to reach out about your work at {company}.";

export const defaultMessageDelay: WorkflowDelay = {
  amount: 1,
  unit: "days"
};

export function createWorkflowAction(type: "connection_request" | "message"): CampaignWorkflowAction[] {
  const createdAt = new Date().toISOString();
  const actionId = crypto.randomUUID();

  if (type === "connection_request") {
    return [
      {
        id: actionId,
        type,
        name: "Send connection request",
        description: "Invite 2nd and 3rd-degree contacts with an optional note.",
        template: connectionRequestTemplate,
        automatic: false,
        createdAt
      },
      createAutomaticGuard("wait_for_acceptance", actionId, createdAt)
    ];
  }

  return [
    {
      id: actionId,
      type,
      name: "Send message",
      description: "Send a personalized message to 1st-degree connections.",
      template: directMessageTemplate,
      delay: { ...defaultMessageDelay },
      automatic: false,
      createdAt
    },
    createAutomaticGuard("reply_check", actionId, createdAt)
  ];
}

export function createDefaultWorkflow(): CampaignWorkflowAction[] {
  return [...createWorkflowAction("connection_request"), ...createWorkflowAction("message")];
}

export function removeWorkflowAction(
  actions: CampaignWorkflowAction[],
  actionId: string
): CampaignWorkflowAction[] {
  const actionIndex = actions.findIndex((action) => action.id === actionId);
  if (actionIndex < 0 || actions[actionIndex].automatic) return actions;

  const nextActions = [...actions];
  nextActions.splice(actionIndex, 1);
  if (nextActions[actionIndex]?.automatic) {
    nextActions.splice(actionIndex, 1);
  }
  return nextActions;
}

export function actionLabel(type: WorkflowActionType): string {
  if (type === "connection_request") return "Connection request";
  if (type === "wait_for_acceptance") return "Wait for acceptance";
  if (type === "message") return "Message";
  return "Check for replies";
}

function createAutomaticGuard(
  type: "wait_for_acceptance" | "reply_check",
  parentId: string,
  createdAt: string
): CampaignWorkflowAction {
  return {
    id: `${parentId}-${type}`,
    type,
    name: type === "wait_for_acceptance" ? "Wait for connection acceptance" : "Check for replies",
    description:
      type === "wait_for_acceptance"
        ? "Only accepted connections continue to the next action."
        : "Replies stop follow-ups and move the profile to the inbox.",
    automatic: true,
    createdAt
  };
}

function ordinal(value: number): string {
  if (value === 1) return "1st";
  if (value === 2) return "2nd";
  if (value === 3) return "3rd";
  return `${value}th`;
}
