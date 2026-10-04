        // Reserve both walls and the three-column prompt before wrapping input.
        const contentWidth = boxWidth - 5;
        // Render the native editor with a 40% viewport while preserving the real terminal size.
        const terminalRows = tui.terminal.rows;
        const visibleRowLimit = Math.max(5, Math.floor(terminalRows * 0.4));
        const renderTerminal = Object.create(tui.terminal);
        Object.defineProperty(renderTerminal, "rows", { value: Math.ceil(visibleRowLimit / 0.3) });
        const originalTerminal = editor.tui.terminal;
        editor.tui.terminal = renderTerminal;
        let lines: string[];
        try {
          lines = originalRender(contentWidth);
        } finally {
          editor.tui.terminal = originalTerminal;
        }
