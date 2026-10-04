// configs:intercom-transcript-v1
import type { Component } from "@earendil-works/pi-tui";
import { stripTerminalSequences, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import type { SessionInfo, Message } from "../types.ts";

/** Presentation only: the delivered message, body and attachment data remain untouched. */
export class InlineMessageComponent implements Component {
  private from: SessionInfo;
  private message: Message;
  private theme: Theme;
  private replyCommand?: string;
  private bodyText?: string;
  private collapsed: boolean;
  private outputPad: number;

  constructor(
    from: SessionInfo,
    message: Message,
    theme: Theme,
    replyCommand?: string,
    bodyText?: string,
    collapsed = false,
    outputPad = 1,
  ) {
    this.from = from;
    this.message = message;
    this.theme = theme;
    this.replyCommand = replyCommand;
    this.bodyText = bodyText;
    this.collapsed = collapsed;
    this.outputPad = outputPad;
  }

  invalidate(): void {} // Theme and layout are evaluated on every render.

  render(width: number): string[] {
    if (width <= 0) return [];
    // Match the host's standalone action gutter, including its reserved tree columns.
    const transcriptPad = width < 80
      ? Math.min(1, Math.max(0, Math.floor((width - 2) / 2)))
      : Math.min(Math.max(0, this.outputPad) + 2, width - 1);
    const headerPad = transcriptPad + (width - transcriptPad >= 6 ? 3 : 0);
    const bodyPad = Math.min(headerPad + 2, width - 1);
    const bodyWidth = Math.max(1, width - bodyPad);
    const indent = " ".repeat(bodyPad);
    const clean = (text: string) => stripTerminalSequences(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
    const senderName = clean(this.from.name || this.from.id.slice(0, 8)).replace(/\s+/g, " ");
    const heading = this.theme.fg("muted", "✓") + " " + this.theme.fg("accent", "◇") + " "
      + this.theme.bold(this.theme.fg("muted", "Intercom")) + " " + this.theme.fg("text", `From ${senderName}`);
    const titleWidth = width - headerPad;
    const lines = [" ".repeat(headerPad) + truncateToWidth(heading, titleWidth, titleWidth < 4 ? "" : "...")];
    if (this.collapsed) {
      lines.push(indent + this.theme.fg("text", truncateToWidth(clean(this.message.content.text).replace(/\s+/g, " ").trim(), bodyWidth)));
      lines.push(indent + truncateToWidth(keyHint("app.tools.expand", "to expand"), bodyWidth));
      return lines;
    }

    const body = clean(this.bodyText || this.message.content.text);
    const add = (text: string, color: "text" | "dim") => {
      for (const line of wrapTextWithAnsi(clean(text), bodyWidth)) {
        lines.push(indent + this.theme.fg(color, truncateToWidth(line, bodyWidth)));
      }
    };
    add(body, "text");
    add(`Sender: ${this.from.id} · ${this.from.cwd}`, "dim");
    add(`Message: ${this.message.id}`, "dim");
    if (Number.isFinite(this.message.timestamp) && Number.isFinite(new Date(this.message.timestamp).getTime())) {
      add(`Sent: ${new Date(this.message.timestamp).toISOString()}`, "dim");
    }
    if (this.replyCommand) add(`To reply: ${this.replyCommand}`, "dim");
    if (this.message.replyTo) add(`Reply to ${this.message.replyTo}`, "dim");
    if (this.message.provenance?.type === "extension_outbox") {
      add(`Via extension: ${this.message.provenance.extensionName}`, "dim");
    }
    // bodyText already includes formatted attachments on normal deliveries.
    // Keep that exact body; show contents separately only when it was not supplied.
    for (const attachment of this.message.content.attachments ?? []) {
      add(`Attachment: ${attachment.name}`, "dim");
      if (!this.bodyText) add(attachment.content, "text");
    }
    return lines;
  }
}
