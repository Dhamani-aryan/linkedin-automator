import { buildWorkflowWithReplyChecks, defaultWorkflowActions } from "../lib/workflow";
import type { CampaignSummary, LeadProfile } from "../types";

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
    linkedinUrl: "https://www.linkedin.com/in/sample-lead-one/",
    displayName: "avery-stone",
    firstName: "Avery",
    lastName: "Stone",
    company: "Advisory Services",
    position: "IT Systems Manager",
    location: "Cebu, Philippines",
    sourceId: "seed-source",
    status: "to_process",
    addedAt: "Aug 3, 2026, 3:29 PM"
  },
  {
    id: "lead-002",
    linkedinUrl: "https://www.linkedin.com/in/sample-lead-two/",
    displayName: "jordan-lee",
    firstName: "Jordan",
    lastName: "Lee",
    company: "CloudWorks",
    position: "Head of IT",
    location: "Austin, TX",
    sourceId: "seed-source",
    status: "to_process",
    addedAt: "Aug 3, 2026, 3:29 PM"
  },
  {
    id: "lead-003",
    linkedinUrl: "https://www.linkedin.com/in/sample-lead-three/",
    displayName: "morgan-srivastava",
    firstName: "Morgan",
    lastName: "Srivastava",
    company: "Northline Systems",
    position: "SAP Program Lead",
    location: "Bengaluru, India",
    sourceId: "seed-source",
    status: "accepted",
    addedAt: "Aug 4, 2026, 9:18 AM"
  }
];

export const seedWorkflow = buildWorkflowWithReplyChecks({
  actions: defaultWorkflowActions,
  sourceCount: 16
});
