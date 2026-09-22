#!/usr/bin/env python3
"""Keep Powerline's post-compaction queue pending until Pi can accept prompts."""
from pathlib import Path

from patch_support import backup_sources, write_sources

HOST = "index.ts"
MARKER = "// configs:powerline-compaction-queue-v1"
ORIGINAL = '''  function schedulePostCompactionDelivery(ctx: any): void {
    if (queueDeliveryTimer) clearTimeout(queueDeliveryTimer);
    const queueContext = getQueueContext(ctx);
    const scheduledGeneration = sessionGeneration;
    queueDeliveryTimer = setTimeout(() => {
      queueDeliveryTimer = null;
      if (scheduledGeneration !== sessionGeneration) return;
      try {
        const item = queueStore.queuedDeliveryItems(queueContext, "post-compact")[0];
        if (item) deliverQueueItem(ctx, item);
      } catch (error) {
        if (!isStaleExtensionContextError(error)) throw error;
        currentCtx = null;
      }
    }, 50);
  }'''
PATCHED = ORIGINAL.replace(
    "        if (item) deliverQueueItem(ctx, item);",
    f'''        if (!item) return;
        {MARKER}
        // session_compact still awaits later hooks; a timer is not completion.
        // ponytail: reuse the 50 ms poll until Pi exposes a shared completion event.
        if (!ctx.isIdle()) {{
          schedulePostCompactionDelivery(ctx);
          return;
        }}
        deliverQueueItem(ctx, item);''',
)


def patch(source: str) -> str:
    if MARKER in source:
        if source.count(MARKER) != 1 or source.count(PATCHED) != 1 or ORIGINAL in source:
            raise ValueError("Powerline compaction queue patch changed, duplicated or incomplete")
        return source
    if source.count(ORIGINAL) != 1:
        raise ValueError("Powerline compaction queue scheduler changed or duplicated")
    return source.replace(ORIGINAL, PATCHED)


def main() -> None:
    root = Path.home() / ".pi/agent/git/github.com/nicobailon/pi-powerline-footer"
    if not root.exists():
        print("Powerline not installed; skipping compaction queue fix")
        return
    source = (root / HOST).read_text()
    updated = patch(source)
    if updated != source:
        backup = backup_sources(root, [HOST], "powerline-compaction-queue-")
        print(f"Powerline compaction queue backup: {backup}")
        write_sources(root, {HOST: updated})
    print("Powerline compaction queue fix ready; /reload to apply")


if __name__ == "__main__":
    main()
