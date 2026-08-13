import { describe, expect, it } from "vitest";
import { classifyConversationReply } from "./message.js";

const baseline = { text: "Hi Casey,\n\nChecking in", sentAt: "2026-08-09T10:00:00.000Z" };
const recipient = {
  recipientName: "Casey Example",
  recipientUrl: "https://www.linkedin.com/in/sample-recipient"
};

describe("classifyConversationReply", () => {
  it("detects a recipient message after the confirmed outbound baseline", () => {
    const result = classifyConversationReply([
      { text: baseline.text, author: "Campaign Sender", profileUrl: null },
      { text: "Yes, happy to chat", author: "Casey Example", profileUrl: recipient.recipientUrl, externalId: "reply-1" }
    ], baseline, recipient);

    expect(result).toEqual({
      status: "replied",
      message: expect.objectContaining({ externalId: "reply-1" })
    });
  });

  it("does not count an outbound follow-up as a reply", () => {
    const result = classifyConversationReply([
      { text: baseline.text, author: "Campaign Sender", profileUrl: null },
      { text: "One more detail", author: "Campaign Sender", profileUrl: null }
    ], baseline, recipient);

    expect(result).toEqual({ status: "no_reply" });
  });

  it("requires review when the baseline is not visible", () => {
    const result = classifyConversationReply([
      { text: "A different message", author: "Casey Example", profileUrl: recipient.recipientUrl }
    ], baseline, recipient);

    expect(result).toMatchObject({ status: "needs_review" });
  });

  it("requires review for unattributed messages after the baseline", () => {
    const result = classifyConversationReply([
      { text: baseline.text, author: "Campaign Sender", profileUrl: null },
      { text: "Unknown direction", author: "", profileUrl: null }
    ], baseline, recipient);

    expect(result).toMatchObject({ status: "needs_review" });
  });
});
