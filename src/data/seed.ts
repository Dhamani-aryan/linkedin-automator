import type { CampaignSummary, LeadProfile, WorkflowCard } from "../types";

export const seedCampaigns: CampaignSummary[] = [
  {
    id: "sap-install-base",
    name: "SAP Install Base",
    status: "ready",
    profilesTotal: 16,
    profilesToProcess: 16,
    processing: 0,
    processed: 0,
    successful: 0,
    failed: 0,
    accepted: 0,
    replied: 0
  },
  {
    id: "it-heads-ecc",
    name: "IT Head on SAP ECC",
    status: "sleeping",
    profilesTotal: 201,
    profilesToProcess: 64,
    processing: 135,
    processed: 2,
    successful: 0,
    failed: 2,
    accepted: 9,
    replied: 0
  }
];

export const seedLeads: LeadProfile[] = [
  {
    id: "lead-001",
    displayName: "avery-stone",
    firstName: "Avery",
    lastName: "Stone",
    company: "Advisory Services",
    position: "IT Systems Manager",
    location: "Cebu, Philippines",
    status: "to_process",
    addedAt: "Aug 3, 2026, 3:29 PM"
  },
  {
    id: "lead-002",
    displayName: "jordan-lee",
    firstName: "Jordan",
    lastName: "Lee",
    company: "CloudWorks",
    position: "Head of IT",
    location: "Austin, TX",
    status: "to_process",
    addedAt: "Aug 3, 2026, 3:29 PM"
  },
  {
    id: "lead-003",
    displayName: "morgan-srivastava",
    firstName: "Morgan",
    lastName: "Srivastava",
    company: "Northline Systems",
    position: "SAP Program Lead",
    location: "Bengaluru, India",
    status: "accepted",
    addedAt: "Aug 4, 2026, 9:18 AM"
  }
];

export const seedWorkflow: WorkflowCard[] = [
  {
    id: "source",
    kind: "source",
    title: "Profiles to process",
    subtitle: "Lead queue source",
    count: 16,
    successful: 0,
    failed: 0
  },
  {
    id: "invite",
    kind: "action",
    title: "Invite 2nd and 3rd level contacts",
    subtitle: "Connection request with message template",
    count: 16,
    successful: 0,
    failed: 0
  },
  {
    id: "reply-check-1",
    kind: "reply_check",
    title: "Check for replies",
    subtitle: "Auto-added after invite action",
    count: 16,
    successful: 0,
    failed: 0
  },
  {
    id: "filter",
    kind: "action",
    title: "Filter contacts out of my network",
    subtitle: "Keep accepted contacts for follow-up",
    count: 0,
    successful: 0,
    failed: 0
  },
  {
    id: "reply-check-2",
    kind: "reply_check",
    title: "Check for replies",
    subtitle: "Auto-added after filter action",
    count: 0,
    successful: 0,
    failed: 0
  }
];
