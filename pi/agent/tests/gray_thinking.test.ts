import { expect, test } from "bun:test";
import type { ExtensionAPI, MarkdownTransformer } from "@earendil-works/pi-coding-agent";
import grayThinking from "../extensions/gray_thinking";

test("unwraps thinking markup without changing user or assistant messages", () => {
  let transform: MarkdownTransformer;
  grayThinking({
    registerMarkdownTransformer(fn: MarkdownTransformer) { transform = fn; },
  } as ExtensionAPI);

  const markdown = "## Plan\n\n**Read** `foo.ts`, then [check](https://example.com).\n\n```ts\nconst value = 1;\n```";
  const thinking = { messageType: "assistant-thinking", isStreaming: true } as const;
  expect(transform!(markdown, thinking)).toBe("Plan\n\nRead foo.ts, then check.\n\nconst value = 1;\n");
  expect(transform!("```ts\nconst value = 1;", thinking)).toBe("const value = 1;");

  for (const messageType of ["user", "assistant"] as const) {
    expect(transform!(markdown, { messageType, isStreaming: false })).toBe(markdown);
  }
});
